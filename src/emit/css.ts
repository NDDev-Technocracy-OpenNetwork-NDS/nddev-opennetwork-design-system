// CSS custom properties for web and webview (desktop) consumers. A token's property is `--` + its
// path joined with "-" ($root dropped). Aliases stay var() references so a page can see where a
// value comes from; a value the web draws as a composition (ai.nddev.css) is written verbatim.
//
// Every modifier is a data attribute on any element: data-direction, data-theme, data-platform
// (web and desktop), data-density, data-motion; the default contexts are :root. A custom property
// resolves var() where it is declared, so the scope of a context repeats every property whose value
// depends on that modifier, through aliases too; a theme with a direction, and a platform with a
// density, also get combined scopes (on one element or the first around the second). Reduced motion
// also follows prefers-reduced-motion unless the page says data-motion="standard".
import { isObject, type Json } from "../dtcg.ts";
import {
  nd,
  type Input,
  type Model,
  type Token,
  type TokenSet,
} from "../model.ts";

export const cssName = (id: string): string => `--${id.replaceAll(".", "-")}`;

/** Groups other platforms read but CSS has no use for (a media query cannot read a property). */
const NOT_CSS = [/^breakpoint\./, /^spring\./];
export const inCss = (id: string): boolean => !NOT_CSS.some((r) => r.test(id));

const ATTRIBUTE: Record<string, string> = {
  direction: "data-direction",
  theme: "data-theme",
  platform: "data-platform",
  density: "data-density",
  motion: "data-motion",
};

const num = (n: number): string => String(Number(n.toFixed(4)));

function colorCss(v: Json): string {
  if (!isObject(v) || typeof v["hex"] !== "string")
    throw new Error(`not a colour: ${JSON.stringify(v)}`);
  const alpha = typeof v["alpha"] === "number" ? v["alpha"] : 1;
  if (alpha === 1) return v["hex"].toUpperCase();
  const h = v["hex"].slice(1);
  if (alpha === 0 && h === "000000") return "transparent";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r} ${g} ${b} / ${num(alpha)})`;
}

function dimension(v: Json): string {
  if (
    !isObject(v) ||
    typeof v["value"] !== "number" ||
    typeof v["unit"] !== "string"
  )
    throw new Error(`not a dimension: ${JSON.stringify(v)}`);
  return `${num(v["value"])}${v["unit"]}`;
}

const toPx = (v: Json): number => {
  if (!isObject(v) || typeof v["value"] !== "number")
    throw new Error("not a dimension");
  return v["unit"] === "rem" ? v["value"] * 16 : v["value"];
};

/** clamp() from a minimum at the low viewport to the maximum at the high one, linear between. */
export function fluid(
  minPx: number,
  maxPx: number,
  [vMin, vMax]: [number, number],
): string {
  const slope = (maxPx - minPx) / (vMax - vMin);
  const intercept = minPx - slope * vMin;
  const rem = (px: number): number => Number((px / 16).toFixed(4));
  return `clamp(${rem(minPx)}rem, ${rem(intercept)}rem + ${Number((slope * 100).toFixed(4))}vw, ${rem(maxPx)}rem)`;
}

const family = (f: string): string =>
  /^-?[A-Za-z][A-Za-z0-9-]*$/.test(f) ? f : `'${f.replaceAll("'", "\\'")}'`;

/** The literal CSS of a resolved value. */
export function literal(token: Token): string {
  const v = token.$value;
  switch (token.$type) {
    case "color":
      return colorCss(v);
    case "dimension": {
      const f = nd(token)["fluid"];
      if (
        isObject(f) &&
        f["min"] !== undefined &&
        Array.isArray(f["viewport"])
      ) {
        const [a, b] = f["viewport"] as [number, number];
        return fluid(toPx(f["min"]), toPx(v), [a, b]);
      }
      return dimension(v);
    }
    case "number":
    case "fontWeight": {
      if (typeof v === "string") return v;
      if (typeof v !== "number") throw new Error(`${token.id}: not a number`);
      const unit = nd(token)["unit"];
      return `${num(v)}${typeof unit === "string" && v !== 0 ? unit : ""}`;
    }
    case "duration":
      return dimension(v);
    case "cubicBezier":
      if (!Array.isArray(v)) throw new Error("not a cubic bezier");
      return `cubic-bezier(${v.map((n) => num(n as number)).join(", ")})`;
    case "fontFamily": {
      const list = (Array.isArray(v) ? v : [v]).filter(
        (f): f is string => typeof f === "string",
      );
      return list.map(family).join(", ");
    }
    case "shadow": {
      const layers = Array.isArray(v) ? v : [v];
      return layers
        .map((s) => {
          if (!isObject(s)) throw new Error("not a shadow");
          const d = (k: string): string => dimension(s[k] ?? null);
          const inset = s["inset"] === true ? "inset " : "";
          return `${inset}${d("offsetX")} ${d("offsetY")} ${d("blur")} ${d("spread")} ${colorCss(s["color"] ?? null)}`;
        })
        .join(", ");
    }
    case "gradient": {
      if (!Array.isArray(v)) throw new Error("not a gradient");
      const stops = v.map((s) =>
        isObject(s)
          ? `${colorCss(s["color"] ?? null)} ${num(Number(s["position"]) * 100)}%`
          : "",
      );
      return `linear-gradient(180deg, ${stops.join(", ")})`;
    }
    default:
      throw new Error(`${token.id}: no CSS for type ${token.$type}`);
  }
}

/** The declared CSS of a token: verbatim web composition, a var() alias, or its literal. */
export function declared(
  token: Token,
  isPublic: (id: string) => boolean,
): string {
  const css = nd(token)["css"];
  if (typeof css === "string") return css;
  const original = token.originalValue?.$value;
  if (typeof original === "string" && /^\{[^}]+\}$/.test(original)) {
    const target = original.slice(1, -1);
    if (isPublic(target)) return `var(${cssName(target)})`;
  }
  return literal(token);
}

const block = (selector: string, lines: string[], indent = ""): string[] =>
  lines.length
    ? [
        `${indent}${selector} {`,
        ...lines.map((l) => `${indent}  ${l}`),
        `${indent}}`,
        "",
      ]
    : [];

const sel = (modifier: string, context: string): string =>
  `[${ATTRIBUTE[modifier] ?? modifier}='${context}']`;
const both = (outer: string, inner: string): string =>
  `${outer}${inner},\n${outer} ${inner}`;
const media = (query: string, lines: string[]): string[] => [
  `@media ${query} {`,
  ...lines.slice(0, -1).map((l) => (l ? `  ${l.replaceAll("\n", "\n  ")}` : l)),
  "}",
  "",
];

export function emitCss(model: Model): string {
  const cssIds = model.ids.filter(inCss);
  const publicIds = new Set(model.ids);
  const isPublic = (id: string): boolean => publicIds.has(id);
  const at = (input: Input): TokenSet => model.get(input);
  const decl = (set: TokenSet, id: string): string => {
    const token = set[id];
    if (!token) throw new Error(`token ${id} missing`);
    return declared(token, isPublic);
  };
  const cssPlatforms = model.registry.platforms?.css ?? [
    model.defaults["platform"] ?? "web",
  ];
  const contexts = (name: string): string[] =>
    model
      .modifier(name)
      .contexts.filter((c) => name !== "platform" || cssPlatforms.includes(c));

  // Probes: the defaults, and each single other context, so a value that changes with this
  // modifier only under another one (a direction under the light theme) is still found.
  const probes = (except: string): Input[] => [
    {},
    ...model.modifiers
      .filter((m) => m.name !== except)
      .flatMap((m) =>
        m.contexts.filter((c) => c !== m.default).map((c) => ({ [m.name]: c })),
      ),
  ];
  const depends = new Map<string, Set<string>>(
    cssIds.map((id) => [id, new Set<string>()]),
  );
  for (const m of model.modifiers)
    for (const probe of probes(m.name)) {
      const base = at(probe);
      for (const c of m.contexts.filter((x) => x !== m.default)) {
        const other = at({ ...probe, [m.name]: c });
        for (const id of cssIds)
          if (
            JSON.stringify(base[id]?.$value) !==
            JSON.stringify(other[id]?.$value)
          )
            depends.get(id)?.add(m.name);
      }
    }
  // Through var(): a property naming another depends on what that one depends on.
  const byName = new Map(cssIds.map((id) => [cssName(id), id]));
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of cssIds) {
      const mine = depends.get(id) ?? new Set<string>();
      const text = model.themes
        .map((t) => decl(at({ theme: t.id }), id))
        .join(" ");
      for (const ref of text.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
        const target = byName.get(ref[1] ?? "");
        for (const m of target ? (depends.get(target) ?? []) : [])
          if (!mine.has(m)) {
            mine.add(m);
            grew = true;
          }
      }
    }
  }
  const dependsOn = (name: string): string[] =>
    cssIds.filter((id) => depends.get(id)?.has(name));
  const lines = (input: Input, ids: string[]): string[] => {
    const set = at(input);
    return ids.map((id) => `${cssName(id)}: ${decl(set, id)};`);
  };

  const theme0 = model.defaults["theme"] ?? "";
  const platform0 = model.defaults["platform"] ?? "";
  const motion0 = model.defaults["motion"] ?? "";
  const scheme = (t: string): string =>
    `color-scheme: ${model.themes.find((x) => x.id === t)?.scheme ?? "dark"};`;
  const owned = (owner: string): string[] =>
    cssIds.filter((id) => model.owner.get(id) === owner);
  const themeIds = owned("theme");
  // Component tokens are declared once, on the root and on every scope: a var() is computed on the
  // element that declares it, so each scope recomputes them from its own roles.
  const componentIds = owned("component");
  const rootIds = cssIds.filter(
    (id) => !["theme", "component"].includes(model.owner.get(id) ?? ""),
  );
  const scoped = (ids: string[]): string[] =>
    ids.filter((id) => model.owner.get(id) !== "component");
  const directional = scoped(dependsOn("direction"));
  const platformal = scoped(dependsOn("platform"));
  const dense = scoped(dependsOn("density"));
  const moving = scoped(dependsOn("motion"));
  const others = (name: string, first: string): string[] =>
    contexts(name).filter((c) => c !== first);
  // A descendant selector alone also sees older, intervening contexts. Native scopes stop at
  // the next declaration of the same modifier; equal specificity then lets the nearest scope
  // win. Emit both orders so changing a theme retains its inherited direction, and changing a
  // platform retains its inherited density. The flat selectors remain the older-engine fallback.
  const pairedScopes = (
    outer: string,
    inner: string,
    ids: string[],
  ): string[] =>
    contexts(outer).flatMap((a) => [
      `@scope (${sel(outer, a)}) to ([${ATTRIBUTE[outer] ?? outer}]) {`,
      ...contexts(inner).flatMap((b) =>
        block(
          `:scope${sel(inner, b)},\n:scope ${sel(inner, b)}`,
          lines({ [outer]: a, [inner]: b }, ids),
          "  ",
        ),
      ),
      "}",
      "",
    ]);

  /** The media queries a root without data-theme answers, each with the theme it takes. */
  const deviceThemes = (): [string, string][] => {
    const { system, contrast, defaultChoice } = model.registry.themes;
    if (defaultChoice !== "system") return [];
    const out: [string, string][] = [];
    const known = (t: string | undefined): t is string =>
      t !== undefined && model.themes.some((x) => x.id === t);
    // The root theme's scheme is the default; the other scheme is the one a device asks for.
    const rootScheme =
      model.themes.find((x) => x.id === theme0)?.scheme ?? "light";
    const other = rootScheme === "light" ? "dark" : "light";
    if (known(system[other]) && system[other] !== theme0)
      out.push([`(prefers-color-scheme: ${other})`, system[other]]);
    if (known(contrast?.[rootScheme]))
      out.push(["(prefers-contrast: more)", contrast[rootScheme]]);
    if (known(contrast?.[other]))
      out.push([
        `(prefers-contrast: more) and (prefers-color-scheme: ${other})`,
        contrast[other],
      ]);
    return out;
  };

  const out: string[] = [
    "/* GENERATED by nddev-opennetwork-design-system (`just generate`) from tokens/. Do not edit. */",
    `/* Defaults on :root: ${model.modifiers.map((m) => `${m.name} ${m.default}`).join(", ")}.`,
    "   Contexts: data-direction, data-theme, data-platform (web, desktop), data-density and",
    "   data-motion on any element; a direction inside or on a theme scope takes that theme's accent. */",
    "",
    "@layer tokens {",
    ...block(`:root,\n${sel("theme", theme0)}`, [
      scheme(theme0),
      ...lines({}, themeIds),
    ]),
    ...block(":root", lines({}, rootIds)),
    ...others("theme", theme0).flatMap((t) =>
      block(sel("theme", t), [scheme(t), ...lines({ theme: t }, themeIds)]),
    ),
    ...contexts("direction").flatMap((d) => [
      ...block(sel("direction", d), lines({ direction: d }, directional)),
      ...others("theme", theme0).flatMap((t) =>
        block(
          both(sel("theme", t), sel("direction", d)),
          lines({ theme: t, direction: d }, directional),
        ),
      ),
    ]),
    ...contexts("platform").flatMap((p) =>
      block(sel("platform", p), lines({ platform: p }, platformal)),
    ),
    ...contexts("density").flatMap((c) => [
      ...block(sel("density", c), lines({ density: c }, dense)),
      ...others("platform", platform0).flatMap((p) =>
        block(
          both(sel("platform", p), sel("density", c)),
          lines({ platform: p, density: c }, dense),
        ),
      ),
    ]),
    ...contexts("motion").flatMap((m) =>
      block(sel("motion", m), lines({ motion: m }, moving)),
    ),
    ...block(
      [
        ":root",
        ...model.modifiers.map((m) => `[${ATTRIBUTE[m.name] ?? m.name}]`),
      ].join(",\n"),
      lines({}, componentIds),
    ),
    ...pairedScopes("theme", "direction", directional),
    ...pairedScopes("direction", "theme", directional),
    ...pairedScopes("platform", "density", dense),
    ...pairedScopes("density", "platform", dense),
    // A root no script gave a theme follows the device, as the default choice "system" does:
    // its scheme picks themes.system, a request for more contrast themes.contrast (light and more
    // contrast: the last block wins). The direction scopes take that theme's accents (`:where`
    // keeps a direction block's specificity, so the later rule wins), and a scope of the root
    // theme inside keeps its own (the last block, once for every query).
    ...deviceThemes().flatMap(([query, t]) =>
      media(query, [
        ...block(":root:not([data-theme])", [
          scheme(t),
          ...lines({ theme: t }, themeIds),
        ]),
        ...contexts("direction").flatMap((d) =>
          block(
            `:where(:root:not([data-theme])) ${sel("direction", d)},\n:root:not([data-theme])${sel("direction", d)}`,
            lines({ theme: t, direction: d }, directional),
          ),
        ),
      ]),
    ),
    ...(deviceThemes().length
      ? media(
          deviceThemes()
            .map(([query]) => query)
            .filter((q) => !q.includes(" and "))
            .join(", "),
          contexts("direction").flatMap((d) =>
            block(
              both(sel("theme", theme0), sel("direction", d)),
              lines({ theme: theme0, direction: d }, directional),
            ),
          ),
        )
      : []),
    ...(others("motion", motion0).includes("reduced")
      ? [
          "@media (prefers-reduced-motion: reduce) {",
          ...block(
            `:root:not(${sel("motion", motion0)})`,
            lines({ motion: "reduced" }, moving),
            "  ",
          ).slice(0, -1),
          "}",
          "",
        ]
      : []),
    "}",
  ];
  return `${out.join("\n").replace(/\n\n\}$/, "\n}")}\n`;
}
