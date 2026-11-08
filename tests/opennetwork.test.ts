import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ROOT } from "../src/dtcg.ts";
import { derive } from "../src/derive.ts";
import { loadModel } from "../src/model.ts";
import { readIcons } from "../src/icons.ts";
import { readFonts } from "../src/fonts.ts";
import { readComponents } from "../src/kit.ts";
import { colorOf, hex8 } from "../src/emit/native.ts";
import { emitOpenNetwork } from "../src/emit/opennetwork.ts";

describe("the public OpenNetwork product", async () => {
  const model = await loadModel();
  it("publishes only OpenNetwork, with all supported contexts and complete components", () => {
    expect(model.directions).toEqual(["on"]);
    expect(model.themes.map((t) => t.id)).toEqual([
      "light",
      "dark",
      "light-contrast",
      "dark-contrast",
    ]);
    expect(readComponents(model)).toHaveLength(33);
    expect(readIcons().map((i) => i.name)).not.toEqual(
      expect.arrayContaining(["dev", "ai", "rnd", "design", "platform"]),
    );
    for (const theme of model.themes)
      for (const platform of ["web", "desktop", "ios", "android"])
        for (const density of ["comfortable", "compact"])
          for (const motion of ["standard", "reduced"]) {
            const set = model.get({
              theme: theme.id,
              platform,
              density,
              motion,
            });
            for (const id of model.ids) expect(set[id], id).toBeDefined();
          }
    expect(derive().checks.length).toBeGreaterThan(700);
  });
  it("keeps existing Flutter colors tied to every canonical theme", () => {
    const source = emitOpenNetwork(model).get(
      "packages/flutter/lib/src/tokens.dart",
    )!;
    for (const theme of model.themes) {
      const set = model.get({ theme: theme.id, direction: "on" });
      for (const role of [
        "surface.base",
        "accent.text",
        "accent.fill",
        "accent.on-fill",
        "border.control",
      ])
        expect(source).toContain(`Color(0x${hex8(colorOf(set[role]!, set))})`);
    }
  });
  it("distributes unmodified fonts and complete licenses", () => {
    for (const family of readFonts(model).families)
      for (const file of family.web.files) {
        const shipped = readFileSync(`${ROOT}packages/web/fonts/${file.file}`);
        const original = readFileSync(
          `${ROOT}node_modules/${family.web.package}/files/${file.file}`,
        );
        expect(shipped.equals(original)).toBe(true);
      }
    for (const name of [
      "web",
      "flutter",
      "apple",
      "kotlin",
      "rust",
      "figma",
      "fonts",
      "icons",
      "brand",
    ]) {
      expect(readFileSync(`${ROOT}packages/${name}/LICENSE`, "utf8")).toContain(
        "Apache License",
      );
      expect(readFileSync(`${ROOT}packages/${name}/NOTICE`, "utf8")).toContain(
        "Danil Silantyev",
      );
      expect(
        readFileSync(
          `${ROOT}packages/${name}/licenses/OFL-IBM-Plex.txt`,
          "utf8",
        ),
      ).toContain("SIL OPEN FONT LICENSE");
    }
    const licenses = JSON.parse(
      readFileSync(`${ROOT}icons/upstream-licenses.json`, "utf8"),
    ) as { set: string; file_sha256: string }[];
    for (const license of licenses)
      expect(
        createHash("sha256")
          .update(readFileSync(`${ROOT}licenses/${license.set}.txt`))
          .digest("hex"),
      ).toBe(license.file_sha256);
  });
});
