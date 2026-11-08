// The kit's component tokens in each native language: computed properties that return the
// semantic value they alias (so a component follows the theme, direction, platform and density
// its colours and metrics were resolved for), or constants.
import { camel, fixed, type NativeTokens } from "./native.ts";

type Component = NativeTokens["components"][number];
const snake = (id: string): string => id.replace(/[.-]/g, "_").toLowerCase();
const of = (t: NativeTokens, type: Component["type"]): Component[] =>
  t.components.filter((c) => c.type === type);
const note = (c: Component): string =>
  c.target ? `${c.id} → ${c.target}` : c.id;

export function swiftComponents(t: NativeTokens): string {
  const prop = (c: Component, type: string): string =>
    `    /// ${note(c)}\n    public var ${camel(c.id)}: ${type} { ${c.target ? camel(c.target) : fixed(c.value ?? 0)} }`;
  return `// The kit's component tokens: aliases of the semantic values, or constants.

extension NDColors {
${of(t, "color")
  .map((c) => prop(c, "NDColor"))
  .join("\n")}
}

extension NDMetrics {
${of(t, "dimension")
  .map((c) => prop(c, "Double"))
  .join("\n")}
}

extension NDShadows {
${of(t, "shadow")
  .map(
    (c) =>
      `    /// ${note(c)}\n    public static func ${camel(c.id)}(_ theme: NDTheme) -> [NDShadowLayer] { ${camel(c.target ?? "")}(theme) }`,
  )
  .join("\n")}
}
`;
}

export function kotlinComponents(t: NativeTokens): string {
  const prop = (
    c: Component,
    recv: string,
    type: string,
    suffix = "",
  ): string =>
    `/** ${note(c)} */\nval ${recv}.${camel(c.id)}: ${type}\n    get() = ${c.target ? camel(c.target) : `${fixed(c.value ?? 0)}${suffix}`}`;
  return `// The kit's component tokens: aliases of the semantic values, or constants.

${of(t, "color")
  .map((c) => prop(c, "NDColors", "NDColor"))
  .join("\n\n")}

${of(t, "dimension")
  .map((c) => prop(c, "NDMetrics", "Float", "f"))
  .join("\n\n")}

${of(t, "shadow")
  .map(
    (c) =>
      `/** ${note(c)} */\nfun NDShadows.${camel(c.id)}(theme: NDTheme): List<NDShadowLayer> = ${camel(c.target ?? "")}(theme)`,
  )
  .join("\n\n")}
`;
}

export function dartComponents(
  t: NativeTokens,
  id: (s: string) => string,
): string {
  const prop = (c: Component, type: string): string =>
    `  /// ${note(c)}\n  ${type} get ${id(c.id)} => ${c.target ? id(c.target) : fixed(c.value ?? 0)};`;
  return `/// The kit's component colours: aliases of the semantic roles.
extension NDComponentColors on NDColors {
${of(t, "color")
  .map((c) => prop(c, "Color"))
  .join("\n")}
}

/// The kit's component metrics: aliases of the semantic sizes, or constants.
extension NDComponentMetrics on NDMetrics {
${of(t, "dimension")
  .map((c) => prop(c, "double"))
  .join("\n")}
}

/// The kit's component elevations.
abstract final class NDComponentShadows {
${of(t, "shadow")
  .map(
    (c) =>
      `  /// ${note(c)}\n  static List<NDShadowLayer> ${id(c.id)}(NDTheme theme) => NDShadows.${id(c.target ?? "")}(theme);`,
  )
  .join("\n")}
}
`;
}

export function rustComponents(t: NativeTokens): string {
  const method = (c: Component, type: string): string =>
    `    /// ${note(c)}\n    pub const fn ${snake(c.id)}(&self) -> ${type} {\n        ${c.target ? `self.${snake(c.target)}` : fixed(c.value ?? 0)}\n    }`;
  return `/// The kit's component colours: aliases of the semantic roles.
impl Colors {
${of(t, "color")
  .map((c) => method(c, "Color"))
  .join("\n\n")}
}

/// The kit's component metrics: aliases of the semantic sizes, or constants.
impl Metrics {
${of(t, "dimension")
  .map((c) => method(c, "f32"))
  .join("\n\n")}
}

/// The kit's component elevations.
pub mod component_shadows {
    use super::{ShadowLayer, Theme};
${of(t, "shadow")
  .map(
    (c) =>
      `\n    /// ${note(c)}\n    pub const fn ${snake(c.id)}(theme: Theme) -> &'static [ShadowLayer] {\n        super::shadows::${snake(c.target ?? "")}(theme)\n    }`,
  )
  .join("\n")}
}
`;
}
