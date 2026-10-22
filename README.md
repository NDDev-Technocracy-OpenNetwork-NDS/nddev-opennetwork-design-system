# nddev-opennetwork-design-system

The open design system for NDDev OpenNetwork products. It is a public,
AGPL-3.0-only repository designed to be consumed by
`nddev-device-sync` and its self-hostable modules.

The system projects the NDDev platform's OpenNetwork direction into Flutter:
yellow/gold accent roles, neutral dark/light surfaces, bundled IBM Plex Sans,
native controls and the authentic NDDev mark. It retains https://nddev.ai and
contains no private platform configuration or content.

## Packages

```text
tokens/tokens.json       source design tokens
tokens/tokens.css        web-compatible projection
packages/flutter/        Flutter theme and token package
docs/visual-language.md  composition, accessibility and asset rules
```

## Usage

The Flutter package is consumed by desktop and mobile clients as a pinned
version. A product may add local instance information and contact details, but
the NDDev OpenNetwork attribution and `https://nddev.ai` link remain present.

`tokens/tokens.json` is the versioned public OpenNetwork export. Refresh it with
`python3 tools/import_platform.py /path/to/reviewed/platform`, then run `just tokens`
to regenerate CSS, Dart and native mark geometry. The importer exports only the
OpenNetwork direction and records immutable source/input hashes. Its `--check`
compares the export without writing or requiring platform files in consumer CI.
`just check` rejects projection drift and runs
Flutter formatting, analysis and theme tests. Use Flutter 3.47.7 with Dart
3.13.5 and `just dependencies` to enforce the committed dependency lock.
Themes style native Material buttons, fields/selects, cards, menus, navigation,
chips, progress, selection and focus. `OpenNetworkBrand` shares the authentic
geometry and direction lockup. Unmodified TTF files matching the platform's Google Fonts revision are bundled with
OFL-1.1 and their source hashes; there is no runtime font download. Widget tests
exercise real controls, both themes, text scaling and contrast; they do not
substitute for native target build or device acceptance.

## License

The repository is licensed under GNU AGPL-3.0-only. See [`LICENSE`](LICENSE).

Release journals live in [GitHub Releases](https://github.com/NDDev-Technocracy-OpenNetwork-NDS/nddev-opennetwork-design-system/releases).
