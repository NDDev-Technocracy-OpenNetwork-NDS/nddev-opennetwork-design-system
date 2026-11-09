set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

setup: install

install:
    bun install --frozen-lockfile --ignore-scripts

generate:
    node src/cli.ts generate

# Public compatibility alias used by existing consumers.
tokens: generate

# Source checks only; builds, applications and tests run on runners.
check:
    just --fmt --check
    python3 scripts/check-public-source.py
    node src/cli.ts check
    bun run typecheck
    bun run lint
    bun run format:check
    dart format --output=none --set-exit-if-changed adapters/flutter tests/flutter

dependencies:
    cd packages/flutter && flutter pub get --enforce-lockfile

format:
    bun run format
    dart format adapters/flutter tests/flutter

test:
    bun run test
    python3 -B -m unittest discover -s tools
    cd packages/flutter && flutter analyze --fatal-infos && flutter test

test-browser:
    bun run test:browser

platforms *targets:
    bash scripts/check-platforms.sh {{ targets }}

serve:
    node scripts/serve.ts

verify: check test test-browser
