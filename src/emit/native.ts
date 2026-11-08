// The data native emitters share (Swift, Kotlin, Dart, Rust, Figma): every public token resolved for
// the contexts native code chooses at run time — colours per theme and direction, dimensions per
// platform and density, durations per motion — with web-only values left out (compositions the
// web draws in CSS, fluid sizes, breakpoints). A colour's ai.nddev.modify (alpha, or a mix in sRGB
// or OKLab, as CSS color-mix computes it) is applied, so native colours equal what the web shows.
import { isObject, type Json } from "../dtcg.ts";
import { readFonts } from "../fonts.ts";
import { readBrandMark, readIcons, type Icon, type Vector } from "../icons.ts";
import { readTextStyles } from "../kit.ts";
import {
  nd,
  type Input,
  type Model,
  type Token,
  type TokenSet,
} from "../model.ts";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ShadowLayer {
  color: Rgba;
  x: number;
  y: number;
  blur: number;
  spread: number;
  inset: boolean;
}

export interface NativeTokens {
  themes: { id: string; scheme: "dark" | "light" }[];
  directions: { id: string; name: string }[];
  platforms: string[];
  densities: string[];
  motions: string[];
  colors: {
    id: string;
    description?: string;
    values: Record<string, Record<string, Rgba>>;
  }[];
  dimensions: {
    id: string;
    description?: string;
    values: Record<string, Record<string, number>>;
  }[];
  numbers: { id: string; description?: string; value: number; unit?: string }[];
  durations: { id: string; values: Record<string, number> }[];
  easings: {
    id: string;
    description?: string;
    value: [number, number, number, number];
  }[];
  fonts: { id: string; values: Record<string, string[]> }[];
  weights: { id: string; value: number }[];
  shadows: {
    id: string;
    description?: string;
    values: Record<string, ShadowLayer[]>;
  }[];
  /** The kit's text styles (kit/text-styles.json) with their tokens resolved per platform. */
  type: {
    role: string;
    description: string;
    family: string;
    sizes: Record<string, number>;
    leading: number;
    weight: number;
    /** Letter spacing as a share of the size (em). */
    tracking: number;
    upper: boolean;
    body: boolean;
    dynamicType?: string;
    material?: string;
  }[];
  /** Per script: the family that replaces font.sans, whether tracking and case apply, body leading. */
  scripts: {
    id: string;
    family: string;
    tracking: boolean;
    case: boolean;
    bodyLeading?: number;
  }[];
  /** The families native packages bundle (TTF files under each package's font directory). */
  bundled: {
    family: string;
    token: string;
    files: { file: string; weight: number; postScriptName: string }[];
  }[];
  /** The licence file bundled with them. */
  fontLicense: string;
  /** The icons and the brand mark as vector geometry. */
  icons: Icon[];
  mark: Vector;
  /** The kit's component tokens: an alias of a native value (a computed property), or a constant. */
  components: {
    id: string;
    type: "color" | "dimension" | "shadow" | "number";
    target?: string;
    value?: number;
  }[];
}

/** Platforms native code targets (the web has its own CSS). */
export const NATIVE_PLATFORMS = ["ios", "android", "desktop"];

const WEB_ONLY = [
  /^breakpoint\./,
  /^(container-max|gutter|section-space)$/,
  /^measure(\.|$)/,
];

// --- colour maths for modifiers ---------------------------------------------------------------
const toLin = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLin = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
function toOklab({ r, g, b }: Rgba): [number, number, number] {
  const [R, G, B] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, A, B]: [number, number, number], a: number): Rgba {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const clamp = (x: number): number => Math.min(1, Math.max(0, fromLin(x)));
  return {
    r: clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a,
  };
}

/** CSS color-mix(in <space>, a (1 - t), b t) with premultiplied alpha. */
export function mixColors(
  a: Rgba,
  b: Rgba,
  t: number,
  space: "srgb" | "oklab",
): Rgba {
  const alpha = a.a * (1 - t) + b.a * t;
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  if (space === "srgb") {
    const ch = (x: number, y: number): number =>
      (x * a.a * (1 - t) + y * b.a * t) / alpha;
    return { r: ch(a.r, b.r), g: ch(a.g, b.g), b: ch(a.b, b.b), a: alpha };
  }
  const [la, aa, ba] = toOklab(a);
  const [lb, ab, bb] = toOklab(b);
  const ch = (x: number, y: number): number =>
    (x * a.a * (1 - t) + y * b.a * t) / alpha;
  return fromOklab([ch(la, lb), ch(aa, ab), ch(ba, bb)], alpha);
}

export function rgbaOf(v: Json, where: string): Rgba {
  if (!isObject(v) || typeof v["hex"] !== "string")
    throw new Error(`${where}: not a colour`);
  const h = v["hex"].slice(1);
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(h.slice(i, i + 2), 16) / 255,
  ) as [number, number, number];
  return { r, g, b, a: typeof v["alpha"] === "number" ? v["alpha"] : 1 };
}

/** The colour a token shows, its modifier applied. */
export function colorOf(token: Token, set: TokenSet): Rgba {
  const base = rgbaOf(token.$value, token.id);
  const modify = nd(token)["modify"];
  if (!isObject(modify)) return base;
  if (typeof modify["alpha"] === "number")
    return { ...base, a: base.a * modify["alpha"] };
  const m = modify["mix"];
  if (isObject(m) && typeof m["amount"] === "number") {
    const w = m["with"];
    const other =
      typeof w === "string" && /^\{.+\}$/.test(w)
        ? colorOf(set[w.slice(1, -1)] ?? token, set)
        : rgbaOf(w ?? null, `${token.id} mix`);
    return mixColors(
      base,
      other,
      m["amount"],
      m["space"] === "oklab" ? "oklab" : "srgb",
    );
  }
  return base;
}

const px = (v: Json): number => {
  if (!isObject(v) || typeof v["value"] !== "number")
    throw new Error("not a dimension");
  return v["unit"] === "rem" ? v["value"] * 16 : v["value"];
};

export function nativeTokens(model: Model): NativeTokens {
  const themes = model.themes.map((t) => ({ id: t.id, scheme: t.scheme }));
  const directions = model.registry.directions;
  const densities = model.modifier("density").contexts;
  const motions = model.modifier("motion").contexts;
  const at = (input: Input): TokenSet => model.get(input);
  const ids = model.ids.filter(
    (id) =>
      !WEB_ONLY.some((r) => r.test(id)) && model.owner.get(id) !== "component",
  );
  const typeOf = (id: string): string => at({})[id]?.$type ?? "";
  const desc = (id: string): { description?: string } => {
    const d = at({})[id]?.$description;
    return d ? { description: d } : {};
  };

  const colors = ids
    .filter((id) => typeOf(id) === "color")
    .map((id) => ({
      id,
      ...desc(id),
      values: Object.fromEntries(
        themes.map((t) => [
          t.id,
          Object.fromEntries(
            directions.map((d) => {
              const set = at({ theme: t.id, direction: d.id });
              const token = set[id];
              if (!token) throw new Error(`${id} missing`);
              return [d.id, colorOf(token, set)];
            }),
          ),
        ]),
      ),
    }));
  const dimensions = ids
    .filter((id) => typeOf(id) === "dimension" && !id.startsWith("text-size."))
    .map((id) => ({
      id,
      ...desc(id),
      values: Object.fromEntries(
        NATIVE_PLATFORMS.map((p) => [
          p,
          Object.fromEntries(
            densities.map((c) => [
              c,
              px(at({ platform: p, density: c })[id]?.$value ?? null),
            ]),
          ),
        ]),
      ),
    }));
  const numbers = ids
    .filter((id) => typeOf(id) === "number")
    .map((id) => {
      const t = at({})[id];
      const unit = nd(t)["unit"];
      return {
        id,
        ...desc(id),
        value: typeof t?.$value === "number" ? t.$value : 0,
        ...(typeof unit === "string" ? { unit } : {}),
      };
    });
  const durations = ids
    .filter((id) => typeOf(id) === "duration")
    .map((id) => ({
      id,
      values: Object.fromEntries(
        motions.map((m) => {
          const v = at({ motion: m })[id]?.$value;
          const ms =
            isObject(v) && typeof v["value"] === "number"
              ? v["unit"] === "s"
                ? v["value"] * 1000
                : v["value"]
              : 0;
          return [m, ms];
        }),
      ),
    }));
  const easings = ids
    .filter((id) => typeOf(id) === "cubicBezier")
    .map((id) => ({
      id,
      ...desc(id),
      value: at({})[id]?.$value as [number, number, number, number],
    }));
  const fonts = ids
    .filter((id) => typeOf(id) === "fontFamily")
    .map((id) => ({
      id,
      values: Object.fromEntries(
        NATIVE_PLATFORMS.map((p) => {
          const v = at({ platform: p })[id]?.$value;
          return [
            p,
            (Array.isArray(v) ? v : [v]).filter(
              (f): f is string => typeof f === "string",
            ),
          ];
        }),
      ),
    }));
  const weights = ids
    .filter((id) => typeOf(id) === "fontWeight")
    .map((id) => ({ id, value: Number(at({})[id]?.$value) }));
  const shadows = ids
    .filter((id) => typeOf(id) === "shadow")
    .map((id) => ({
      id,
      ...desc(id),
      values: Object.fromEntries(
        themes.map((t) => {
          const v = at({ theme: t.id })[id]?.$value;
          const layers = (Array.isArray(v) ? v : [v])
            .filter(isObject)
            .map((l) => ({
              color: rgbaOf(l["color"] ?? null, id),
              x: px(l["offsetX"] ?? null),
              y: px(l["offsetY"] ?? null),
              blur: px(l["blur"] ?? null),
              spread: px(l["spread"] ?? null),
              inset: l["inset"] === true,
            }));
          return [t.id, layers];
        }),
      ),
    }));
  const kit = readTextStyles(model);
  const num = (id: string): number => Number(at({})[id]?.$value);
  const type = kit.styles.map((s) => {
    const ios = at({ platform: "ios" })[s.size];
    const android = at({ platform: "android" })[s.size];
    const dynamicType = nd(ios)["dynamic-type"];
    const material = nd(android)["material"];
    return {
      role: s.id,
      description: s.description,
      family: s.family,
      sizes: Object.fromEntries(
        NATIVE_PLATFORMS.map((p) => [
          p,
          px(at({ platform: p })[s.size]?.$value ?? null) * s.scale,
        ]),
      ),
      leading: num(s.leading),
      weight: num(s.weight),
      tracking: num(s.tracking),
      upper: s.upper,
      body: s.body,
      ...(typeof dynamicType === "string" ? { dynamicType } : {}),
      ...(typeof material === "string" ? { material } : {}),
    };
  });
  const scripts = kit.scripts.map((s) => ({
    id: s.id,
    family: s.family,
    tracking: s.tracking,
    case: s.case,
    ...(s.bodyLeading ? { bodyLeading: num(s.bodyLeading) } : {}),
  }));
  const families = readFonts(model).families;
  const bundled = families.flatMap((f) =>
    f.native
      ? [
          {
            family: f.family,
            token: f.token,
            files: f.native.files.map(({ file, weight, postScriptName }) => ({
              file,
              weight,
              postScriptName,
            })),
          },
        ]
      : [],
  );
  const fontLicense =
    families.find((f) => f.native)?.native?.license.file ?? "";
  return {
    themes,
    directions,
    platforms: NATIVE_PLATFORMS,
    densities,
    motions,
    colors,
    dimensions,
    numbers,
    durations,
    easings,
    fonts,
    weights,
    shadows,
    type,
    scripts,
    bundled,
    fontLicense,
    icons: readIcons(),
    mark: readBrandMark(),
    components: model.ids
      .filter((id) => model.owner.get(id) === "component")
      .flatMap((id): NativeTokens["components"] => {
        const t = at({})[id];
        const type = t?.$type;
        if (
          type !== "color" &&
          type !== "dimension" &&
          type !== "shadow" &&
          type !== "number"
        )
          return [];
        if (t?.aliasOf) {
          if (!ids.includes(t.aliasOf))
            throw new Error(`${id}: {${t.aliasOf}} has no native value`);
          return [{ id, type, target: t.aliasOf }];
        }
        if (type === "dimension")
          return [{ id, type, value: px(t?.$value ?? null) }];
        if (type === "number") return [{ id, type, value: Number(t?.$value) }];
        throw new Error(`${id}: a ${type} constant has no native form`);
      }),
  };
}

/** lowerCamelCase of a token path: accent.on-fill -> accentOnFill, radius.2xl -> radius2xl. */
export function camel(id: string): string {
  const parts = id.split(/[.-]/).filter(Boolean);
  return parts
    .map((p, i) =>
      i === 0
        ? p.toLowerCase()
        : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
    )
    .join("");
}

/** UpperCamelCase (types, enum cases where a language wants them). */
export const pascal = (id: string): string => {
  const c = camel(id);
  return c.charAt(0).toUpperCase() + c.slice(1);
};

/** SCREAMING_SNAKE_CASE (Rust constants). */
export const screaming = (id: string): string =>
  id.replace(/[.-]/g, "_").toUpperCase();

export const fixed = (n: number, digits = 4): string => {
  const s = Number(n.toFixed(digits)).toString();
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
};

export const hex8 = ({ r, g, b, a }: Rgba): string =>
  [a, r, g, b]
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase(),
    )
    .join("");
