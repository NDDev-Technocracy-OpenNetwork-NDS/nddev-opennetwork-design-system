// The font families (fonts/families.json): web files from the exact @fontsource packages (read from
// node_modules, each with its digest and unicode-range), native TTF files committed under
// fonts/files/ (each checked against its digest), and the metrics of a fallback face tuned so the
// swap from Arial to Plex moves a line as little as possible. Everything is checked against the
// tokens: a family serves a public fontFamily token, and the native stacks name a bundled family
// first, or a system face for a family that is not bundled.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as fontkit from "fontkit";
import { ROOT, isObject, readJson, type Json } from "./dtcg.ts";
import type { Model } from "./model.ts";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const FONTS = `${ROOT}fonts/`;
const MODULES = `${ROOT}node_modules/`;

export interface WebFile {
  file: string;
  weight: number;
  subset: string;
  bytes: number;
  sha256: string;
  unicodeRange: string;
}

export interface NativeFile {
  file: string;
  /** The face identifier embedded in the pinned font, not its display family or filename. */
  postScriptName: string;
  weight: number;
  bytes: number;
  sha256: string;
  data: Uint8Array;
}

export interface Family {
  family: string;
  token: string;
  scripts: string[];
  license: string;
  covers: string;
  web: {
    package: string;
    version: string;
    licenseSha256: string;
    source: string;
    files: WebFile[];
    /** Per script: the files its first view is set in, to preload. */
    preload: Record<string, string[]>;
    fallback?: string;
  };
  native?: {
    release: string;
    releaseSha256: string;
    license: { file: string; sha256: string; data: Uint8Array };
    files: NativeFile[];
  };
}

export interface Fallback {
  family: string;
  local: string[];
  sizeAdjust: number;
  ascentOverride: number;
  descentOverride: number;
  lineGapOverride: number;
}

export interface Fonts {
  families: Family[];
  fallback: Fallback | null;
}

const num = (v: Json | undefined, where: string): number => {
  if (typeof v !== "number") throw new Error(`${where}: not a number`);
  return v;
};
const str = (v: Json | undefined, where: string): string => {
  if (typeof v !== "string") throw new Error(`${where}: not a string`);
  return v;
};
const list = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : []);

/** `/* name *\/ @font-face { ... unicode-range: X; }` blocks of one weight's stylesheet. */
function blocks(css: string): { name: string; range: string }[] {
  const out: { name: string; range: string }[] = [];
  for (const m of css.matchAll(
    /\/\*\s*([^*]+?)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g,
  )) {
    const range = /unicode-range:\s*([^;]+);/.exec(m[2] ?? "")?.[1]?.trim();
    if (m[1] && range) out.push({ name: m[1], range });
  }
  return out;
}

function webFiles(spec: Record<string, Json>, where: string): Family["web"] {
  const pkgName = str(spec["package"], `${where}.package`);
  const dir = `${MODULES}${pkgName}/`;
  const pkg = readJson(`${dir}package.json`);
  const prefix = pkgName.replace(/^@fontsource\//, "");
  const subsets =
    spec["subsets"] === undefined ? null : list(spec["subsets"]).map(String);
  const slices = spec["slices"] === true;
  const files: WebFile[] = [];
  for (const w of list(spec["weights"])) {
    const weight = num(w, `${where}.weights`);
    for (const block of blocks(
      readFileSync(`${dir}${String(weight)}.css`, "utf8"),
    )) {
      const slice = /\[(\d+)\]/.exec(block.name);
      // `noto-sans-sc-[4]-400-normal` names a slice; its file drops the brackets.
      const file = `${slice ? block.name.replace(/\[(\d+)\]/, "$1") : block.name}.woff2`;
      const subset = slice
        ? `slice-${slice[1] ?? ""}`
        : block.name.replace(`${prefix}-`, "").replace(/-\d+-normal$/, "");
      if (subsets && !subsets.includes(subset)) continue;
      if (slices && !slice) continue;
      const bytes = readFileSync(`${dir}files/${file}`);
      files.push({
        file,
        weight,
        subset,
        bytes: bytes.length,
        sha256: sha256(bytes),
        unicodeRange: block.range,
      });
    }
  }
  files.sort(
    (a, b) =>
      a.weight - b.weight ||
      a.file.localeCompare(b.file, "en", { numeric: true }),
  );
  if (!files.length) throw new Error(`${where}: no web files in ${pkgName}`);
  const preload: Record<string, string[]> = {};
  const p = spec["preload"];
  if (isObject(p))
    for (const [script, rule] of Object.entries(p)) {
      if (!isObject(rule)) continue;
      const weights = list(rule["weights"]).map(Number);
      const subs = list(rule["subsets"]).map(String);
      preload[script] = files
        .filter((f) => weights.includes(f.weight) && subs.includes(f.subset))
        .map((f) => f.file);
      if (!preload[script].length)
        throw new Error(`${where}: preload ${script} names no file`);
    }
  return {
    package: pkgName,
    version: str(pkg["version"], `${pkgName} version`),
    licenseSha256: sha256(readFileSync(`${dir}LICENSE`)),
    source: str(pkg["homepage"], `${pkgName} homepage`),
    files,
    preload,
    ...(typeof spec["fallback"] === "string"
      ? { fallback: spec["fallback"] }
      : {}),
  };
}

function nativeFiles(
  spec: Record<string, Json>,
  where: string,
): NonNullable<Family["native"]> {
  const check = (file: string, want: string): Uint8Array => {
    const data = readFileSync(`${FONTS}files/${file}`);
    const got = sha256(data);
    if (got !== want)
      throw new Error(
        `${where}: fonts/files/${file} is ${got}, not ${want} (scripts/fetch-fonts.sh)`,
      );
    return data;
  };
  const lic = spec["license"];
  if (!isObject(lic)) throw new Error(`${where}: license`);
  const licFile = str(lic["file"], `${where}.license.file`);
  const licSha = str(lic["sha256"], `${where}.license.sha256`);
  return {
    release: str(spec["release"], `${where}.release`),
    releaseSha256: str(spec["releaseSha256"], `${where}.releaseSha256`),
    license: { file: licFile, sha256: licSha, data: check(licFile, licSha) },
    files: list(spec["files"]).map((f, i) => {
      if (!isObject(f)) throw new Error(`${where}.files[${String(i)}]`);
      const file = str(f["file"], `${where}.files[${String(i)}].file`);
      const want = str(f["sha256"], `${where}.files[${String(i)}].sha256`);
      const data = check(file, want);
      const parsed = fontkit.create(Buffer.from(data));
      if (
        !("postscriptName" in parsed) ||
        typeof parsed.postscriptName !== "string" ||
        !parsed.postscriptName.trim()
      )
        throw new Error(`${where}: ${file} has no single PostScript face name`);
      return {
        file,
        postScriptName: parsed.postscriptName,
        weight: num(f["weight"], `${file} weight`),
        bytes: data.length,
        sha256: want,
        data,
      };
    }),
  };
}

// Helvetica/Arial advance widths per 1000 em for a-z and space (the two are metric-identical), and
// English letter frequencies per 1000 letters: the fallback is scaled so a typical English line is
// as wide in Arial as in Plex; Cyrillic and other scripts are approximated.
const ARIAL: Record<string, number> = {
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
  " ": 278,
};
const FREQ: Record<string, number> = {
  e: 127,
  t: 91,
  a: 82,
  o: 75,
  i: 70,
  n: 67,
  s: 63,
  h: 61,
  r: 60,
  d: 43,
  l: 40,
  c: 28,
  u: 28,
  m: 24,
  w: 24,
  f: 22,
  g: 20,
  y: 20,
  p: 19,
  b: 15,
  v: 10,
  k: 8,
  j: 2,
  x: 2,
  q: 1,
  z: 1,
  " ": 180,
};

function fallbackOf(name: string, family: Family): Fallback {
  const latin = family.web.files.find(
    (f) => f.weight === 400 && f.subset === "latin",
  );
  if (!latin)
    throw new Error(
      `${family.family}: no latin 400 file for the fallback metrics`,
    );
  const font = fontkit.create(
    readFileSync(`${MODULES}${family.web.package}/files/${latin.file}`),
  ) as fontkit.Font;
  let plex = 0;
  let arial = 0;
  for (const [ch, f] of Object.entries(FREQ)) {
    plex +=
      f *
      (font.glyphForCodePoint(ch.codePointAt(0) ?? 32).advanceWidth /
        font.unitsPerEm);
    arial += f * ((ARIAL[ch] ?? 0) / 1000);
  }
  const sizeAdjust = plex / arial;
  const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
  return {
    family: name,
    local: ["Arial", "Liberation Sans", "Helvetica"],
    sizeAdjust: r4(sizeAdjust),
    // fontkit's ascent, descent and lineGap are the hhea table's.
    ascentOverride: r4(font.ascent / font.unitsPerEm / sizeAdjust),
    descentOverride: r4(Math.abs(font.descent) / font.unitsPerEm / sizeAdjust),
    lineGapOverride: r4(font.lineGap / font.unitsPerEm / sizeAdjust),
  };
}

export function readFonts(model: Model): Fonts {
  const spec = readJson(`${FONTS}families.json`);
  const families: Family[] = list(spec["families"]).map((f, i) => {
    const where = `fonts/families.json families[${String(i)}]`;
    if (!isObject(f) || !isObject(f["web"])) throw new Error(where);
    const family = str(f["family"], `${where}.family`);
    const token = str(f["token"], `${where}.token`);
    const t = model.get({})[token];
    if (!t || t.$type !== "fontFamily" || !model.owner.has(token))
      throw new Error(`${where}: ${token} is no public fontFamily token`);
    const native = isObject(f["native"])
      ? nativeFiles(f["native"], `${family} native`)
      : undefined;
    for (const p of model.modifier("platform").contexts) {
      const v = model.get({ platform: p })[token]?.$value;
      const stack = (Array.isArray(v) ? v : [v]).map(String);
      const css = (model.registry.platforms?.css ?? ["web"]).includes(p);
      if (
        css
          ? !stack.includes(family)
          : (stack[0] === family) !== Boolean(native)
      )
        throw new Error(
          css
            ? `${token} on ${p} does not name ${family}`
            : native
              ? `${token} on ${p} must name the bundled ${family} first`
              : `${token} on ${p} names ${family} first, which native packages do not bundle`,
        );
    }
    return {
      family,
      token,
      scripts: list(f["scripts"]).map(String),
      license: str(f["license"], `${where}.license`),
      covers: str(f["covers"], `${where}.covers`),
      web: webFiles(f["web"], `${family} web`),
      ...(native ? { native } : {}),
    };
  });
  const withFallback = families.find((f) => f.web.fallback);
  return {
    families,
    fallback:
      withFallback?.web.fallback !== undefined
        ? fallbackOf(withFallback.web.fallback, withFallback)
        : null,
  };
}

/** The manifest products read: families, files with digests, preloads, the fallback face. */
export function fontManifest(fonts: Fonts): string {
  const doc = {
    $description:
      "The fonts NDDev ships. Web: install the exact packages and serve these files (each checked by its SHA-256) with these unicode ranges; preload the files of a script's first view; declare the fallback face. Native: the TTF files in ttf/ (OFL-1.1, licence alongside), bundled by the native packages.",
    families: fonts.families.map((f) => ({
      family: f.family,
      token: f.token,
      scripts: f.scripts,
      license: f.license,
      covers: f.covers,
      web: {
        package: f.web.package,
        version: f.web.version,
        licenseSha256: f.web.licenseSha256,
        source: f.web.source,
        ...(f.web.fallback ? { fallback: f.web.fallback } : {}),
        preload: f.web.preload,
        files: f.web.files,
      },
      ...(f.native
        ? {
            native: {
              release: f.native.release,
              releaseSha256: f.native.releaseSha256,
              license: `ttf/${f.native.license.file}`,
              files: f.native.files.map((x) => ({
                file: `ttf/${x.file}`,
                postScriptName: x.postScriptName,
                weight: x.weight,
                bytes: x.bytes,
                sha256: x.sha256,
              })),
            },
          }
        : {}),
    })),
    fallback: fonts.fallback,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** The bundled native files, once each (the licence is shared). */
export function nativeFontFiles(fonts: Fonts): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const f of fonts.families) {
    if (!f.native) continue;
    out.set(f.native.license.file, f.native.license.data);
    for (const x of f.native.files) out.set(x.file, x.data);
  }
  return out;
}
