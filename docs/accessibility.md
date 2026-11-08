# Accessibility

The generator checks declared text and interface contrast pairs in every color theme. The web
reference is exercised with axe, narrow and wide layouts, keyboard patterns and reduced motion.
Flutter tests exercise real controls, disabled and focus states, text scaling and color pairs.
These checks support application review; applications must verify their own content and composition.

Give every control a name, preserve native semantics and visible keyboard focus, and provide status
text or an icon alongside color. Keep headings meaningful, errors associated with fields, and
modal focus contained and returned to its trigger. Let platform text scaling expand layouts.

On the web, system theme, increased-contrast and reduced-motion preferences are mapped by tokens.
Explicit context attributes take precedence. Native applications select the corresponding theme,
platform, density and motion enums and forward accessibility preferences from the operating system.
For the established Flutter application theme, select `darkContrast` or `lightContrast` when requested
and pass `reduceMotion: true`; retain Flutter's MediaQuery accessibility settings for framework-owned
animations. The duration token projection also exposes zero durations in the reduced-motion context.
