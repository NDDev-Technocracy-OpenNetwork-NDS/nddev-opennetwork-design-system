---
status: accepted
date: '2026-10-22'
adaptation:
  standard:
    id: std-0001
  rules:
  - R-0018
  paths:
  - .python-version
  - module.yaml
  - packages
  - standarts.lock
  reason: NDS system ADR 0013 (accepted owner direction) keeps NDS-owned material at fixed top-level locations
    in member repositories.
  result: '`.python-version`: Pinned CPython toolchain feeding the token and icon generators. `module.yaml`:
    NDS module descriptor owned by the product standards corpus. `packages`: Published Flutter package
    generated from the canonical tokens. `standarts.lock`: NDS contract lock pinning the standards corpus
    with the visual-source amendment.'
  verification: Review against the NDS root ADR 0013; the root catalog check validates NDS descriptors
    and locks, and the repository's own checks exercise the remaining paths.
---
# NDS contract locations

The owner accepted NDS system [ADR 0013](https://github.com/NDDev-Technocracy-OpenNetwork-NDS/nddev-device-sync/blob/main/standarts/decisions/0013-estate-hygiene-and-standards-adoption.md). It keeps NDS-owned material at
deliberate top-level locations in member repositories. This record scopes
that decision to this repository under std-0001 R-0037 and replaces the
earlier manifest variations without changing them.

- `.python-version` (tool-config): Pinned CPython toolchain feeding the token and icon generators.
- `module.yaml` (manifest): NDS module descriptor owned by the product standards corpus.
- `packages` (package): Published Flutter package generated from the canonical tokens.
- `standarts.lock` (lock): NDS contract lock pinning the standards corpus with the visual-source amendment.
