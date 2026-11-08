# Development workflow

Use the pinned toolchain and the repository's `just` recipes. Keep runtime
credentials, private estate data and live telemetry outside this repository.

The `NDS checks / quality` job runs on GitHub-hosted Ubuntu with read-only
repository permissions and immutable action pins. It checks this repository's
current foundation. A green result is not deployment, release, integration or
cross-platform acceptance. The repository owns its release and runtime acceptance checks.

## Source compatibility

The baseline is central `v0.0.1-alpha.9`; `contracts.lock` separately pins the
owner-approved visual amendment (ADR 0004). Existing tags are not reinterpreted.
The alpha.8 design package replaces the independently invented palette and token
names. Consumers update their immutable source pin and launcher provenance together.

The canonical NDDev mark in `assets/nddev-mark.svg` comes from the public
OpenNetwork header at https://nddev.ai/opennetwork/en; `brand-source.json`
records its reviewed geometry digest. Launcher colors use the canonical
OpenNetwork brand and base surface. The native in-app path is generated from
the same SVG; no consumer redraws or recolors an independent copy.

Install the pinned renderer with `python3 -m pip install --require-hashes -r
tools/requirements-icons.txt` in an isolated environment. From a committed DS
source, `python3 tools/generate_launchers.py --desktop /path/to/desktop --mobile
/path/to/mobile` renders required native images and records source/input/output
SHA-256 provenance. Byte generation and `--check` use the canonical Linux x86_64
renderer: CPython 3.15.0, Pillow 12.3.0 and its zlib 1.3.2 backend. Linux wheels
link the host zlib; `bash tools/with-renderer-zlib.sh <command>` builds the
checksum-pinned upstream backend in a temporary prefix for one command, then
removes that prefix. It does not replace system libraries. CI uses this wrapper
for generation checks. Other Pillow
wheels may encode identical pixels with different compression. Every target runs
`--verify` to check the committed asset inventory, bytes and immutable source/input/
renderer provenance without requiring Pillow. CI also retains strict Linux byte
regeneration. Do not copy or redraw the SVG in consumers. The renderer is a
development tool, not a runtime dependency.
