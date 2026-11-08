// Icons and the brand mark as native drawing code: each platform gets the geometry as its own
// values (SwiftUI path segments, Compose path data for ImageVector, Flutter path segments, Rust path
// data) and a view that fits the viewBox into the requested size, centred with its aspect kept,
// filled and stroked in the current colour as the site's inline SVG is.
import { fixed } from "./native.ts";
import type { Segment, Shape, Vector } from "../icons.ts";

export const n = (v: number): string => fixed(v, 5);

export function swiftVector(v: Vector): string {
  const [x, y, w, h] = v.viewBox;
  const seg = (s: Segment): string => {
    switch (s.op) {
      case "M":
        return `.move(${n(s.x)}, ${n(s.y)})`;
      case "L":
        return `.line(${n(s.x)}, ${n(s.y)})`;
      case "C":
        return `.curve(${[s.x1, s.y1, s.x2, s.y2, s.x, s.y].map(n).join(", ")})`;
      case "Z":
        return ".close";
    }
  };
  const shape = (sh: Shape): string =>
    `NDVectorShape(segments: [${sh.segments.map(seg).join(", ")}], fill: ${String(sh.fill === "currentColor")}, evenOdd: ${String(sh.evenOdd)}, stroke: ${String(sh.stroke === "currentColor")}, strokeWidth: ${n(sh.strokeWidth)}, lineCap: .${sh.lineCap}, lineJoin: .${sh.lineJoin})`;
  return `NDVector(minX: ${n(x)}, minY: ${n(y)}, width: ${n(w)}, height: ${n(h)}, shapes: [\n            ${v.shapes.map(shape).join(",\n            ")},\n        ])`;
}

export function kotlinVector(v: Vector): string {
  const [x, y, w, h] = v.viewBox;
  const shape = (sh: Shape): string =>
    `NDVectorShape(${JSON.stringify(sh.d)}, ${String(sh.fill === "currentColor")}, ${String(sh.evenOdd)}, ${String(sh.stroke === "currentColor")}, ${n(sh.strokeWidth)}f, NDLineCap.${sh.lineCap.charAt(0).toUpperCase()}${sh.lineCap.slice(1)}, NDLineJoin.${sh.lineJoin.charAt(0).toUpperCase()}${sh.lineJoin.slice(1)})`;
  return `NDVector(${n(x)}f, ${n(y)}f, ${n(w)}f, ${n(h)}f, listOf(\n            ${v.shapes.map(shape).join(",\n            ")},\n        ))`;
}

export function dartVector(v: Vector): string {
  const [x, y, w, h] = v.viewBox;
  const seg = (s: Segment): string => {
    switch (s.op) {
      case "M":
        return `NDSegment.move(${n(s.x)}, ${n(s.y)})`;
      case "L":
        return `NDSegment.line(${n(s.x)}, ${n(s.y)})`;
      case "C":
        return `NDSegment.curve(${[s.x1, s.y1, s.x2, s.y2, s.x, s.y].map(n).join(", ")})`;
      case "Z":
        return "NDSegment.close()";
    }
  };
  const shape = (sh: Shape): string =>
    `NDVectorShape([${sh.segments.map(seg).join(", ")}], fill: ${String(sh.fill === "currentColor")}, evenOdd: ${String(sh.evenOdd)}, stroke: ${String(sh.stroke === "currentColor")}, strokeWidth: ${n(sh.strokeWidth)}, lineCap: StrokeCap.${sh.lineCap}, lineJoin: StrokeJoin.${sh.lineJoin})`;
  return `NDVector(${n(x)}, ${n(y)}, ${n(w)}, ${n(h)}, [\n      ${v.shapes.map(shape).join(",\n      ")},\n    ])`;
}

export function rustVector(v: Vector): string {
  const [x, y, w, h] = v.viewBox;
  const cap = (c: string): string => c.charAt(0).toUpperCase() + c.slice(1);
  const shape = (sh: Shape): string =>
    `Shape { d: ${JSON.stringify(sh.d)}, fill: ${String(sh.fill === "currentColor")}, even_odd: ${String(sh.evenOdd)}, stroke: ${String(sh.stroke === "currentColor")}, stroke_width: ${n(sh.strokeWidth)}, line_cap: LineCap::${cap(sh.lineCap)}, line_join: LineJoin::${cap(sh.lineJoin)} }`;
  return `Vector { min_x: ${n(x)}, min_y: ${n(y)}, width: ${n(w)}, height: ${n(h)}, shapes: &[\n        ${v.shapes.map(shape).join(",\n        ")},\n    ] }`;
}
