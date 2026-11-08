// The resolved model every emitter reads: @terrazzo/parser (the reference implementation of DTCG
// 2025.10 with resolvers) parses and validates tokens/nddev.resolver.json; permutations are applied
// on demand and cached. Emitters never read token files themselves.
import { pathToFileURL } from "node:url";
import { defineConfig, parse } from "@terrazzo/parser";
import {
  TOKENS,
  readJson,
  isObject,
  type Json,
  type JsonObject,
} from "./dtcg.ts";
import {
  FOUNDATION,
  componentFiles,
  modifiersOf,
  readRegistry,
  readThemes,
  type Registry,
  type Scheme,
} from "./derive.ts";

/** A resolved token as the parser normalizes it (the fields this system reads). */
export interface Token {
  id: string;
  $type: string;
  $value: Json;
  $description?: string;
  $extensions?: Record<string, Json>;
  $deprecated?: boolean | string;
  aliasOf?: string;
  originalValue?: { $value?: Json } & Record<string, Json>;
}

export type TokenSet = Record<string, Token>;

/** A value for every modifier: { direction, theme, platform, density, motion }. */
export type Input = Record<string, string>;

export interface ThemeInfo {
  id: string;
  scheme: Scheme;
  source: string | undefined;
}

export interface Modifier {
  name: string;
  contexts: string[];
  default: string;
}

export type Owner = string;

export interface Model {
  registry: Registry;
  themes: ThemeInfo[];
  directions: string[];
  modifiers: Modifier[];
  defaults: Input;
  /** Public token ids (private namespaces excluded), foundation first, in file order. */
  ids: string[];
  /** Which part defines each public token: 'foundation', a modifier's name or 'component'. */
  owner: Map<string, Owner>;
  /** The resolved tokens of one input; missing modifiers take their defaults. */
  get(input?: Input): TokenSet;
  /** The same through the reference parser's resolver (slow; for equivalence tests). */
  terrazzo(input: Input): TokenSet;
  modifier(name: string): Modifier;
}

/** The ai.nddev extension of a token. */
export function nd(token: Token | undefined): Record<string, Json> {
  const own = token?.$extensions?.["ai.nddev"];
  return isObject(own) ? own : {};
}

function privateGroups(
  file: Record<string, Json>,
  path: string[] = [],
): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(file)) {
    if (k.startsWith("$") || !isObject(v) || "$value" in v) continue;
    const ext = v["$extensions"];
    const own = isObject(ext) ? ext["ai.nddev"] : undefined;
    if (isObject(own) && own["private"] === true)
      out.push([...path, k].join("."));
    else out.push(...privateGroups(v, [...path, k]));
  }
  return out;
}

function idsOf(file: Record<string, Json>, path: string[] = []): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(file)) {
    if (k.startsWith("$") && k !== "$root") continue;
    if (!isObject(v)) continue;
    const p = k === "$root" ? path : [...path, k];
    if ("$value" in v) out.push(p.join("."));
    else out.push(...idsOf(v, p));
  }
  return out;
}

/** A token as written in a file, with its inherited type. */
interface Flat {
  id: string;
  $type: string | undefined;
  $value: Json;
  $description?: string;
  $extensions?: Record<string, Json>;
  $deprecated?: boolean | string;
}

function flatten(
  file: Record<string, Json>,
  path: string[] = [],
  inherited?: string,
): Map<string, Flat> {
  const out = new Map<string, Flat>();
  const type = typeof file["$type"] === "string" ? file["$type"] : inherited;
  for (const [k, v] of Object.entries(file)) {
    if ((k.startsWith("$") && k !== "$root") || !isObject(v)) continue;
    const p = k === "$root" ? path : [...path, k];
    if ("$value" in v) {
      const id = p.join(".");
      const flat: Flat = {
        id,
        $type: typeof v["$type"] === "string" ? v["$type"] : type,
        $value: v["$value"] ?? null,
      };
      if (typeof v["$description"] === "string")
        flat.$description = v["$description"];
      if (isObject(v["$extensions"])) flat.$extensions = v["$extensions"];
      if (
        typeof v["$deprecated"] === "boolean" ||
        typeof v["$deprecated"] === "string"
      )
        flat.$deprecated = v["$deprecated"];
      out.set(id, flat);
    } else for (const [id, t] of flatten(v, p, type)) out.set(id, t);
  }
  return out;
}

const ALIAS = /^\{([^{}]+)\}$/;

function resolveAll(merged: Map<string, Flat>): TokenSet {
  const out: TokenSet = {};
  const resolving = new Set<string>();
  const value = (id: string): { $value: Json; $type: string | undefined } => {
    const t = merged.get(id);
    if (!t) throw new Error(`alias to a missing token {${id}}`);
    if (resolving.has(id)) throw new Error(`alias cycle at {${id}}`);
    resolving.add(id);
    const v = deep(t.$value);
    resolving.delete(id);
    const own = typeof t.$value === "string" ? ALIAS.exec(t.$value) : null;
    return {
      $value: v,
      $type: t.$type ?? (own ? value(own[1] ?? "").$type : undefined),
    };
  };
  const deep = (v: Json): Json => {
    if (typeof v === "string") {
      const m = ALIAS.exec(v);
      return m ? value(m[1] ?? "").$value : v;
    }
    if (Array.isArray(v)) return v.map(deep);
    if (isObject(v))
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, deep(x)]),
      );
    return v;
  };
  for (const [id, t] of merged) {
    const r = value(id);
    if (!r.$type) throw new Error(`${id}: no $type`);
    const own = typeof t.$value === "string" ? ALIAS.exec(t.$value) : null;
    // Normalized as the parser does: a shadow is a list of layers, each with `inset`.
    const normal =
      r.$type === "shadow"
        ? (Array.isArray(r.$value) ? r.$value : [r.$value]).map((l) =>
            isObject(l) ? { ...l, inset: l["inset"] === true } : l,
          )
        : r.$value;
    const token: Token = {
      id,
      $type: r.$type,
      $value: normal,
      originalValue: { $value: t.$value },
    };
    if (own?.[1]) token.aliasOf = own[1];
    if (t.$description !== undefined) token.$description = t.$description;
    if (t.$extensions !== undefined) token.$extensions = t.$extensions;
    if (t.$deprecated !== undefined) token.$deprecated = t.$deprecated;
    out[id] = token;
  }
  return out;
}

export async function loadModel(
  overrides: ReadonlyMap<string, JsonObject> = new Map(),
): Promise<Model> {
  const read = (name: string): JsonObject =>
    overrides.get(name) ?? readJson(TOKENS + name);
  // The generated resolver uses file references. Inline only explicitly supplied candidate
  // documents for the reference parser; authored files still use its normal loader.
  const candidate = (value: Json): Json => {
    if (Array.isArray(value)) return value.map(candidate);
    if (!isObject(value)) return value;
    const ref = value["$ref"];
    const supplied = typeof ref === "string" ? overrides.get(ref) : undefined;
    if (Object.keys(value).length === 1 && supplied !== undefined)
      return structuredClone(supplied);
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, candidate(item)]),
    );
  };
  const registry = readRegistry();
  const intentThemes = readThemes(registry);
  const resolverPath = `${TOKENS}nddev.resolver.json`;
  const config = defineConfig({}, { cwd: pathToFileURL(TOKENS) });
  const src = JSON.stringify(candidate(read("nddev.resolver.json")));
  const { resolver } = await parse(
    [{ filename: pathToFileURL(resolverPath), src }],
    { config },
  );
  if (!resolver.orthogonal)
    throw new Error("resolver: modifiers are not orthogonal");

  const specs = modifiersOf(registry, intentThemes);
  const modifiers: Modifier[] = specs.map((m) => ({
    name: m.name,
    contexts: m.contexts.map(([id]) => id),
    default: m.default,
  }));
  const defaults: Input = Object.fromEntries(
    modifiers.map((m) => [m.name, m.default]),
  );
  const themes: ThemeInfo[] = intentThemes.map((t) => ({
    id: t.id,
    scheme: t.scheme,
    source: t.source,
  }));

  // Permutations are resolved here (the parser validated the documents above; a test proves this
  // flatten-and-resolve equals its resolver.apply on a sample of permutations): the foundation set,
  // then each modifier's chosen context in resolution order, the last definition winning, then
  // aliases resolved. resolver.apply costs ~170 ms a permutation; this is ~1 ms.
  const fileCache = new Map<string, Map<string, Flat>>();
  const flatFile = (file: string): Map<string, Flat> => {
    const hit = fileCache.get(file);
    if (hit) return hit;
    const flat = flatten(read(file));
    fileCache.set(file, flat);
    return flat;
  };
  const contextFile = new Map(specs.map((m) => [m.name, new Map(m.contexts)]));
  const components = componentFiles();
  const cache = new Map<string, TokenSet>();
  const get = (input: Input = {}): TokenSet => {
    const full: Input = { ...defaults, ...input };
    const key = modifiers.map((m) => full[m.name]).join("/");
    const hit = cache.get(key);
    if (hit) return hit;
    const merged = new Map<string, Flat>();
    for (const f of FOUNDATION)
      for (const [id, t] of flatFile(f)) merged.set(id, t);
    for (const m of modifiers) {
      const ctx = full[m.name] ?? m.default;
      const file = contextFile.get(m.name)?.get(ctx);
      if (!file) throw new Error(`resolver: ${m.name} has no context ${ctx}`);
      for (const [id, t] of flatFile(file)) merged.set(id, t);
    }
    for (const f of components)
      for (const [id, t] of flatFile(f)) merged.set(id, t);
    const set = resolveAll(merged);
    cache.set(key, set);
    return set;
  };
  const terrazzo = (input: Input): TokenSet =>
    resolver.apply({ ...defaults, ...input }) as unknown as TokenSet;

  // Owners from the files: the foundation, then each modifier's default context.
  const owner = new Map<string, Owner>();
  const privatePrefixes: string[] = [];
  for (const f of FOUNDATION)
    for (const id of idsOf(read(f))) owner.set(id, "foundation");
  for (const m of specs) {
    for (const [ctx, file] of m.contexts) {
      const json = read(file);
      privatePrefixes.push(...privateGroups(json));
      if (ctx === m.default)
        for (const id of idsOf(json)) if (!owner.has(id)) owner.set(id, m.name);
    }
  }
  const isPrivate = (id: string): boolean =>
    privatePrefixes.some((p) => id === p || id.startsWith(`${p}.`));
  for (const id of [...owner.keys()]) if (isPrivate(id)) owner.delete(id);
  // Component tokens: a group named after its file, each token an alias of a public token below the
  // component tier, or a constant that no context changes.
  for (const f of components) {
    const group = /component\/(.+)\.tokens\.json$/.exec(f)?.[1] ?? "";
    for (const [id, t] of flatFile(f)) {
      if (id !== group && !id.startsWith(`${group}.`))
        throw new Error(`${f}: ${id} is outside the group ${group}`);
      if (owner.has(id))
        throw new Error(
          `${f}: ${id} is already defined by ${String(owner.get(id))}`,
        );
      const alias =
        typeof t.$value === "string" ? ALIAS.exec(t.$value)?.[1] : undefined;
      if (alias) {
        const target = owner.get(alias);
        if (target === undefined || target === "component")
          throw new Error(
            `${f}: ${id} must alias a public token below the component tier, not {${alias}}`,
          );
      } else if (typeof t.$value === "string" && t.$value.includes("{"))
        throw new Error(`${f}: ${id} may alias one token or hold a constant`);
      owner.set(id, "component");
    }
  }
  const ids = [...owner.keys()];

  return {
    registry,
    themes,
    directions: registry.directions.map((d) => d.id),
    modifiers,
    defaults,
    ids,
    owner,
    get,
    terrazzo,
    modifier(name) {
      const m = modifiers.find((x) => x.name === name);
      if (!m) throw new Error(`no modifier ${name}`);
      return m;
    },
  };
}
