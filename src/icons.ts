// Icons (icons/svg/*.svg with icons/icons.json) and the brand mark (brand/nddev.svg) as geometry
// every platform can draw. The sources are a strict SVG subset — a root with a viewBox and `path`
// or `polygon` children with presentation attributes — so nothing a renderer would interpret
// differently gets in; path data is parsed into absolute move, line, cubic and close segments.
import { readFileSync, readdirSync } from "node:fs";
import { ROOT, isObject, readJson } from "./dtcg.ts";

export type Segment =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | {
      op: "C";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x: number;
      y: number;
    }
  | { op: "Z" };

export interface Shape {
  /** The path data as written (polygons as M/L/Z). */
  d: string;
  segments: Segment[];
  fill: "currentColor" | "none";
  evenOdd: boolean;
  stroke: "currentColor" | "none";
  strokeWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
}

export interface Vector {
  name: string;
  viewBox: [number, number, number, number];
  /** The viewBox as written. */
  viewBoxText: string;
  /** The SVG's children as written: the site inlines it into its own <svg>. */
  body: string;
  shapes: Shape[];
}

export interface Icon extends Vector {
  source: string;
  license: string;
}

const ATTRS = new Set([
  "d",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "fill-rule",
  "clip-rule",
]);

/** Path data to absolute segments: M/m, L/l, H/h, V/v, C/c, Z/z (what the sources use). */
export function parsePath(d: string, where: string): Segment[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: Segment[] = [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const num = (): number => {
    const t = tokens[i++];
    const v = Number(t);
    if (t === undefined || Number.isNaN(v))
      throw new Error(`${where}: bad path data near ${String(t)}`);
    return v;
  };
  const isNum = (): boolean =>
    i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i] ?? "");
  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++] ?? "";
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case "M": {
        x = num() + (rel ? x : 0);
        y = num() + (rel ? y : 0);
        sx = x;
        sy = y;
        out.push({ op: "M", x, y });
        cmd = rel ? "l" : "L"; // further pairs are lines
        break;
      }
      case "L":
        x = num() + (rel ? x : 0);
        y = num() + (rel ? y : 0);
        out.push({ op: "L", x, y });
        break;
      case "H":
        x = num() + (rel ? x : 0);
        out.push({ op: "L", x, y });
        break;
      case "V":
        y = num() + (rel ? y : 0);
        out.push({ op: "L", x, y });
        break;
      case "C": {
        const [ox, oy] = rel ? [x, y] : [0, 0];
        const x1 = num() + ox;
        const y1 = num() + oy;
        const x2 = num() + ox;
        const y2 = num() + oy;
        x = num() + ox;
        y = num() + oy;
        out.push({ op: "C", x1, y1, x2, y2, x, y });
        break;
      }
      case "Z":
        out.push({ op: "Z" });
        x = sx;
        y = sy;
        break;
      default:
        throw new Error(
          `${where}: path command ${cmd} is not supported (src/icons.ts)`,
        );
    }
  }
  return out;
}

function attrsOf(tag: string, where: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tag.matchAll(/\s([a-zA-Z:-]+)="([^"]*)"/g)) {
    const [, k, v] = m;
    if (!k || v === undefined) continue;
    attrs.set(k, v);
  }
  return new Map([...attrs].filter(([k]) => k !== "xmlns" || where === "root"));
}

function parseSvg(name: string, text: string): Vector {
  const root = /^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(text.trim());
  if (!root) throw new Error(`${name}: not a single <svg> element`);
  const rootAttrs = attrsOf(root[1] ?? "", "root");
  const vb = (rootAttrs.get("viewBox") ?? "").split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => Number.isNaN(n)))
    throw new Error(`${name}: the root needs a viewBox`);
  const inheritedFill = rootAttrs.get("fill") ?? "currentColor";
  const body = (root[2] ?? "").trim();
  const shapes: Shape[] = [];
  const rest = body.replace(
    /<(path|polygon)\b([^>]*)\/>/g,
    (_, tag: string, raw: string) => {
      const a = attrsOf(raw, name);
      for (const k of a.keys())
        if (!ATTRS.has(k))
          throw new Error(`${name}: attribute ${k} is not allowed on <${tag}>`);
      const d =
        tag === "path"
          ? (a.get("d") ?? "")
          : (() => {
              const pts = (a.get("points") ?? "")
                .trim()
                .split(/[\s,]+/)
                .map(Number);
              if (pts.length < 4 || pts.length % 2)
                throw new Error(`${name}: bad polygon points`);
              const pairs = Array.from(
                { length: pts.length / 2 },
                (_, i) => `${String(pts[2 * i])} ${String(pts[2 * i + 1])}`,
              );
              return `M${pairs.join("L")}Z`;
            })();
      const fill = a.get("fill") ?? inheritedFill;
      const stroke = a.get("stroke") ?? "none";
      for (const [k, v] of [
        ["fill", fill],
        ["stroke", stroke],
      ] as const)
        if (v !== "currentColor" && v !== "none")
          throw new Error(
            `${name}: ${k} must be currentColor or none, not ${v}`,
          );
      const cap = a.get("stroke-linecap") ?? "butt";
      const join = a.get("stroke-linejoin") ?? "miter";
      if (!["butt", "round", "square"].includes(cap))
        throw new Error(`${name}: linecap ${cap}`);
      if (!["miter", "round", "bevel"].includes(join))
        throw new Error(`${name}: linejoin ${join}`);
      shapes.push({
        d,
        segments: parsePath(d, name),
        fill: fill as Shape["fill"],
        evenOdd: a.get("fill-rule") === "evenodd",
        stroke: stroke as Shape["stroke"],
        strokeWidth: Number(a.get("stroke-width") ?? 1),
        lineCap: cap as Shape["lineCap"],
        lineJoin: join as Shape["lineJoin"],
      });
      return "";
    },
  );
  if (rest.trim())
    throw new Error(
      `${name}: only <path> and <polygon> are allowed, found ${rest.trim().slice(0, 40)}`,
    );
  if (!shapes.length) throw new Error(`${name}: no shapes`);
  return {
    name,
    viewBox: vb as Vector["viewBox"],
    viewBoxText: rootAttrs.get("viewBox") ?? "",
    body,
    shapes,
  };
}

export function readIcons(): Icon[] {
  const meta = readJson(`${ROOT}icons/icons.json`)["icons"];
  if (!isObject(meta)) throw new Error("icons/icons.json: icons");
  const files = readdirSync(`${ROOT}icons/svg`).filter((f) =>
    f.endsWith(".svg"),
  );
  const names = files.map((f) => f.slice(0, -4)).sort();
  const listed = Object.keys(meta).sort();
  if (names.join() !== listed.join())
    throw new Error(
      `icons: svg files (${names.join(", ")}) and icons.json (${listed.join(", ")}) differ`,
    );
  return Object.keys(meta).map((name) => {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`icons: name ${name}`);
    const m = meta[name];
    if (!isObject(m)) throw new Error(`icons.json ${name}`);
    const str = (k: string): string => {
      const v = m[k];
      if (typeof v !== "string" || !v)
        throw new Error(`icons.json ${name}: ${k}`);
      return v;
    };
    return {
      ...parseSvg(name, readFileSync(`${ROOT}icons/svg/${name}.svg`, "utf8")),
      source: str("source"),
      license: str("license"),
    };
  });
}

/** The owner's mark: three polygons, drawn in the direction's colour. */
export function readBrandMark(): Vector {
  return parseSvg("nddev", readFileSync(`${ROOT}brand/nddev.svg`, "utf8"));
}
