# Roadmap

This roadmap is the current planning authority for SecurityDept. It describes the `0.2.0-beta.1` readiness line, the `0.2.x` backlog, and topics deferred to `0.3.0`.

It does not explain the full auth-context model or SDK package map. Use [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md) for auth context / mode design, [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) for the TypeScript SDK adopter guide, and [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) for public-surface migration history.

## Current Release Target

The active release-preparation target is `0.2.0-beta.1`.

This beta is not a new auth-capability milestone. It is the first packaging and documentation readiness line for the current reusable Rust crates, TypeScript SDK packages, Docker image, and static docs site.

Non-goals for the prep iteration:

- no tag push
- no crates.io publish
- no npm publish
- no GHCR push
- no release creation
- no generated docsite output committed
- no mixed-custody / BFF / server-side token ownership work

## 0.2.0-beta.1 Blockers

The beta cannot move to release execution until these are resolved or explicitly accepted as beta limitations:

| Area | Current blocker | Required disposition |
|---|---|---|
| Rust crates | all workspace crates are still `0.2.0-alpha.4`; crates lack crates.io metadata (`license`, `description`, `repository`, `readme`, `keywords`, `categories`) | publish matrix must mark publishable crates, app crates, dependency order, and metadata fixes |
| Rust packaging | workspace uses `[patch.crates-io] openidconnect` from a Git branch | real `cargo package` checks must prove exact impact and record whether this blocks beta publish |
| Rust apps | `apps/server` and `apps/cli` are application artifacts, not library crates | mark `publish = false` or record an equivalent release-policy decision |
| npm packages | SDK packages are still `0.1.0`; publishable packages target `0.2.0-beta.1` | package matrix must distinguish publishable SDKs from internal utilities |
| npm internal utilities | `@securitydept/e2e-utils` and `@securitydept/test-utils` are not beta npm targets | mark `publish = no` / internal and avoid treating pack output as publish evidence |
| Angular packages | APF exports warnings and dist export alignment must be classified | fix before beta if blocking; otherwise document as accepted beta limitation |
| Docker | Dockerfile/toolchain/tag behavior must match beta release policy | fix stale build facts; ensure beta tags do not push `latest` |
| Docs | source docs must match code/test facts and avoid historical narrative in current-status docs | complete docs audit and keep EN/ZH parity |
| Docsite | Pages publishing worked only through a fragile symlink-heavy `docs/site` wrapper | move the site root to `docsite`, expose `docsite/docs -> ../docs`, and keep link rewriting minimal and explicit |

## 0.2.x Active Track

The `0.2.x` line is about making the existing stack explainable, testable, and releasable:

1. Keep the TypeScript SDK freeze executable through `public-surface-inventory.json`, release-gate tests, evidence files, docs anchors, and `110` migration entries.
2. Keep `apps/webui` as the primary in-repo reference app for browser, React, dashboard, route policy, shared error, diagnosis, and browser harness evidence.
3. Keep `outposts` as a downstream adopter calibration case for Angular hosting, backend-driven config projection, strict bearer injection, callback preservation, and provider-neutral route metadata.
4. Complete release packaging readiness for Rust crates, npm packages, Docker images, and docs site without adding auth features.
5. Preserve the current auth-context parity baseline: basic-auth and session remain intentionally thinner than token-set, but their entry paths must stay discoverable and tested.

## TypeScript SDK Product Boundary

TypeScript remains the only active SDK productization language for `0.2.x`.

The active baseline includes:

- stable foundation helpers in `@securitydept/client`
- stable root basic-auth and session clients
- provisional browser/server/framework adapters
- provisional browser-owned token-set modes, registry, orchestration, and React Query integration
- real reference proof from `apps/webui`
- real downstream proof from `outposts`

The active baseline excludes:

- built-in chooser UI
- product-flow copy
- app-specific route tables
- reference-app business API wrappers
- non-TS SDK productization

## Rust Product Boundary

The reusable Rust package line is the set of workspace library crates under `packages/*`. `apps/server` and `apps/cli` are release artifacts for build/image readiness, not crates.io library publish targets.

Before beta release execution, every publishable crate needs a real `cargo package` check without `--allow-dirty` and without `--no-verify`. The `[patch.crates-io] openidconnect` dependency must be treated as a likely packaging blocker until proven otherwise.

## Docker Product Boundary

The Docker image is a runtime artifact for the reference server plus web UI output. Beta readiness requires:

- toolchain versions aligned with `mise.toml` / `rust-toolchain.toml` or explicitly documented
- web UI output copy path matching the real Vite build output
- tag behavior where pre-release tags such as `v0.2.0-beta.1` do not publish `latest`
- beta-acceptable labels, cache, provenance, and platform decisions

## Docs Product Boundary

`docs/en` and `docs/zh` remain source docs. `docsite/` is the VitePress source root; it should expose `docsite/docs` as a symlink to `docs/` and keep only the root README / LICENSE entry pages linked rather than copied.

The project docs should be read as:

- `000` overview and doc index
- `001` architecture and crate boundaries
- `002` capability matrix
- `005` error system design
- `006` real-IP strategy
- `007` client SDK adopter guide and public-surface snapshot
- `020` auth context / mode design
- `021` downstream reference case
- `100` roadmap and release blockers
- `110` TS SDK migration ledger

## Deferred To 0.3.0

These topics remain real, but they are outside the `0.2.0-beta.1` and `0.2.x` active release line:

- mixed-custody token ownership
- stateful BFF / server-side token-set ownership
- built-in chooser UI or router-level product-flow semantics
- heavier OTel / DI themes
- full Rust-side structured-observability/exporter stack
- Kotlin / Swift SDK productization before the TS contract settles

---

[English](100-ROADMAP.md) | [中文](../zh/100-ROADMAP.md)
