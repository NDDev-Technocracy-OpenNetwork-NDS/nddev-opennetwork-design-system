// Colour maths of the derivation: sRGB <-> OKLCH, WCAG 2.x contrast, sRGB mixing, and a lightness
// search that keeps a hue while meeting a contrast target. Ported unchanged from the site's
// generator (nddev-platform-web scripts/lib/color.mjs), so every derived colour stays identical.

export type Rgb = [number, number, number];
export interface Oklch {
  L: number;
  C: number;
  h: number;
}

/** `#rgb` or `#rrggbb` to sRGB components 0..1. */
export function parseHex(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, "").toLowerCase();
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/.test(h)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}

/** sRGB components 0..1 to lowercase `#rrggbb`, clamped and rounded to 8 bits. */
export function toHex(rgb: readonly number[]): string {
  return (
    "#" +
    rgb
      .map((c) =>
        Math.round(Math.min(1, Math.max(0, c)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

const toLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLinear = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** OKLCH of an sRGB hex (hue in radians). */
export function toOklch(hex: string): Oklch {
  const [r, g, b] = parseHex(hex).map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

function oklchToLinear({ L, C, h }: Oklch): Rgb {
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: Rgb): boolean =>
  rgb.every((c) => c >= -1e-9 && c <= 1 + 1e-9);

/** OKLCH to sRGB hex; an out-of-gamut colour loses chroma, never hue or lightness. */
export function fromOklch(lch: Oklch): string {
  let { C } = lch;
  let lin = oklchToLinear({ ...lch, C });
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 32; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...lch, C: mid }))) lo = mid;
      else hi = mid;
    }
    C = lo;
    lin = oklchToLinear({ ...lch, C });
  }
  return toHex(lin.map(fromLinear));
}

/**
 * Move a colour's lightness one way in small steps until `pass` holds, keeping hue and chroma
 * (gamut-limited). A colour that already passes is returned unchanged (lowercased); `null` when no
 * lightness passes.
 */
export function shiftUntil(
  hex: string,
  direction: "lighter" | "darker",
  pass: (candidate: string) => boolean,
): string | null {
  const start = toOklch(hex);
  if (pass(hex)) return hex.toLowerCase();
  const step = direction === "lighter" ? 0.004 : -0.004;
  for (let L = start.L + step; L >= 0 && L <= 1; L += step) {
    const candidate = fromOklch({ ...start, L });
    if (pass(candidate)) return candidate;
  }
  return null;
}

/** sRGB (gamma-encoded) mix: `amount` of `top` over `base`. */
export function mix(base: string, top: string, amount: number): string {
  const a = parseHex(base);
  const b = parseHex(top);
  return toHex(a.map((c, i) => c * (1 - amount) + (b[i] ?? 0) * amount));
}

/** Move OKLCH lightness by `dL`, clamped to 0..1. */
export function nudge(hex: string, dL: number): string {
  const c = toOklch(hex);
  return fromOklch({ ...c, L: Math.min(1, Math.max(0, c.L + dL)) });
}

/** The colour-vision deficiencies a categorical palette is checked against. */
export type Vision = "normal" | "deuteranopia" | "protanopia" | "tritanopia";

// Machado, Oliveira & Fernandes (2009), severity 1.0, applied to linear sRGB.
const CVD: Record<Exclude<Vision, "normal">, readonly (readonly number[])[]> = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** The colour as seen with a full colour-vision deficiency (Machado 2009). */
export function simulateVision(hex: string, vision: Vision): string {
  if (vision === "normal") return toHex(parseHex(hex));
  const lin = parseHex(hex).map(toLinear);
  const m = CVD[vision];
  return toHex(
    m.map((row) =>
      fromLinear(row.reduce((s, k, i) => s + k * (lin[i] ?? 0), 0)),
    ),
  );
}

/** CIE L*a*b* (D65) of an sRGB hex. */
export function toLab(hex: string): Rgb {
  const [r, g, b] = parseHex(hex).map(toLinear) as Rgb;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIEDE2000 colour difference of two L*a*b* colours (Sharma, Wu & Dalal 2005). */
export function deltaE2000Lab(lab1: Rgb, lab2: Rgb): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number): number =>
    b === 0 && a === 0 ? 0 : (((Math.atan2(b, a) / rad) % 360) + 360) % 360;
  const h1 = hue(b1, a1p);
  const h2 = hue(b2, a2p);
  const dL = L2 - L1;
  const dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hb = h1 + h2;
  if (C1p * C2p !== 0)
    hb =
      Math.abs(h1 - h2) <= 180
        ? hb / 2
        : hb < 360
          ? (hb + 360) / 2
          : (hb - 360) / 2;
  const T =
    1 -
    0.17 * Math.cos((hb - 30) * rad) +
    0.24 * Math.cos(2 * hb * rad) +
    0.32 * Math.cos((3 * hb + 6) * rad) -
    0.2 * Math.cos((4 * hb - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Cbp7 = Cbp ** 7;
  const RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt(
    (dL / SL) ** 2 +
      (dC / SC) ** 2 +
      (dH / SH) ** 2 +
      RT * (dC / SC) * (dH / SH),
  );
}

/** CIEDE2000 difference of two sRGB colours. */
export function deltaE2000(a: string, b: string): number {
  return deltaE2000Lab(toLab(a), toLab(b));
}
