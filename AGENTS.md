# OpenNetwork Design System

This repository contains the public OpenNetwork product. Keep private source identifiers,
organization configuration, credentials and internal material outside it.

Read README.md and docs/development.md before changing code. Original code and tokens use Apache-2.0;
retain third-party licenses and attribution when changing assets.

Author tokens under tokens/intent, foundation, platform, density, motion and component. Author web
components under kit/ and application bindings under adapters/. The registry publishes only `on`.
Never hand-edit packages/, tokens/derived/, tokens/nddev.resolver.json, tokens/tokens.json or
generated/outputs.json. Change their producer, then run just generate. Every generated file has one
producer and an input/output identity in the ledger.

Run just check for source verification. Builds, browser sessions, tests and Docker run on runners or
the designated execution host. CI exercises actual fonts, components, Flutter controls and native
package toolchains. Retain source and API compatibility unless the change explicitly calls for a
migration. Add no independently authored copies of design values.
