import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { derive } from "../src/derive.ts";
import { color, TOKENS, isObject } from "../src/dtcg.ts";
import { loadModel } from "../src/model.ts";

describe("the resolved model", async () => {
  const model = await loadModel();
  it("has five orthogonal modifiers with their registry contexts", () => {
    expect(model.modifiers.map((m) => m.name)).toEqual([
      "direction",
      "theme",
      "platform",
      "density",
      "motion",
    ]);
    expect(model.modifier("theme").contexts).toEqual([
      "light",
      "dark",
      "light-contrast",
      "dark-contrast",
    ]);
    expect(model.modifier("platform").contexts).toEqual([
      "web",
      "desktop",
      "ios",
      "android",
    ]);
  });
  it("keeps private namespaces out of the public ids", () => {
    expect(
      model.ids.some(
        (id) => id.startsWith("accent-theme.") || id.startsWith("control."),
      ),
    ).toBe(false);
    expect(model.ids).toEqual(
      expect.arrayContaining([
        "accent.text",
        "size.control-md",
        "duration.ui",
        "font.sans",
      ]),
    );
  });
  it("resolves every public token in every theme and direction, and in every other context", () => {
    const inputs = [
      ...model
        .modifier("theme")
        .contexts.flatMap((theme) =>
          model.directions.map((direction) => ({ theme, direction })),
        ),
      ...model.modifiers.flatMap((m) =>
        m.contexts.map((c) => ({ [m.name]: c })),
      ),
    ];
    for (const input of inputs) {
      const set = model.get(input);
      for (const id of model.ids)
        expect(set[id], `${JSON.stringify(input)} ${id}`).toBeDefined();
    }
  });
  it("gives each platform its own type and control sizes", () => {
    const size = (platform: string, density: string) =>
      model.get({ platform, density })["size.control-md"]?.$value;
    expect(size("web", "comfortable")).toEqual({ value: 3, unit: "rem" });
    expect(size("android", "comfortable")).toEqual({ value: 48, unit: "px" });
    expect(size("ios", "compact")).toEqual({ value: 36, unit: "px" });
    expect(model.get({ platform: "ios" })["size.target-min"]?.$value).toEqual({
      value: 44,
      unit: "px",
    });
  });
});

describe("the in-house permutation resolver", async () => {
  const model = await loadModel();
  it("equals the reference parser through every combined resolver context", () => {
    const inputs = model.modifiers.reduce<Record<string, string>[]>(
      (inputs, modifier) =>
        inputs.flatMap((input) =>
          modifier.contexts.map((context) => ({
            ...input,
            [modifier.name]: context,
          })),
        ),
      [{}],
    );
    for (const input of inputs) {
      const ours = model.get(input);
      const theirs = model.terrazzo(input);
      for (const id of model.ids) {
        const a = ours[id]?.$value;
        const b = theirs[id]?.$value;
        // The parser adds alpha: 1 to opaque colours; ours leaves it out (CSS reads both alike).
        const norm = (v: unknown): string =>
          JSON.stringify(v, (_k, x: unknown) => {
            if (!x || typeof x !== "object" || Array.isArray(x)) return x;
            const o = x as Record<string, unknown>;
            return o["alpha"] === 1 ? { ...o, alpha: undefined } : o;
          });
        expect(norm(a), `${JSON.stringify(input)} ${id}`).toBe(norm(b));
        expect(ours[id]?.$type).toBe(theirs[id]?.$type);
      }
    }
  }, 180_000);
});

describe("unpublished derived candidates", () => {
  it("resolves candidate bytes in both models without changing committed derived files", async () => {
    const derived = derive();
    const key = "derived/theme/light.tokens.json";
    const disk = readFileSync(TOKENS + key);
    const theme = structuredClone(derived.files.get(key));
    if (
      !theme ||
      !isObject(theme["surface"]) ||
      !isObject(theme["surface"]["base"])
    )
      throw new Error("Missing candidate surface fixture");
    theme["surface"]["base"]["$value"] = color("#abcdef");
    const files = new Map(derived.files);
    files.set(key, theme);
    const candidate = await loadModel(files);
    const actual = candidate.get({ theme: "light" })["surface.base"]?.$value;
    const reference = candidate.terrazzo({ theme: "light" })["surface.base"]
      ?.$value;
    expect(isObject(actual) ? actual["hex"] : null).toBe("#abcdef");
    expect(isObject(reference) ? reference["hex"] : null).toBe("#abcdef");
    expect(readFileSync(TOKENS + key)).toEqual(disk);
  });
});
