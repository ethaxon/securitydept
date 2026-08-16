# Roadmap

The active release line is `0.3.x`. The priority is to turn the current reusable Rust, TypeScript, and reference-runtime surfaces into a coherent, testable, releasable contract while following the [SDK stability discipline](007-CLIENT_SDK_GUIDE.md#stability-and-change-discipline) for public changes.

## Active Priorities

1. Keep public Rust crates and TypeScript package/subpath exports explicit, tested, and documented.
2. Strengthen the consolidated token-set lifecycle with coverage for cancellation, reentrant operations, persistence, and revocation, preserving one snapshot authority and secret-safe event contracts.
3. Keep `apps/webui` and `apps/server` as executable proof surfaces for the public contracts without promoting their application composition to SDK API.
4. Preserve simple, discoverable Basic Auth and session entry paths while token-set remains the richer integration surface.
5. Keep release metadata, package/readme generation, Docker assembly, docs-site validation, and cross-workspace tests reproducible through the declared toolchains.

## Documentation And Compatibility

- `docs/en` and `docs/zh` are source documentation; `docsite/` renders them through symlinks.
- `public-surface-inventory.json` and package exports define the TypeScript contract boundary.
- [TS SDK Migrations](110-TS_SDK_MIGRATIONS.md) records migration steps; a pre-1.0 version does not override an export's stability level.
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
