// The UI kit's authored compositions of tokens (kit/). Each entry names tokens by id; loading checks
// that every name is a public token of the expected type, so a renamed token cannot leave a style
// pointing at nothing.
import { readdirSync } from "node:fs";
import { ROOT, isObject, readJson, type Json } from "./dtcg.ts";
import type { Model } from "./model.ts";

export interface TextStyle {
  id: string;
  description: string;
  family: string;
  size: string;
  leading: string;
  weight: string;
  tracking: string;
  /** Upper-case where the script has case. */
  upper: boolean;
  /** Running text: takes a script's body leading. */
  body: boolean;
  /** A share of the size (code is set a little smaller than its neighbours). */
  scale: number;
  /** How the web breaks its lines: a heading balances them, running text avoids a lone last word. */
  wrap?: "balance" | "pretty";
}

export interface Script {
  id: string;
  /** BCP 47 language subtags written in this script. */
  languages: string[];
  family: string;
  tracking: boolean;
  case: boolean;
  bodyLeading?: string;
}

export interface TextStyles {
  scripts: Script[];
  styles: TextStyle[];
}

const KIT = `${ROOT}kit/`;

const str = (o: Record<string, Json>, k: string, where: string): string => {
  const v = o[k];
  if (typeof v !== "string")
    throw new Error(`${where}: ${k} must be a token id`);
  return v;
};

export function readTextStyles(model: Model): TextStyles {
  const file = readJson(`${KIT}text-styles.json`);
  const at = model.get({});
  const expect = (id: string, type: string, where: string): string => {
    const t = at[id];
    if (!t || !model.owner.has(id))
      throw new Error(`${where}: no public token ${id}`);
    if (t.$type !== type)
      throw new Error(`${where}: ${id} is ${t.$type}, not ${type}`);
    return id;
  };
  const scriptsJson = file["scripts"];
  const stylesJson = file["styles"];
  if (!isObject(scriptsJson) || !isObject(stylesJson))
    throw new Error("kit/text-styles.json");
  const scripts: Script[] = Object.entries(scriptsJson)
    .filter(([k]) => !k.startsWith("$"))
    .map(([id, v]) => {
      const where = `text-styles scripts.${id}`;
      if (!isObject(v)) throw new Error(where);
      const languages = v["languages"];
      if (
        !Array.isArray(languages) ||
        !languages.every((l) => typeof l === "string" && /^[a-z]{2,3}$/.test(l))
      )
        throw new Error(`${where}: languages`);
      const s: Script = {
        id,
        languages: languages as string[],
        family: expect(str(v, "family", where), "fontFamily", where),
        tracking: v["tracking"] === true,
        case: v["case"] === true,
      };
      if (typeof v["body-leading"] === "string")
        s.bodyLeading = expect(v["body-leading"], "number", where);
      return s;
    });
  const styles: TextStyle[] = Object.entries(stylesJson)
    .filter(([k]) => !k.startsWith("$"))
    .map(([id, v]) => {
      const where = `text-styles styles.${id}`;
      if (!isObject(v)) throw new Error(where);
      const scale = v["scale"] ?? 1;
      if (typeof scale !== "number" || scale <= 0 || scale > 2)
        throw new Error(`${where}: scale`);
      if (v["case"] !== undefined && v["case"] !== "upper")
        throw new Error(`${where}: case`);
      const wrap = v["wrap"];
      if (wrap !== undefined && wrap !== "balance" && wrap !== "pretty")
        throw new Error(`${where}: wrap must be balance or pretty`);
      return {
        id,
        description:
          typeof v["$description"] === "string" ? v["$description"] : "",
        family: expect(str(v, "family", where), "fontFamily", where),
        size: expect(str(v, "size", where), "dimension", where),
        leading: expect(str(v, "leading", where), "number", where),
        weight: expect(str(v, "weight", where), "fontWeight", where),
        tracking: expect(str(v, "tracking", where), "number", where),
        upper: v["case"] === "upper",
        body: v["body"] === true,
        scale,
        ...(wrap === undefined ? {} : { wrap }),
      };
    });
  return { scripts, styles };
}

// --- components -------------------------------------------------------------------------------

/** The WCAG 2.2 success criteria the kit cites, with their level. */
export const WCAG: Record<
  string,
  { title: string; level: "A" | "AA" | "AAA" }
> = {
  "1.1.1": { title: "Non-text Content", level: "A" },
  "1.3.1": { title: "Info and Relationships", level: "A" },
  "1.3.5": { title: "Identify Input Purpose", level: "AA" },
  "1.4.1": { title: "Use of Color", level: "A" },
  "1.4.3": { title: "Contrast (Minimum)", level: "AA" },
  "1.4.10": { title: "Reflow", level: "AA" },
  "1.4.11": { title: "Non-text Contrast", level: "AA" },
  "1.4.13": { title: "Content on Hover or Focus", level: "AA" },
  "2.1.1": { title: "Keyboard", level: "A" },
  "2.1.2": { title: "No Keyboard Trap", level: "A" },
  "2.2.1": { title: "Timing Adjustable", level: "A" },
  "2.2.2": { title: "Pause, Stop, Hide", level: "A" },
  "2.3.3": { title: "Animation from Interactions", level: "AAA" },
  "2.4.1": { title: "Bypass Blocks", level: "A" },
  "2.4.3": { title: "Focus Order", level: "A" },
  "2.4.4": { title: "Link Purpose (In Context)", level: "A" },
  "2.4.6": { title: "Headings and Labels", level: "AA" },
  "2.4.7": { title: "Focus Visible", level: "AA" },
  "2.4.8": { title: "Location", level: "AAA" },
  "2.4.11": { title: "Focus Not Obscured (Minimum)", level: "AA" },
  "2.4.13": { title: "Focus Appearance", level: "AAA" },
  "2.5.3": { title: "Label in Name", level: "A" },
  "2.5.7": { title: "Dragging Movements", level: "AA" },
  "2.5.8": { title: "Target Size (Minimum)", level: "AA" },
  "3.3.1": { title: "Error Identification", level: "A" },
  "3.3.2": { title: "Labels or Instructions", level: "A" },
  "3.3.3": { title: "Error Suggestion", level: "AA" },
  "4.1.2": { title: "Name, Role, Value", level: "A" },
  "4.1.3": { title: "Status Messages", level: "AA" },
};

/** The WAI-ARIA Authoring Practices patterns (https://www.w3.org/WAI/ARIA/apg/patterns/). */
export const APG = new Set([
  "accordion",
  "alert",
  "alertdialog",
  "breadcrumb",
  "button",
  "carousel",
  "checkbox",
  "combobox",
  "dialog-modal",
  "disclosure",
  "feed",
  "grid",
  "landmarks",
  "link",
  "listbox",
  "menubar",
  "menu-button",
  "meter",
  "radio",
  "slider",
  "slider-multithumb",
  "spinbutton",
  "switch",
  "table",
  "tabs",
  "toolbar",
  "tooltip",
  "treeview",
  "treegrid",
  "windowsplitter",
]);

const CATEGORIES = [
  "action",
  "input",
  "selection",
  "navigation",
  "container",
  "feedback",
  "data",
];
const STATUSES = ["implemented", "specified"] as const;
const PLATFORMS = ["web", "ios", "android", "flutter"] as const;

export interface Component {
  id: string;
  name: string;
  category: string;
  status: (typeof STATUSES)[number];
  summary: string;
  figma: string[];
  pattern: { apg?: string; html: string };
  tokens?: string;
  textStyle?: string;
  anatomy: { part: string; required: boolean; description: string }[];
  variants: { id: string; description: string }[];
  sizes: string[];
  states: string[];
  cues: Record<string, string>;
  keyboard: { keys: string; action: string }[];
  a11y: { role: string; name: string; notes: string[]; wcag: string[] };
  platforms: Record<(typeof PLATFORMS)[number], string>;
  web?: { class: string; modifiers: string[] };
  /** Colour pairs the component draws, each to meet its ratio in every theme and direction. */
  contrast: { fg: string; bg: string; min: number }[];
}

type Raw = { [K in keyof Component]?: Component[K] };

export function readComponents(model: Model): Component[] {
  const dir = `${KIT}components/`;
  const styles = new Set(readTextStyles(model).styles.map((s) => s.id));
  const groups = new Set(
    model.ids
      .filter((id) => model.owner.get(id) === "component")
      .map((id) => id.split(".")[0] ?? id),
  );
  const at = model.get({});
  const used = new Set<string>();
  const components = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f): Component => {
      const id = f.slice(0, -".json".length);
      const where = `kit/components/${f}`;
      const c = readJson(`${dir}${f}`) as Raw;
      const need: (ok: unknown, what: string) => asserts ok = (ok, what) => {
        if (!ok) throw new Error(`${where}: ${what}`);
      };
      const {
        name,
        category,
        status,
        summary,
        pattern,
        anatomy,
        variants,
        states,
      } = c;
      const { keyboard, a11y, platforms } = c;
      need(typeof name === "string" && name, "name");
      need(
        category && CATEGORIES.includes(category),
        `category ${category ?? ""}`,
      );
      need(
        status && (STATUSES as readonly string[]).includes(status),
        `status ${status ?? ""}`,
      );
      need(typeof summary === "string" && summary, "summary");
      need(pattern && typeof pattern.html === "string", "pattern.html");
      if (pattern.apg !== undefined)
        need(APG.has(pattern.apg), `unknown APG pattern ${pattern.apg}`);
      if (c.tokens !== undefined) {
        need(groups.has(c.tokens), `no component tokens ${c.tokens}`);
        used.add(c.tokens);
      }
      if (c.textStyle !== undefined)
        need(styles.has(c.textStyle), `no text style ${c.textStyle}`);
      need(
        Array.isArray(anatomy) && anatomy.some((p) => p.required),
        "a required anatomy part",
      );
      need(Array.isArray(variants) && variants.length, "variants");
      need(Array.isArray(states) && states.length, "states");
      const cues = c.cues ?? {};
      for (const k of Object.keys(cues))
        need(states.includes(k), `cue for unknown state ${k}`);
      need(Array.isArray(keyboard), "keyboard");
      if (states.includes("focus-visible") && category !== "feedback")
        need(keyboard.length, "a focusable component documents its keys");
      need(
        a11y && typeof a11y.role === "string" && Array.isArray(a11y.wcag),
        "a11y",
      );
      for (const sc of a11y.wcag)
        need(sc in WCAG, `unknown WCAG criterion ${sc}`);
      need(platforms, "platforms");
      for (const p of PLATFORMS)
        need(typeof platforms[p] === "string", `platforms.${p}`);
      if (status === "implemented")
        need(c.web?.class, "an implemented component names its web class");
      const contrast = c.contrast ?? [];
      for (const p of contrast) {
        for (const x of [p.fg, p.bg])
          need(
            at[x]?.$type === "color" && model.owner.has(x),
            `contrast: ${x} is no public colour`,
          );
        need([3, 4.5, 7].includes(p.min), `contrast: target ${String(p.min)}`);
      }
      return {
        ...c,
        id,
        name,
        category,
        status,
        summary,
        pattern,
        anatomy,
        variants,
        states,
        keyboard,
        platforms,
        figma: c.figma ?? [],
        sizes: c.sizes ?? [],
        cues,
        contrast,
        a11y: { ...a11y, notes: Array.isArray(a11y.notes) ? a11y.notes : [] },
      };
    });
  for (const g of groups)
    if (!used.has(g))
      throw new Error(
        `tokens/component/${g}.tokens.json: no component spec uses it`,
      );
  return components;
}
