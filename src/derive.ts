// Intent -> derived tokens. The intent (tokens/intent, tokens/registry.json) holds what designers
// decide: brand seeds, the frames' own colours per theme, neutral palettes, statuses, contrast
// targets. Derivation turns each seed into the closest colour (OKLCH, hue and chroma kept,
// lightness moved) that meets its contrast target on every surface of a theme, and writes the
// theme and direction contexts the resolver applies (tokens/derived) plus the contrast report.
// It refuses to write anything when a pair cannot be met.
import { readdirSync } from "node:fs";
import { contrast, mix, nudge, shiftUntil, toOklch } from "./color.ts";
import {
  TOKENS,
  color,
  hexOf,
  isObject,
  mergeGroups,
  readJson,
  setToken,
  tokensOf,
  type Json,
  type JsonObject,
} from "./dtcg.ts";

export type Scheme = "dark" | "light";

export interface Registry {
  directions: { id: string; name: string }[];
  themes: {
    default: string;
    /** What a visitor who chose nothing gets: `system` follows the device (themes.system, contrast). */
    defaultChoice?: "system";
    system: Record<Scheme, string>;
    contrast?: Record<Scheme, string>;
    order: string[];
  };
  platforms?: { default: string; order: string[]; css: string[] };
  densities?: { default: string; order: string[] };
  motions?: { default: string; order: string[] };
}

export interface Check {
  theme: string;
  pair: string;
  a: string;
  b: string;
  ratio: number;
  target: number;
}

interface Targets {
  text: number;
  largeText: number;
  ui: number;
}

/** A theme of the registry with its intent merged over the theme it extends. */
export interface Theme {
  id: string;
  scheme: Scheme;
  source: string | undefined;
  intent: JsonObject;
}

const up = (hex: string): string => hex.toUpperCase();

export function readRegistry(): Registry {
  const raw = readJson(`${TOKENS}registry.json`);
  const directions = raw["directions"];
  const themes = raw["themes"];
  if (!Array.isArray(directions) || !isObject(themes))
    throw new Error("registry: malformed");
  const registry = raw as unknown as Registry;
  for (const d of registry.directions)
    if (!/^[a-z][a-z0-9]*$/.test(d.id))
      throw new Error(`direction id ${d.id} is not a slug`);
  return registry;
}

function numberAt(file: JsonObject, path: string[]): number {
  let node: Json | undefined = file;
  for (const p of path) node = isObject(node) ? node[p] : undefined;
  if (isObject(node) && typeof node["$value"] === "number")
    return node["$value"];
  throw new Error(`${path.join(".")}: not a number token`);
}

/** Every theme of the registry, default first, each intent merged over the theme it extends. */
export function readThemes(registry: Registry): Theme[] {
  const files = new Map<string, JsonObject>(
    registry.themes.order.map((id) => [
      id,
      readJson(`${TOKENS}intent/themes/${id}.tokens.json`),
    ]),
  );
  const resolved = new Map<string, Theme>();
  const meta = (file: JsonObject): JsonObject => {
    const ext = file["$extensions"];
    const own = isObject(ext) ? ext["ai.nddev"] : undefined;
    const theme = isObject(own) ? own["theme"] : undefined;
    return isObject(theme) ? theme : {};
  };
  const resolve = (id: string, trail: string[] = []): Theme => {
    const done = resolved.get(id);
    if (done) return done;
    if (trail.includes(id))
      throw new Error(
        `theme ${id} extends itself: ${[...trail, id].join(" > ")}`,
      );
    const file = files.get(id);
    if (!file)
      throw new Error(
        `theme ${trail.at(-1) ?? ""} extends an unknown theme ${id}`,
      );
    if (!/^[a-z][a-z0-9-]*$/.test(id))
      throw new Error(`theme id ${id} is not a lowercase slug`);
    const m = meta(file);
    const parent =
      typeof m["extends"] === "string"
        ? resolve(m["extends"], [...trail, id])
        : undefined;
    const own: JsonObject = Object.fromEntries(
      Object.entries(file).filter(([k]) => k !== "$extensions"),
    );
    const intent = parent ? mergeGroups(parent.intent, own) : own;
    const rawScheme =
      typeof m["scheme"] === "string" ? m["scheme"] : parent?.scheme;
    if (rawScheme !== "dark" && rawScheme !== "light")
      throw new Error(`theme ${id}: scheme must be dark or light`);
    const scheme: Scheme = rawScheme;
    const theme: Theme = {
      id,
      scheme,
      source: typeof m["source"] === "string" ? m["source"] : parent?.source,
      intent,
    };
    resolved.set(id, theme);
    return theme;
  };
  const ordered = [
    registry.themes.default,
    ...registry.themes.order.filter((id) => id !== registry.themes.default),
  ];
  if (!registry.themes.order.includes(registry.themes.default))
    throw new Error(`default theme ${registry.themes.default} is not a theme`);
  const themes = ordered.map((id) => resolve(id));
  for (const scheme of ["dark", "light"] as const) {
    const t = themes.find((x) => x.id === registry.themes.system[scheme]);
    if (!t || t.scheme !== scheme)
      throw new Error(`themes.system.${scheme} must name a ${scheme} theme`);
  }
  return themes;
}

/** The colours of a group of the intent as path -> hex (e.g. surface.base). */
function colors(group: Json | undefined, where: string): Map<string, string> {
  const out = new Map<string, string>();
  if (group === undefined) return out;
  if (!isObject(group)) throw new Error(`${where}: not a group`);
  for (const { path, token } of tokensOf(group))
    out.set(
      path.join("."),
      hexOf(token["$value"], `${where}.${path.join(".")}`),
    );
  return out;
}

interface Palette {
  surface: Map<string, string>;
  text: Map<string, string>;
  border: Map<string, string>;
  focus: Map<string, string>;
  subtleMix: number;
  litMix: number;
}

function paletteOf(theme: Theme): Palette {
  const p = theme.intent["palette"];
  if (!isObject(p)) throw new Error(`theme ${theme.id}: no palette`);
  return {
    surface: colors(p["surface"], `${theme.id}.palette.surface`),
    text: colors(p["text"], `${theme.id}.palette.text`),
    border: colors(p["border"], `${theme.id}.palette.border`),
    focus: colors(p["focus"], `${theme.id}.palette.focus`),
    subtleMix: numberAt(theme.intent, ["palette", "subtle-mix"]),
    litMix: numberAt(theme.intent, ["palette", "lit-mix"]),
  };
}

/** The frames' seed of one kind for one direction in a theme (fill, heading, outline, edge, role.X). */
function seed(
  theme: Theme,
  kind: string[],
  direction: string,
): string | undefined {
  let node: Json | undefined = theme.intent["seed"];
  for (const k of [...kind, direction])
    node = isObject(node) ? node[k] : undefined;
  return isObject(node)
    ? hexOf(node["$value"], `${theme.id}.seed.${kind.join(".")}.${direction}`)
    : undefined;
}

function roleNames(themes: Theme[]): string[] {
  const names = new Set<string>();
  for (const t of themes) {
    const role = isObject(t.intent["seed"])
      ? t.intent["seed"]["role"]
      : undefined;
    if (isObject(role))
      for (const k of Object.keys(role)) if (!k.startsWith("$")) names.add(k);
  }
  return [...names];
}

interface Seeds {
  fill?: string | undefined;
  heading?: string | undefined;
  outline?: string | undefined;
  edge?: string | undefined;
  roles?: Record<string, string | undefined>;
}

/**
 * Derive every token that depends on a hue: text, fill, border and tint, each the closest colour
 * to the brand that satisfies its target on the theme's surfaces (port of the site's generator).
 */
export function deriveAccent(
  name: string,
  brand: string,
  theme: Theme,
  palette: Palette,
  targets: Targets,
  onFill: { light: string; ink: string },
  seeds: Seeds = {},
): { derived: Record<string, string>; checks: Check[] } {
  const dark = theme.scheme === "dark";
  const surfaces = [...palette.surface.values()];
  const checks: Check[] = [];
  const need = (label: string, a: string, b: string, target: number): void => {
    const ratio = contrast(a, b);
    if (ratio < target)
      throw new Error(
        `${name}/${theme.id} ${label}: ${ratio.toFixed(2)} < ${target}`,
      );
    checks.push({
      theme: theme.id,
      pair: `${name}.${label}`,
      a,
      b,
      ratio: Number(ratio.toFixed(2)),
      target,
    });
  };
  const base = palette.surface.get("base");
  const chip = palette.border.get("subtle");
  const primary = palette.text.get("primary");
  if (!base || !chip || !primary)
    throw new Error(
      `theme ${theme.id}: surface.base, border.subtle and text.primary are required`,
    );
  const subtle = mix(base, brand, palette.subtleMix);
  // Small words in the accent also sit on chips filled with the subtle border (tags).
  const textOn = [...surfaces, subtle, chip];
  const text = shiftUntil(brand, dark ? "lighter" : "darker", (c) =>
    textOn.every((s) => contrast(c, s) >= targets.text),
  );
  const towardSurfaces = (from: string, target: number): string | null =>
    shiftUntil(from, dark ? "lighter" : "darker", (c) =>
      surfaces.every((s) => contrast(c, s) >= target),
    );
  const border = towardSurfaces(brand, targets.ui);
  const outline = towardSurfaces(seeds.outline ?? brand, targets.ui);
  const label = towardSurfaces(seeds.outline ?? brand, targets.text);
  const heading = seeds.heading
    ? towardSurfaces(seeds.heading, targets.largeText)
    : text;
  const edge = (seeds.edge ?? brand).toLowerCase();
  if (!text || !border || !outline || !label || !heading)
    throw new Error(`${name}/${theme.id}: no lightness reaches the targets`);

  const fillFrom = (
    from: string,
    what: string,
  ): { fill: string; hover: string; active: string; on: string } => {
    const candidates = (["light", "ink"] as const).map((k) => {
      const on = onFill[k];
      const fill = shiftUntil(
        from,
        k === "light" ? "darker" : "lighter",
        (c) => contrast(c, on) >= targets.text,
      );
      return {
        on,
        fill,
        delta: fill ? Math.abs(nudgeL(fill) - nudgeL(from)) : Infinity,
      };
    });
    candidates.sort((a, b) => a.delta - b.delta);
    const pick = candidates[0];
    if (!pick?.fill)
      throw new Error(
        `${name}/${theme.id}: no ${what} reaches ${targets.text}:1 with either on-fill colour`,
      );
    // Pointer states move toward more contrast with the on-fill colour.
    const toward = pick.on === onFill.light ? -1 : 1;
    const hover = nudge(pick.fill, toward * 0.04);
    const active = nudge(pick.fill, toward * 0.08);
    need(`on-fill on ${what}`, pick.on, pick.fill, targets.text);
    need(`on-fill on ${what} hover`, pick.on, hover, targets.text);
    need(`on-fill on ${what} active`, pick.on, active, targets.text);
    return { fill: pick.fill, hover, active, on: pick.on };
  };
  const main = fillFrom(seeds.fill ?? brand, "fill");
  // The lit card: surface.raised tinted with the fill. It carries every text a card does.
  const raised = palette.surface.get("raised");
  const secondary = palette.text.get("secondary");
  if (!raised || !secondary)
    throw new Error(
      `theme ${theme.id}: surface.raised and text.secondary are required`,
    );
  const lit = mix(raised, main.fill, palette.litMix);
  const roles: [string, string][] = Object.entries(seeds.roles ?? {}).flatMap(
    ([role, s]) => {
      const f = fillFrom(s ?? seeds.fill ?? brand, `${role} fill`);
      return [
        [`${role}-fill`, f.fill],
        [`${role}-fill-hover`, f.hover],
        [`${role}-fill-active`, f.active],
        [`${role}-on-fill`, f.on],
      ];
    },
  );

  for (const [k, s] of palette.surface)
    need(`text on surface.${k}`, text, s, targets.text);
  need("text on subtle", text, subtle, targets.text);
  need("text on chip", text, chip, targets.text);
  need("primary text on subtle", primary, subtle, targets.text);
  need("primary text on lit", primary, lit, targets.text);
  need("secondary text on lit", secondary, lit, targets.text);
  need("text on lit", text, lit, targets.text);
  need("heading on lit", heading, lit, targets.largeText);
  for (const [k, s] of palette.surface) {
    need(`border on surface.${k}`, border, s, targets.ui);
    need(`outline on surface.${k}`, outline, s, targets.ui);
    need(`label on surface.${k}`, label, s, targets.text);
    need(`heading on surface.${k}`, heading, s, targets.largeText);
  }
  return {
    derived: {
      brand: brand.toLowerCase(),
      text,
      heading,
      fill: main.fill,
      "fill-hover": main.hover,
      "fill-active": main.active,
      "on-fill": main.on,
      ...Object.fromEntries(roles),
      border,
      outline,
      label,
      edge,
      subtle,
      lit,
    },
    checks,
  };
}

// Lightness only, for the fill search's "smaller move" comparison.
const nudgeL = (hex: string): number => toOklch(hex).L;

function neutralChecks(
  theme: Theme,
  palette: Palette,
  targets: Targets,
): Check[] {
  const checks: Check[] = [];
  const need = (label: string, a: string, b: string, target: number): void => {
    const ratio = contrast(a, b);
    if (ratio < target)
      throw new Error(`${theme.id} ${label}: ${ratio.toFixed(2)} < ${target}`);
    checks.push({
      theme: theme.id,
      pair: label,
      a,
      b,
      ratio: Number(ratio.toFixed(2)),
      target,
    });
  };
  const control = palette.border.get("control");
  const ring = palette.focus.get("ring");
  if (!control || !ring)
    throw new Error(
      `theme ${theme.id}: border.control and focus.ring are required`,
    );
  for (const [sk, s] of palette.surface) {
    for (const [tk, t] of palette.text)
      need(`text.${tk} on surface.${sk}`, t, s, targets.text);
    need(`border.control on surface.${sk}`, control, s, targets.ui);
    need(`focus.ring on surface.${sk}`, ring, s, targets.ui);
  }
  // The signal colour also sets small text (the leads' index, 524:4173), so it reads as text.
  const component = isObject(theme.intent["component"])
    ? theme.intent["component"]
    : {};
  const literal = (key: string): string | undefined => {
    const node = component[key];
    if (!isObject(node)) return undefined;
    const v =
      "$value" in node
        ? node["$value"]
        : isObject(node["surface"])
          ? node["surface"]["$value"]
          : undefined;
    return isObject(v) && typeof v["hex"] === "string" ? v["hex"] : undefined;
  };
  const base = palette.surface.get("base");
  const signal = literal("signal");
  if (signal && base)
    need("signal on surface.base", signal, base, targets.text);
  // A service tile carries its name, summary and framed arrow on its own surface (569:1582).
  const tile = literal("tile");
  if (tile) {
    for (const tk of ["primary", "secondary"]) {
      const t = palette.text.get(tk);
      if (t) need(`text.${tk} on tile-surface`, t, tile, targets.text);
    }
    need("border.control on tile-surface", control, tile, targets.ui);
  }
  return checks;
}

/** A theme's contrast targets: its own `contrast` group over the global ones (contrast themes). */
function targetsOf(theme: Theme, global: Targets): Targets {
  const own = theme.intent["contrast"];
  if (!isObject(own)) return global;
  const n = (key: string, fallback: number): number => {
    const t = own[key];
    return isObject(t) && typeof t["$value"] === "number"
      ? t["$value"]
      : fallback;
  };
  return {
    text: n("text", global.text),
    largeText: n("large-text", global.largeText),
    ui: n("ui", global.ui),
  };
}

/** Derived roles a status keeps: not a direction's frame colours. */
const FRAME_ONLY = new Set(["heading", "outline", "label", "edge", "lit"]);

export interface Derived {
  registry: Registry;
  themes: Theme[];
  /** theme -> direction -> role -> hex */
  accents: Record<string, Record<string, Record<string, string>>>;
  /** theme -> status -> role -> hex */
  statuses: Record<string, Record<string, Record<string, string>>>;
  checks: Check[];
  files: Map<string, JsonObject>;
}

export function derive(): Derived {
  const registry = readRegistry();
  const themes = readThemes(registry);
  const targetsFile = readJson(`${TOKENS}intent/targets.tokens.json`);
  const targets: Targets = {
    text: numberAt(targetsFile, ["contrast", "text"]),
    largeText: numberAt(targetsFile, ["contrast", "large-text"]),
    ui: numberAt(targetsFile, ["contrast", "ui"]),
  };
  const brandFile = readJson(`${TOKENS}intent/brand.tokens.json`);
  const brand = colors(brandFile["brand"], "brand");
  for (const d of registry.directions)
    if (!brand.has(d.id))
      throw new Error(`direction ${d.id} has no brand seed`);
  for (const id of brand.keys())
    if (!registry.directions.some((d) => d.id === id))
      throw new Error(`brand seed ${id} is not a registered direction`);
  const statusSeeds = colors(
    readJson(`${TOKENS}intent/status.tokens.json`)["status-seed"],
    "status-seed",
  );
  const onFillColors = colors(
    readJson(`${TOKENS}intent/on-fill.tokens.json`)["on-fill"],
    "on-fill",
  );
  const onFill = {
    light: onFillColors.get("light") ?? "",
    ink: onFillColors.get("ink") ?? "",
  };
  if (!onFill.light || !onFill.ink)
    throw new Error("on-fill: light and ink are required");

  const roles = roleNames(themes);
  const checks: Check[] = [];
  const accents: Derived["accents"] = {};
  const statuses: Derived["statuses"] = {};
  const palettes = new Map<string, Palette>();
  for (const theme of themes) {
    const palette = paletteOf(theme);
    palettes.set(theme.id, palette);
    checks.push(...neutralChecks(theme, palette, targetsOf(theme, targets)));
    // Every frame seed must name a registered direction.
    const seedGroup = theme.intent["seed"];
    if (isObject(seedGroup))
      for (const { path } of tokensOf(seedGroup)) {
        const dir = path.at(-1) ?? "";
        if (!brand.has(dir))
          throw new Error(
            `theme ${theme.id}: seed ${path.join(".")} names an unknown direction`,
          );
      }
    const themeTargets = targetsOf(theme, targets);
    accents[theme.id] = {};
    for (const d of registry.directions) {
      const r = deriveAccent(
        d.id,
        brand.get(d.id) ?? "",
        theme,
        palette,
        themeTargets,
        onFill,
        {
          fill: seed(theme, ["fill"], d.id),
          heading: seed(theme, ["heading"], d.id),
          outline: seed(theme, ["outline"], d.id),
          edge: seed(theme, ["edge"], d.id),
          roles: Object.fromEntries(
            roles.map((role) => [role, seed(theme, ["role", role], d.id)]),
          ),
        },
      );
      (accents[theme.id] ??= {})[d.id] = r.derived;
      checks.push(...r.checks);
    }
    statuses[theme.id] = {};
    for (const [name, s] of statusSeeds) {
      const r = deriveAccent(
        `status.${name}`,
        s,
        theme,
        palette,
        targetsOf(theme, targets),
        onFill,
      );
      (statuses[theme.id] ??= {})[name] = Object.fromEntries(
        Object.entries(r.derived).filter(([k]) => !FRAME_ONLY.has(k)),
      );
      checks.push(...r.checks);
    }
  }

  // --- files ---
  const files = new Map<string, JsonObject>();
  const accentRoles = Object.keys(
    accents[themes[0]?.id ?? ""]?.[registry.directions[0]?.id ?? ""] ?? {},
  );
  for (const theme of themes) {
    const palette = palettes.get(theme.id);
    if (!palette) continue;
    const file: JsonObject = {
      $description: `Theme ${theme.id} (${theme.scheme}): derived from tokens/intent/themes/${theme.id}.tokens.json. Generated by \`just derive\`; do not edit.`,
      $extensions: {
        "ai.nddev": {
          theme: {
            scheme: theme.scheme,
            ...(theme.source ? { source: theme.source } : {}),
          },
          generated: true,
        },
      },
    };
    for (const [group, entries] of [
      ["surface", palette.surface],
      ["text", palette.text],
      ["border", palette.border],
      ["focus", palette.focus],
    ] as const)
      for (const [k, hex] of entries)
        setToken(file, [group, ...k.split(".")], {
          $type: "color",
          $value: color(hex),
        });
    for (const role of accentRoles)
      setToken(file, ["accent", role], {
        $type: "color",
        $value: `{accent-theme.${theme.id}.${role}}`,
      });
    for (const [name, rolesOf] of Object.entries(statuses[theme.id] ?? {}))
      for (const [role, hex] of Object.entries(rolesOf))
        setToken(file, ["status", name, role], {
          $type: "color",
          $value: color(hex),
        });
    // Interactive states, inverse surfaces, links and the chart series: roles every kit component
    // reads, derived from the palette (disabled colours are exempt from contrast, WCAG 1.4.3).
    const surfaceBase = palette.surface.get("base") ?? "";
    const textPrimary = palette.text.get("primary") ?? "";
    const control = palette.border.get("control") ?? "";
    const state = (name: string, hex: string): void => {
      setToken(file, name.split("."), { $type: "color", $value: color(hex) });
    };
    state("surface.hover", mix(surfaceBase, textPrimary, 0.06));
    state("surface.pressed", mix(surfaceBase, textPrimary, 0.1));
    state("surface.disabled", mix(surfaceBase, textPrimary, 0.04));
    state("text.disabled", mix(textPrimary, surfaceBase, 0.6));
    state("border.disabled", mix(control, surfaceBase, 0.5));
    setToken(file, ["surface", "selected"], {
      $type: "color",
      $value: "{accent.subtle}",
    });
    setToken(file, ["surface", "lit"], {
      $type: "color",
      $value: "{accent.lit}",
    });
    setToken(file, ["surface", "inverse"], {
      $type: "color",
      $value: "{text.primary}",
    });
    setToken(file, ["text", "inverse"], {
      $type: "color",
      $value: "{surface.base}",
    });
    setToken(file, ["link", "default"], {
      $type: "color",
      $value: "{accent.text}",
    });
    // A hovered link keeps the text role (accent.heading is only gated as large text) and gains a
    // thicker underline: hover changes the cue, never the contrast (WCAG 1.4.1, 1.4.3).
    setToken(file, ["link", "hover"], {
      $type: "color",
      $value: "{accent.text}",
    });
    // chart.series.* is authored per theme (theme intent `chart`, emitted with the other authored
    // groups below): direction accents collide under colour-vision deficiency.
    setToken(file, ["chart", "grid"], {
      $type: "color",
      $value: "{border.subtle}",
    });
    setToken(file, ["chart", "axis"], {
      $type: "color",
      $value: "{text.tertiary}",
    });
    // Authored groups of the theme intent: the frames' component tokens at the root, other groups
    // (elevation) under their own name.
    for (const [key, group] of Object.entries(theme.intent)) {
      if (["palette", "seed", "contrast"].includes(key) || !isObject(group))
        continue;
      const base = key === "component" ? [] : [key];
      for (const { path, token, type } of tokensOf(group))
        setToken(file, [...base, ...path], {
          ...(type ? { $type: type } : {}),
          ...structuredClone(token),
        });
    }
    files.set(`derived/theme/${theme.id}.tokens.json`, file);
  }
  for (const d of registry.directions) {
    const file: JsonObject = {
      $description: `Direction ${d.id} (${d.name}): its accent roles in every theme, derived from its brand seed and the frames' seeds. Generated by \`just derive\`; do not edit.`,
      $extensions: { "ai.nddev": { generated: true } },
      "accent-theme": {
        $type: "color",
        $description:
          "Per-theme accent roles; a theme aliases accent.* to its own entry, so theme and direction stay orthogonal.",
        $extensions: { "ai.nddev": { private: true } },
      },
    };
    for (const theme of themes)
      for (const [role, hex] of Object.entries(accents[theme.id]?.[d.id] ?? {}))
        setToken(file, ["accent-theme", theme.id, role], {
          $value: color(hex),
        });
    files.set(`derived/direction/${d.id}.tokens.json`, file);
  }
  files.set("nddev.resolver.json", resolverDocument(registry, themes));
  return { registry, themes, accents, statuses, checks, files };
}

/** The foundation files, in the order they merge. */
export const FOUNDATION = [
  "foundation/space.tokens.json",
  "foundation/radius.tokens.json",
  "foundation/size.tokens.json",
  "foundation/border.tokens.json",
  "foundation/opacity.tokens.json",
  "foundation/layout.tokens.json",
  "foundation/type.tokens.json",
  "foundation/motion.tokens.json",
  "foundation/stacking.tokens.json",
];

/** The UI kit's component tokens (tokens/component/), resolved after every modifier: each aliases a
 * public token, so it follows the theme, direction, platform and density of its scope. */
export function componentFiles(): string[] {
  let names: string[];
  try {
    names = readdirSync(`${TOKENS}component`);
  } catch {
    return [];
  }
  return names
    .filter((f) => f.endsWith(".tokens.json"))
    .sort()
    .map((f) => `component/${f}`);
}

/** The modifiers in resolution order: what each is, its contexts' files and its default. */
export function modifiersOf(
  registry: Registry,
  themes: Theme[],
): {
  name: string;
  description: string;
  contexts: [string, string][];
  default: string;
}[] {
  const list = (
    o: { default: string; order: string[] } | undefined,
    what: string,
  ): { default: string; order: string[] } => {
    if (!o || !o.order.includes(o.default))
      throw new Error(`registry: ${what} needs order and a default in it`);
    return o;
  };
  const platforms = list(registry.platforms, "platforms");
  const densities = list(registry.densities, "densities");
  const motions = list(registry.motions, "motions");
  return [
    {
      name: "direction",
      description: "The NDDev direction (brand) an interface belongs to.",
      contexts: registry.directions.map((d) => [
        d.id,
        `derived/direction/${d.id}.tokens.json`,
      ]),
      default: registry.directions[0]?.id ?? "",
    },
    {
      name: "theme",
      description: "Colour theme.",
      contexts: themes.map((t) => [t.id, `derived/theme/${t.id}.tokens.json`]),
      default: registry.themes.default,
    },
    {
      name: "platform",
      description:
        "Where the interface runs: type scale, font stacks, control and target sizes.",
      contexts: platforms.order.map((p) => [p, `platform/${p}.tokens.json`]),
      default: platforms.default,
    },
    {
      name: "density",
      description: "How tightly controls are set.",
      contexts: densities.order.map((d) => [d, `density/${d}.tokens.json`]),
      default: densities.default,
    },
    {
      name: "motion",
      description:
        "Interface motion: standard, or reduced (prefers-reduced-motion).",
      contexts: motions.order.map((m) => [m, `motion/${m}.tokens.json`]),
      default: motions.default,
    },
  ];
}

/** The DTCG Resolver Module document: the foundation set, the modifiers, then the component set. */
export function resolverDocument(
  registry: Registry,
  themes: Theme[],
): JsonObject {
  const modifiers = modifiersOf(registry, themes);
  const components = componentFiles();
  return {
    name: "NDDev design system",
    // The Resolver Module text names 2025-10-01 and 2025-11-01; the reference parser reads "2025.10".
    version: "2025.10",
    description:
      "Generated by `just derive` from tokens/registry.json. Modifiers are orthogonal: no token is defined by two of them (a direction defines accent-theme.<theme>.*, a platform control.<density>.*; a theme and a density alias into them).",
    sets: {
      foundation: { sources: FOUNDATION.map((f) => ({ $ref: f })) },
      ...(components.length
        ? { component: { sources: components.map((f) => ({ $ref: f })) } }
        : {}),
    },
    modifiers: Object.fromEntries(
      modifiers.map((m) => [
        m.name,
        {
          description: m.description,
          contexts: Object.fromEntries(
            m.contexts.map(([id, file]) => [id, [{ $ref: file }]]),
          ),
          default: m.default,
        },
      ]),
    ),
    resolutionOrder: [
      { $ref: "#/sets/foundation" },
      ...modifiers.map((m) => ({ $ref: `#/modifiers/${m.name}` })),
      ...(components.length ? [{ $ref: "#/sets/component" }] : []),
    ],
  };
}

export { up };
