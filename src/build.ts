// Every platform output from the resolved model. Paths are absolute; the CLI writes or checks them.
import { ROOT } from "./dtcg.ts";
import { fontManifest, nativeFontFiles, readFonts } from "./fonts.ts";
import { readBrandMark, readIcons } from "./icons.ts";
import { loadModel, type Model } from "./model.ts";
import { emitCss } from "./emit/css.ts";
import { readFileSync, readdirSync } from "node:fs";
import { emitOpenNetwork } from "./emit/opennetwork.ts";
import { emitDart } from "./emit/dart.ts";
import { emitFigma } from "./emit/figma.ts";
import { emitKitCss, emitTextStylesCss } from "./emit/kit-css.ts";
import {
  emitReference,
  emitReferenceFonts,
  readExamples,
} from "./emit/reference.ts";
import { readComponents } from "./kit.ts";
import { emitBrand, emitIcons, emitWebIcons } from "./emit/icons.ts";
import { emitKotlin } from "./emit/kotlin.ts";
import { emitLlms } from "./emit/llms.ts";
import { emitListing } from "./emit/listing.ts";
import { nativeTokens } from "./emit/native.ts";
import { readmes } from "./emit/readmes.ts";
import { emitRust } from "./emit/rust.ts";
import { emitSwift } from "./emit/swift.ts";

export async function build(
  candidate?: Model,
): Promise<Map<string, string | Uint8Array>> {
  const model = candidate ?? (await loadModel());
  const files = new Map<string, string | Uint8Array>();
  const add = (dir: string, out: Map<string, string | Uint8Array>): void => {
    for (const [path, body] of out)
      files.set(`${ROOT}packages/${dir === "." ? "" : `${dir}/`}${path}`, body);
  };
  files.set(`${ROOT}packages/web/tokens.css`, emitCss(model));
  files.set(`${ROOT}packages/web/tokens.json`, emitListing(model));
  files.set(`${ROOT}packages/web/kit.css`, emitKitCss());
  add("figma", emitFigma(model));
  const icons = readIcons();
  const mark = readBrandMark();
  files.set(`${ROOT}packages/web/icons.json`, emitWebIcons(icons, mark));
  add("icons", emitIcons(icons));
  const components = readComponents(model);
  files.set(
    `${ROOT}packages/web/reference.html`,
    emitReference(model, components, icons),
  );
  add(".", emitLlms(model, components, readExamples()));
  add("brand", emitBrand(model, mark));
  const fonts = readFonts(model);
  files.set(
    `${ROOT}packages/web/text-styles.css`,
    emitTextStylesCss(model, fonts.fallback),
  );
  files.set(
    `${ROOT}packages/web/reference-fonts.css`,
    emitReferenceFonts(fonts),
  );
  for (const family of fonts.families)
    for (const file of family.web.files)
      files.set(
        `${ROOT}packages/web/fonts/${file.file}`,
        readFileSync(
          `${ROOT}node_modules/${family.web.package}/files/${file.file}`,
        ),
      );
  const ttf = nativeFontFiles(fonts);
  const fontsAt = (dir: string): Map<string, Uint8Array> =>
    new Map([...ttf].map(([file, data]) => [`${dir}/${file}`, data]));
  add(
    "fonts",
    new Map<string, string | Uint8Array>([
      ["manifest.json", fontManifest(fonts)],
      ...fontsAt("ttf"),
    ]),
  );
  add("apple", fontsAt("Sources/OpenNetworkDesignTokens/Fonts"));
  add(
    "kotlin",
    fontsAt("src/main/resources/ai/nddev/opennetwork/design/fonts"),
  );
  add("flutter", fontsAt("fonts"));
  add("rust", fontsAt("fonts"));
  const native = nativeTokens(model);
  add("apple", emitSwift(native));
  add("kotlin", emitKotlin(native));
  const dart = emitDart(native);
  dart.delete("pubspec.yaml");
  dart.delete("lib/nddev_design_tokens.dart");
  for (const name of ["tokens", "theme"]) {
    const old = `lib/src/${name}.dart`;
    const body = dart.get(old);
    if (body) {
      dart.set(
        `lib/src/nd_${name}.dart`,
        body.replaceAll("'tokens.dart'", "'nd_tokens.dart'"),
      );
      dart.delete(old);
    }
  }
  for (const [path, body] of dart)
    dart.set(
      path,
      body
        .replaceAll(
          "nddev_design_tokens/nddev_design_tokens.dart",
          "nddev_opennetwork_design_system/opennetwork_design_system.dart",
        )
        .replaceAll("nddev_design_tokens", "nddev_opennetwork_design_system"),
    );
  add("flutter", dart);
  add("rust", emitRust(native));
  add(".", readmes(model));
  for (const [path, body] of emitOpenNetwork(model))
    files.set(ROOT + path, body);
  for (const dir of [
    "web",
    "figma",
    "icons",
    "brand",
    "fonts",
    "apple",
    "kotlin",
    "flutter",
    "rust",
  ]) {
    for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"])
      files.set(
        `${ROOT}packages/${dir}/${name}`,
        readFileSync(ROOT + name, "utf8"),
      );
    for (const name of readdirSync(ROOT + "licenses"))
      files.set(
        `${ROOT}packages/${dir}/licenses/${name}`,
        readFileSync(ROOT + "licenses/" + name, "utf8"),
      );
  }
  return files;
}
