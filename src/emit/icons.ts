// The icon and brand packages: the icons as standalone SVG files with their origins and licences
// (packages/icons), the brand mark and each direction's icon in one light-first style that follows
// the browser's scheme (packages/brand, the same files the site serves as favicons), and the web listing the site
// inlines (packages/web/icons.json).
import { readFileSync } from "node:fs";
import { contrast } from "../color.ts";
import { ROOT, TOKENS, isObject, readJson, type Json } from "../dtcg.ts";
import type { Icon, Vector } from "../icons.ts";
import type { Model } from "../model.ts";
import { colorOf } from "./native.ts";

const hexOf = (v: Json | undefined, where: string): string => {
  const value = isObject(v) ? v["$value"] : undefined;
  if (!isObject(value) || typeof value["hex"] !== "string")
    throw new Error(`${where}: no hex`);
  return value["hex"].toUpperCase();
};

/** The rasters a product draws from each direction icon (sizes in px). */
export const RASTERS = {
  icon: [192, 180],
  favicon: [16, 32, 48],
  card: { width: 1200, height: 630, mark: 300 },
} as const;

export function emitIcons(icons: Icon[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const i of icons)
    out.set(
      `svg/${i.name}.svg`,
      readFileSync(`${ROOT}icons/svg/${i.name}.svg`, "utf8"),
    );
  out.set(
    "icons.json",
    `${JSON.stringify(
      {
        $description:
          'The NDDev icons: geometry only (paths, currentColor; the root has fill="none"), each with its origin set, licence and the Figma frame it comes from.',
        icons: Object.fromEntries(
          icons.map((i) => [
            i.name,
            { viewBox: i.viewBoxText, source: i.source, license: i.license },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  return out;
}

export function emitWebIcons(icons: Icon[], mark: Vector): string {
  return `${JSON.stringify(
    {
      $description:
        'Icons and the brand mark to inline: an icon is <svg viewBox fill="none" aria-hidden="true">{body}</svg>, the mark <svg viewBox fill="currentColor">{body}</svg>.',
      icons: Object.fromEntries(
        icons.map((i) => [i.name, { viewBox: i.viewBoxText, body: i.body }]),
      ),
      brand: { viewBox: mark.viewBoxText, body: mark.body },
    },
    null,
    2,
  )}\n`;
}

/** One icon style of a theme: the tile and the mark on it. */
export interface BrandTile {
  background: string;
  mark: string;
}

/**
 * Per direction: the brand seed and one icon style per scheme. Every direction uses the same tile:
 * light (the main theme) by default and dark where the browser asks for it. The mark is the
 * direction's seed wherever it holds 3:1 on the tile (WCAG 1.4.11); otherwise that theme's
 * accent.heading, the role the derivation gates for large text and graphics (AI's green and
 * OpenNetwork's yellow would vanish on the light tile, Dev's blue on the dark one).
 */
export function brandColors(
  model: Model,
): { direction: string; color: string; light: BrandTile; dark: BrandTile }[] {
  const file = readJson(`${TOKENS}intent/brand.tokens.json`);
  const seeds = file["brand"];
  const backgrounds = file["brand-icon-background"];
  if (!isObject(seeds) || !isObject(backgrounds))
    throw new Error("brand intent");
  const hex = (r: number, g: number, b: number): string =>
    `#${[r, g, b]
      .map((x) =>
        Math.round(x * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`.toUpperCase();
  const tile = (
    scheme: "light" | "dark",
    direction: string,
    seed: string,
  ): BrandTile => {
    const background = hexOf(
      backgrounds[scheme],
      `brand-icon-background.${scheme}`,
    );
    if (contrast(seed, background) >= 3) return { background, mark: seed };
    const set = model.get({ theme: scheme, direction });
    const token = set["accent.heading"];
    if (!token)
      throw new Error(`brand: no accent.heading in ${scheme}/${direction}`);
    const c = colorOf(token, set);
    const mark = hex(c.r, c.g, c.b);
    if (contrast(mark, background) < 3)
      throw new Error(
        `brand: ${direction} mark ${mark} on ${background} is below 3:1`,
      );
    return { background, mark };
  };
  return model.registry.directions.map((d) => {
    const color = hexOf(seeds[d.id], `brand.${d.id}`);
    return {
      direction: d.id,
      color,
      light: tile("light", d.id, color),
      dark: tile("dark", d.id, color),
    };
  });
}

export function emitBrand(model: Model, mark: Vector): Map<string, string> {
  const out = new Map<string, string>();
  out.set("mark.svg", readFileSync(`${ROOT}brand/nddev.svg`, "utf8"));
  const [, , w, h] = mark.viewBox;
  // A square tile around the mark: 20 units of margin, corners of 28 (the site's favicon).
  const side = Math.round((Math.max(w, h) + 40) * 100) / 100;
  const colors = brandColors(model);
  const box = `viewBox="-20 -20 ${String(side)} ${String(side)}"`;
  const rect = `x="-20" y="-20" width="${String(side)}" height="${String(side)}" rx="28"`;
  for (const c of colors) {
    // The favicon and the site's direction icon: light by default, dark when the browser's scheme
    // is dark (browsers that ignore the media query, and every raster, use the light tile).
    out.set(
      `icons/${c.direction}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" ${box}><style>.t{fill:${c.light.background}}.m{fill:${c.light.mark}}@media (prefers-color-scheme:dark){.t{fill:${c.dark.background}}.m{fill:${c.dark.mark}}}</style><rect class="t" ${rect}/><g class="m">${mark.body}</g></svg>\n`,
    );
    for (const scheme of ["light", "dark"] as const)
      out.set(
        `icons/${c.direction}-${scheme}.svg`,
        `<svg xmlns="http://www.w3.org/2000/svg" ${box} fill="${c[scheme].mark}"><rect ${rect} fill="${c[scheme].background}"/>${mark.body}</svg>\n`,
      );
  }
  out.set(
    "brand.json",
    `${JSON.stringify(
      {
        $description:
          "The NDDev brand: the owner's mark (mark.svg, never redrawn), each direction's seed colour and its icon in one style for every direction: light by default (the main theme), dark under prefers-color-scheme: dark; the mark is the seed where it holds 3:1 on the tile, otherwise that theme's accent.heading. Rasters (touch icons, ICO, cards) are drawn from the light icon.",
        mark: { file: "mark.svg", viewBox: mark.viewBoxText },
        directions: Object.fromEntries(
          colors.map((c) => [
            c.direction,
            {
              color: c.color,
              background: c.light.background,
              icon: `icons/${c.direction}.svg`,
              light: { ...c.light, icon: `icons/${c.direction}-light.svg` },
              dark: { ...c.dark, icon: `icons/${c.direction}-dark.svg` },
            },
          ]),
        ),
        rasters: RASTERS,
      },
      null,
      2,
    )}\n`,
  );
  return out;
}
