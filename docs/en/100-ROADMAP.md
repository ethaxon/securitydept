# Roadmap

This roadmap defines the active `0.3.x` product scope for SecurityDept and the topics deferred beyond that line.

It does not restate release procedure, SDK package maps, or migration chronology. Use [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) for publish workflow, [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) for TypeScript SDK contracts, [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md) for auth-context design, and [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) for public-surface changes.

## Current Release Target

The active release target is the `0.3.x` line.

Use [CHANGELOG](../../CHANGELOG.md) for executed release history and [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) for the operational publish rules. This roadmap stays focused on active scope, release constraints, and future deferrals.

## 0.3.x Priorities

The `0.3.x` line is about making the existing stack explainable, testable, and releasable while allowing targeted breaking changes that improve host ergonomics and long-term maintainability:

1. Keep the TypeScript SDK public surface explicit and enforceable through `public-surface-inventory.json`, release-gate tests, docs anchors, and `110` migration entries.
2. Keep `apps/webui` as the primary in-repo executable proof surface for browser, React, route policy, error handling, and browser-harness evidence.
3. Keep `outposts` as a supplementary downstream calibration case for Angular hosting, backend-driven config projection, strict bearer injection, callback preservation, and provider-neutral route metadata.
4. Complete release packaging readiness for Rust crates, npm packages, Docker images, and the docs site without expanding the auth feature set.
5. Preserve the current auth-context parity baseline: basic-auth and session stay intentionally thinner than token-set, but their entry paths must remain discoverable and tested.

## Product Boundaries

### TypeScript SDK

TypeScript remains the only active SDK productization language for `0.3.x`.

The active baseline includes:

- stable foundation helpers in `@securitydept/client`
- stable root basic-auth and session clients
- provisional browser/server/framework adapters
- provisional browser-owned token-set modes, registry, orchestration, and React Query integration
- real in-repo proof from `apps/webui`
- focused downstream calibration from `outposts`

The active baseline excludes:

- built-in chooser UI
- product-flow copy
- app-specific route tables
- reference-app business API wrappers
- non-TS SDK productization

### Rust Libraries

The reusable Rust package line is the set of workspace library crates under `packages/*`. `apps/server` and `apps/cli` are release artifacts for runtime and image readiness, not crates.io library publish targets.

Release readiness still requires a real `cargo package` check for every publishable crate. `--allow-dirty` and `--no-verify` are not release evidence.

### Runtime And Docker

The Docker image is a runtime artifact for the reference server plus web UI output. Current release expectations require:

- toolchain versions aligned with `mise.toml` / `rust-toolchain.toml` or explicitly documented
- runtime image assembly through `Dockerfile.runtime` from prebuilt server, CLI, and web UI artifacts
- web UI output copy paths matching the real Vite build output
- tag behavior where prerelease tags such as `vX.Y.Z-beta.N` do not publish `latest`
- release-acceptable labels, cache, provenance, and platform decisions

### Docs

`docs/en` and `docs/zh` remain the source docs. `docsite/` is the VitePress render layer and should expose the source docs through symlinks rather than a second content pipeline.

Document ownership is intentionally split:

- README and `000` for entry/navigation
- `007` for SDK contracts
- `008` for release rules
- `100` for active scope and deferrals
- `110` for migration history
- [CHANGELOG](../../CHANGELOG.md) for executed release history

## Deferred Beyond 0.3.x

These topics remain real, but they are outside the active release line:

- mixed-custody token ownership
- stateful BFF / server-side token-set ownership
- built-in chooser UI or router-level product-flow semantics
- heavier OTel / DI themes
- full Rust-side structured-observability/exporter stack
- Kotlin / Swift SDK productization before the TS contract settles

---

[English](100-ROADMAP.md) | [中文](../zh/100-ROADMAP.md)
