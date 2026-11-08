// Small helpers over DTCG 2025.10 JSON: reading files, walking tokens, building values. Validation
// of the format itself is @terrazzo/parser's (src/model.ts); these only move data.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const TOKENS = `${ROOT}tokens/`;

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface DimensionValue {
  value: number;
  unit: "px" | "rem";
}

export const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function readJson(path: string): JsonObject {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isObject(value)) throw new Error(`${path}: not a JSON object`);
  return value;
}

export const r4 = (n: number): number => Number(n.toFixed(4));

/** A DTCG sRGB colour from a hex (and alpha), hex kept as the exact 8-bit value. */
export function color(hex: string, alpha?: number): JsonObject {
  const h = hex.replace("#", "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(h)) throw new Error(`not a hex colour: ${hex}`);
  const components = [0, 2, 4].map((i) =>
    r4(parseInt(h.slice(i, i + 2), 16) / 255),
  );
  return {
    colorSpace: "srgb",
    components,
    ...(alpha === undefined || alpha === 1 ? {} : { alpha }),
    hex: `#${h}`,
  };
}

/** The hex of a DTCG colour value written by this system (srgb with hex). */
export function hexOf(value: Json | undefined, where: string): string {
  if (isObject(value) && typeof value["hex"] === "string") return value["hex"];
  throw new Error(`${where}: not an sRGB colour with hex`);
}

/** Walk every token (an object with $value) under a group, with its dotted path. */
export function* tokensOf(
  group: JsonObject,
  path: string[] = [],
  inherited?: string,
): Generator<{ path: string[]; token: JsonObject; type: string | undefined }> {
  const type = typeof group["$type"] === "string" ? group["$type"] : inherited;
  for (const [key, child] of Object.entries(group)) {
    if (key.startsWith("$") && key !== "$root") continue;
    if (!isObject(child)) continue;
    const childPath = [...path, key];
    if ("$value" in child) {
      const own = typeof child["$type"] === "string" ? child["$type"] : type;
      yield { path: childPath, token: child, type: own };
    } else yield* tokensOf(child, childPath, type);
  }
}

/** Set a token at a dotted path, creating groups. */
export function setToken(
  root: JsonObject,
  path: readonly string[],
  token: JsonObject,
): void {
  let node = root;
  for (const part of path.slice(0, -1)) {
    const next = node[part];
    if (next === undefined) node[part] = {};
    else if (!isObject(next) || "$value" in next)
      throw new Error(`${path.join(".")}: group clash`);
    node = node[part] as JsonObject;
  }
  const last = path.at(-1);
  if (last === undefined) throw new Error("empty path");
  node[last] = token;
}

/** Deep merge of DTCG groups: `own` replaces tokens and adds paths (DTCG $extends semantics). */
export function mergeGroups(base: JsonObject, own: JsonObject): JsonObject {
  const out: JsonObject = structuredClone(base);
  for (const [k, v] of Object.entries(own)) {
    const b = out[k];
    out[k] =
      isObject(v) && !("$value" in v) && isObject(b) && !("$value" in b)
        ? mergeGroups(b, v)
        : v;
  }
  return out;
}

export const stableJson = (value: Json | JsonObject): string =>
  `${JSON.stringify(value, null, 2)}\n`;
