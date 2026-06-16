# Roadmap

The active release line is `0.3.x`. The priority is to turn the current reusable Rust, TypeScript, and reference-runtime surfaces into a coherent, testable, releasable contract while accepting targeted breaking changes before the API stabilizes.

## Active Priorities

1. Keep public Rust crates and TypeScript package/subpath exports explicit, tested, and documented.
2. Complete the token-set client workflow consolidation: one client snapshot authority, typed final candidates, source-driven workflow inputs, explicit spans, and event contracts that do not leak token material.
3. Keep `apps/webui` and `apps/server` as executable proof surfaces for the public contracts without promoting their application composition to SDK API.
4. Preserve simple, discoverable Basic Auth and session entry paths while token-set remains the richer integration surface.
5. Keep release metadata, package/readme generation, Docker assembly, docs-site validation, and cross-workspace tests reproducible through the declared toolchains.

## Documentation And Compatibility

- `docs/en` and `docs/zh` are source documentation; `docsite/` renders them through symlinks.
- `public-surface-inventory.json` and package exports define the TypeScript contract boundary.
- `110-TS_SDK_MIGRATIONS.md` records breaking TypeScript contract changes while `0.x` remains mutable.
- `CHANGELOG.md` records released history, not future scope.

## Deferred

The following are intentionally outside the current baseline:

- general mixed-custody or server-side token-set/BFF ownership
- built-in application chooser UI, product route semantics, or business API wrappers
- non-TypeScript SDK productization
- a full telemetry exporter/collector stack
- generalized token exchange beyond the reference propagation configuration

---

[English](100-ROADMAP.md) | [中文](../zh/100-ROADMAP.md)
