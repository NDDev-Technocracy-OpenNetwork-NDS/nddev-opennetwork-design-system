// The Figma library's variables, effect styles and text styles as data (packages/figma), which the
// library file "NDDev Design System" is built from (ADR §11). Collections mirror the resolver:
// Primitives (foundation), Theme, Direction, Platform, Density, Motion, one mode per context, and
// Component (the kit's tokens, aliases of the others). Where
// a value depends on two modifiers, the first collection holds a hidden entry per context of the
// second and the public variable aliases it, as the private namespaces do in the tokens: a frame's
// theme and direction modes (or platform and density) compose. Values are what native code draws:
// colours with ai.nddev.modify applied, dimensions in px.
import { ROOT, isObject, readJson, type Json } from "../dtcg.ts";
import { readTextStyles } from "../kit.ts";
import {
  nd,
  type Input,
  type Model,
  type Token,
  type TokenSet,
} from "../model.ts";
import { cssName } from "./css.ts";
import { camel, colorOf, type Rgba } from "./native.ts";

type Alias = { alias: { collection: string; name: string } };
type Value = Rgba | number | string | Alias;
type VariableType = "COLOR" | "FLOAT" | "STRING";

export interface FigmaVariable {
  name: string;
  token?: string;
  type: VariableType;
  description?: string;
  scopes: string[];
  hiddenFromPublishing?: true;
  codeSyntax?: { WEB?: string; ANDROID?: string; iOS?: string };
  valuesByMode: Record<string, Value>;
}

export interface FigmaCollection {
  name: string;
  modifier?: string;
  modes: { id: string; name: string }[];
  defaultMode: string;
  variables: FigmaVariable[];
}

const TITLES: Record<string, string> = {
  web: "Web",
  desktop: "Desktop",
  ios: "iOS",
  android: "Android",
};
export const title = (id: string): string =>
  TITLES[id] ?? (id.charAt(0).toUpperCase() + id.slice(1)).replace(/-/g, " ");

/** Tokens the library leaves out: web media queries, CSS-only compositions, code-only numbers. */
const SKIP = [/^breakpoint\./, /^spring\./, /^z\./, /^measure$/];
const TYPES: Record<string, VariableType> = {
  color: "COLOR",
  dimension: "FLOAT",
  number: "FLOAT",
  fontWeight: "FLOAT",
  duration: "FLOAT",
  fontFamily: "STRING",
};

const figmaName = (id: string): string => id.replace(/\./g, "/");

/** Number tokens Figma binds to layer opacity, which it reads as a percentage (0-100). */
const OPACITY = /^opacity\.|^art\.glow/;

/** Where a variable may be offered in Figma's pickers. */
export function scopesOf(id: string, type: string): string[] {
  if (type === "color") {
    if (
      /(^text\.|\.text(?:\.|$)|on-fill|^link\.|heading|label|open-text|^tag\.text|work-tag)/.test(
        id,
      )
    )
      return ["TEXT_FILL", "SHAPE_FILL", "STROKE_COLOR"];
    if (/(border|outline|edge|rule|ring|grid|axis)/.test(id))
      return ["STROKE_COLOR"];
    if (/(surface|fill|subtle|scrim|tint|shade|solid|place|signal)/.test(id))
      return ["FRAME_FILL", "SHAPE_FILL"];
    return ["ALL_FILLS", "STROKE_COLOR"];
  }
  if (type === "fontFamily") return ["FONT_FAMILY"];
  if (type === "fontWeight") return ["FONT_WEIGHT"];
  if (type === "duration") return [];
  if (type === "number") return OPACITY.test(id) ? ["OPACITY"] : [];
  if (/^text-size\./.test(id)) return ["FONT_SIZE"];
  if (
    /^(space|rhythm)\.|^gutter$|^section-space$|\.(gap|(?:cell-)?padding)(?:[.-]|$)/.test(
      id,
    )
  )
    return ["GAP"];
  if (/(^radius\.|\.radius$)/.test(id)) return ["CORNER_RADIUS"];
  if (/^(border-width|focus\.width)|\.border-width$/.test(id))
    return ["STROKE_FLOAT"];
  return ["WIDTH_HEIGHT"];
}

function codeSyntaxOf(
  id: string,
  type: string,
): NonNullable<FigmaVariable["codeSyntax"]> {
  const web = `var(${cssName(id)})`;
  if (type === "color")
    return {
      WEB: web,
      iOS: `ndColors.${camel(id)}`,
      ANDROID: `LocalNDColors.current.${camel(id)}`,
    };
  if (type === "dimension" && !id.startsWith("text-size."))
    return {
      WEB: web,
      iOS: `ndMetrics.${camel(id)}`,
      ANDROID: `LocalNDMetrics.current.${camel(id)}`,
    };
  return { WEB: web };
}

const px = (v: Json): number => {
  if (!isObject(v) || typeof v["value"] !== "number")
    throw new Error("not a dimension");
  return v["unit"] === "rem" ? v["value"] * 16 : v["value"];
};

function valueOf(token: Token, set: TokenSet): Rgba | number | string {
  const v = token.$value;
  switch (token.$type) {
    case "color": {
      const c = colorOf(token, set);
      const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
      return { r: r4(c.r), g: r4(c.g), b: r4(c.b), a: r4(c.a) };
    }
    case "dimension":
      return px(v);
    case "number":
      // The token is 0-1 like CSS; a Figma opacity variable is a percentage.
      return OPACITY.test(token.id)
        ? Math.round(Number(v) * 1e4) / 100
        : Number(v);
    case "fontWeight":
      return Number(v);
    case "duration":
      return isObject(v) && typeof v["value"] === "number"
        ? v["unit"] === "s"
          ? v["value"] * 1000
          : v["value"]
        : 0;
    case "fontFamily": {
      const stack = Array.isArray(v) ? v : [v];
      // A CSS stack can start with the Latin face, whose missing glyphs fall through to the
      // script's face. Figma binds one family: use the manifest's script family when present.
      const spec = readJson(`${ROOT}fonts/families.json`);
      const families = Array.isArray(spec["families"]) ? spec["families"] : [];
      const family = families.find(
        (f) => isObject(f) && f["token"] === token.id,
      );
      const declared = isObject(family) ? family["family"] : undefined;
      const first =
        typeof declared === "string" && stack.includes(declared)
          ? declared
          : stack[0];
      if (typeof first !== "string") throw new Error(`${token.id}: no family`);
      return first;
    }
    default:
      throw new Error(`${token.id}: no Figma type for ${token.$type}`);
  }
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export interface FigmaLibrary {
  collections: FigmaCollection[];
  effectStyles: {
    name: string;
    token: string;
    description?: string;
    layers: {
      type: "DROP_SHADOW" | "INNER_SHADOW";
      color: Alias;
      offsetX: Alias;
      offsetY: Alias;
      radius: Alias;
      spread: Alias;
    }[];
  }[];
  textStyles: {
    name: string;
    role: string;
    description: string;
    fontFamily: Alias;
    fontWeight: Alias;
    fontStyle: string;
    fontSize: Alias & { scale: number };
    lineHeight: { unit: "PERCENT"; value: number };
    letterSpacing: { unit: "PERCENT"; value: number };
    textCase: "UPPER" | "ORIGINAL";
    scripts: {
      script: string;
      fontFamily: Alias;
      tracking: boolean;
      textCase: boolean;
    }[];
  }[];
}

/** IBM Plex style names in Figma for a weight. */
const STYLE: Record<number, string> = {
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
};

export function figmaLibrary(model: Model): FigmaLibrary {
  const at = (input: Input = {}): TokenSet => model.get(input);
  const themes = model.themes.map((t) => t.id);
  const directions = model.registry.directions;
  const platforms = model.modifier("platform").contexts;
  const densities = model.modifier("density").contexts;
  const motions = model.modifier("motion").contexts;

  const collection = (
    name: string,
    modes: { id: string; name: string }[],
    defaultMode: string,
    modifier?: string,
  ): FigmaCollection => ({
    name,
    ...(modifier ? { modifier } : {}),
    modes,
    defaultMode,
    variables: [],
  });
  const primitives = collection(
    "Primitives",
    [{ id: "value", name: "Value" }],
    "value",
  );
  const theme = collection(
    "Theme",
    themes.map((id) => ({ id, name: title(id) })),
    model.defaults["theme"] ?? "dark",
    "theme",
  );
  const direction = collection(
    "Direction",
    directions.map((d) => ({ id: d.id, name: d.name })),
    model.defaults["direction"] ?? "dev",
    "direction",
  );
  const platform = collection(
    "Platform",
    platforms.map((id) => ({ id, name: title(id) })),
    model.defaults["platform"] ?? "web",
    "platform",
  );
  const density = collection(
    "Density",
    densities.map((id) => ({ id, name: title(id) })),
    model.defaults["density"] ?? "comfortable",
    "density",
  );
  const motion = collection(
    "Motion",
    motions.map((id) => ({ id, name: title(id) })),
    model.defaults["motion"] ?? "standard",
    "motion",
  );
  const component = collection(
    "Component",
    [{ id: "value", name: "Value" }],
    "value",
  );
  const home: Record<string, FigmaCollection> = {
    foundation: primitives,
    theme,
    platform,
    density,
    motion,
    component,
  };

  const included = model.ids.filter((id) => {
    const type = at()[id]?.$type ?? "";
    return !SKIP.some((r) => r.test(id)) && type in TYPES;
  });
  const placed = new Set(included);
  const aliasTo = (target: string): Alias => {
    const owner = model.owner.get(target) ?? "foundation";
    const c = home[owner];
    if (!c) throw new Error(`figma: ${target} has no collection`);
    return { alias: { collection: c.name, name: figmaName(target) } };
  };
  /** A public alias the library can express: no modifier on the token, a target it carries. */
  const exactAlias = (token: Token): Alias | null =>
    token.aliasOf && placed.has(token.aliasOf) && !isObject(nd(token)["modify"])
      ? aliasTo(token.aliasOf)
      : null;
  const variable = (
    id: string,
    type: string,
    valuesByMode: Record<string, Value>,
    description?: string,
  ): FigmaVariable => ({
    name: figmaName(id),
    token: id,
    type: TYPES[type] ?? "STRING",
    ...(description ? { description } : {}),
    scopes: scopesOf(id, type),
    codeSyntax: codeSyntaxOf(id, type),
    valuesByMode,
  });
  const helper = (
    c: FigmaCollection,
    name: string,
    type: string,
    valuesByMode: Record<string, Value>,
  ): Alias => {
    c.variables.push({
      name,
      type: TYPES[type] ?? "STRING",
      scopes: [],
      hiddenFromPublishing: true,
      valuesByMode,
    });
    return { alias: { collection: c.name, name } };
  };

  for (const id of included) {
    const owner = model.owner.get(id) ?? "foundation";
    const base = at()[id];
    if (!base) continue;
    const type = base.$type;
    const description = base.$description;
    if (owner === "foundation") {
      for (const m of model.modifiers)
        for (const ctx of m.contexts) {
          const s = at({ [m.name]: ctx });
          const t = s[id];
          if (!t || !same(valueOf(t, s), valueOf(base, at())))
            throw new Error(
              `figma: foundation token ${id} varies with ${m.name}`,
            );
        }
      primitives.variables.push(
        variable(
          id,
          type,
          { value: exactAlias(base) ?? valueOf(base, at()) },
          description,
        ),
      );
    } else if (owner === "theme") {
      const values: Record<string, Value> = {};
      for (const th of themes) {
        const s = at({ theme: th });
        const t = s[id];
        if (!t) throw new Error(`figma: ${id} missing in ${th}`);
        const alias = exactAlias(t);
        const perDirection = Object.fromEntries(
          directions.map((d) => {
            const ds = at({ theme: th, direction: d.id });
            const dt = ds[id];
            if (!dt) throw new Error(`figma: ${id} missing in ${th}/${d.id}`);
            return [d.id, valueOf(dt, ds)];
          }),
        );
        const varies = Object.values(perDirection).some(
          (v) => !same(v, valueOf(t, s)),
        );
        values[th] =
          alias ??
          (varies
            ? helper(direction, `${th}/${figmaName(id)}`, type, perDirection)
            : valueOf(t, s));
      }
      theme.variables.push(variable(id, type, values, description));
    } else if (owner === "platform") {
      platform.variables.push(
        variable(
          id,
          type,
          Object.fromEntries(
            platforms.map((p) => {
              const s = at({ platform: p });
              const t = s[id];
              if (!t) throw new Error(`figma: ${id} missing on ${p}`);
              return [p, exactAlias(t) ?? valueOf(t, s)];
            }),
          ),
          description,
        ),
      );
    } else if (owner === "density") {
      const values: Record<string, Value> = {};
      for (const c of densities) {
        const perPlatform = Object.fromEntries(
          platforms.map((p) => {
            const s = at({ platform: p, density: c });
            const t = s[id];
            if (!t) throw new Error(`figma: ${id} missing on ${p}/${c}`);
            return [p, valueOf(t, s)];
          }),
        );
        values[c] = helper(
          platform,
          `${c}/${figmaName(id)}`,
          type,
          perPlatform,
        );
      }
      density.variables.push(variable(id, type, values, description));
    } else if (owner === "motion") {
      motion.variables.push(
        variable(
          id,
          type,
          Object.fromEntries(
            motions.map((m) => {
              const s = at({ motion: m });
              const t = s[id];
              if (!t) throw new Error(`figma: ${id} missing in ${m}`);
              return [m, valueOf(t, s)];
            }),
          ),
          description,
        ),
      );
    } else if (owner === "component") {
      // An alias of a semantic variable (it follows the frame's modes) or a constant.
      const alias = exactAlias(base);
      if (!alias && base.aliasOf)
        throw new Error(
          `figma: ${id} aliases ${base.aliasOf}, which the library leaves out`,
        );
      component.variables.push(
        variable(
          id,
          type,
          { value: alias ?? valueOf(base, at()) },
          description,
        ),
      );
    } else throw new Error(`figma: ${id} is owned by ${owner}`);
  }

  // Shadows: each layer's colour, offsets, blur and spread are theme variables an effect style binds.
  const effectStyles: FigmaLibrary["effectStyles"] = [];
  for (const id of model.ids.filter((x) => at()[x]?.$type === "shadow")) {
    const layersOf = (th: string): Json[] => {
      const v = at({ theme: th })[id]?.$value;
      return (Array.isArray(v) ? v : [v]).filter(isObject);
    };
    const count = layersOf(themes[0] ?? "dark").length;
    if (themes.some((th) => layersOf(th).length !== count))
      throw new Error(
        `figma: ${id} has a different number of layers per theme`,
      );
    const layers: FigmaLibrary["effectStyles"][number]["layers"] = [];
    for (let i = 0; i < count; i++) {
      const prefix =
        count === 1 ? figmaName(id) : `${figmaName(id)}/${String(i + 1)}`;
      const part = (key: string, type: "color" | "dimension"): Alias => {
        const values = Object.fromEntries(
          themes.map((th) => {
            const l = layersOf(th)[i];
            const v = isObject(l) ? (l[key] ?? null) : null;
            if (type === "dimension") return [th, px(v)];
            const t: Token = { id: `${id}.${key}`, $type: "color", $value: v };
            return [th, valueOf(t, at({ theme: th }))];
          }),
        );
        theme.variables.push({
          name: `${prefix}/${key}`,
          type: type === "color" ? "COLOR" : "FLOAT",
          scopes: [type === "color" ? "EFFECT_COLOR" : "EFFECT_FLOAT"],
          valuesByMode: values,
        });
        return { alias: { collection: theme.name, name: `${prefix}/${key}` } };
      };
      const first = layersOf(themes[0] ?? "dark")[i];
      layers.push({
        type:
          isObject(first) && first["inset"] === true
            ? "INNER_SHADOW"
            : "DROP_SHADOW",
        color: part("color", "color"),
        offsetX: part("offsetX", "dimension"),
        offsetY: part("offsetY", "dimension"),
        radius: part("blur", "dimension"),
        spread: part("spread", "dimension"),
      });
    }
    const description = at()[id]?.$description;
    effectStyles.push({
      name: title(figmaName(id)),
      token: id,
      ...(description ? { description } : {}),
      layers,
    });
  }

  const kit = readTextStyles(model);
  const textStyles: FigmaLibrary["textStyles"] = kit.styles.map((s) => {
    const weight = Number(at()[s.weight]?.$value);
    return {
      name: s.id.length <= 2 ? s.id.toUpperCase() : title(s.id),
      role: s.id,
      description: s.description,
      fontFamily: aliasTo(s.family),
      fontWeight: aliasTo(s.weight),
      fontStyle: STYLE[weight] ?? "Regular",
      fontSize: { ...aliasTo(s.size), scale: s.scale },
      lineHeight: {
        unit: "PERCENT",
        value: Math.round(Number(at()[s.leading]?.$value) * 1000) / 10,
      },
      letterSpacing: {
        unit: "PERCENT",
        value: Math.round(Number(at()[s.tracking]?.$value) * 1000) / 10,
      },
      textCase: s.upper ? "UPPER" : "ORIGINAL",
      scripts: kit.scripts.map((sc) => ({
        script: sc.id,
        fontFamily: aliasTo(s.family === "font.sans" ? sc.family : s.family),
        tracking: sc.tracking,
        textCase: sc.case,
      })),
    };
  });

  return {
    collections: [
      primitives,
      theme,
      direction,
      platform,
      density,
      motion,
      component,
    ],
    effectStyles,
    textStyles,
  };
}

export function emitFigma(model: Model): Map<string, string> {
  const library = figmaLibrary(model);
  const doc = {
    $description:
      "The NDDev Figma library as data: variable collections (modes mirror the token resolver), effect styles and text styles bound to the variables. Generated by nddev-design-system; the library file is built from this, never edited by hand.",
    ...library,
  };
  return new Map([["variables.json", `${JSON.stringify(doc, null, 2)}\n`]]);
}
