import { describe, expect, it } from "vitest";
import {
  contrast,
  fromOklch,
  mix,
  nudge,
  parseHex,
  shiftUntil,
  toHex,
  toOklch,
} from "../src/color.ts";

describe("colour maths", () => {
  it("measures WCAG 2.x contrast", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrast("#1024D0", "#000000")).toBeCloseTo(2.19, 2);
  });
  it("round-trips sRGB through OKLCH", () => {
    for (const hex of [
      "#1024d0",
      "#47f77d",
      "#773ef9",
      "#ff3fa8",
      "#ffd83f",
      "#e2130e",
      "#808080",
    ])
      expect(fromOklch(toOklch(hex))).toBe(hex);
  });
  it("keeps hue and loses only chroma out of gamut", () => {
    const vivid = { ...toOklch("#47f77d"), C: 0.6 };
    const hex = fromOklch(vivid);
    expect(Math.abs(toOklch(hex).h - vivid.h)).toBeLessThan(0.02);
  });
  it("moves lightness until a target holds, and keeps a colour that already passes", () => {
    const on = "#000000";
    const lighter = shiftUntil(
      "#1024d0",
      "lighter",
      (c) => contrast(c, on) >= 4.5,
    );
    expect(lighter).not.toBeNull();
    expect(contrast(lighter ?? "", on)).toBeGreaterThanOrEqual(4.5);
    expect(shiftUntil("#FFFFFF", "lighter", () => true)).toBe("#ffffff");
    expect(shiftUntil("#808080", "darker", () => false)).toBeNull();
  });
  it("mixes in gamma-encoded sRGB and nudges lightness", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(toOklch(nudge("#808080", 0.1)).L).toBeGreaterThan(
      toOklch("#808080").L,
    );
    expect(toHex(parseHex("#abc"))).toBe("#aabbcc");
    expect(() => parseHex("red")).toThrow();
  });
});
