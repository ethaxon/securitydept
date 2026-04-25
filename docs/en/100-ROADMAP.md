# Roadmap

This roadmap is the current planning authority for SecurityDept. It describes the `0.2.0-beta.3` readiness line, the `0.2.x` backlog, and topics deferred to `0.3.0`.

It does not explain the full auth-context model or SDK package map. Use [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md) for auth context / mode design, [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) for the TypeScript SDK adopter guide, and [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) for public-surface migration guidance.

## Current Release Target

The current published baseline is `0.2.0-beta.3`.

This beta is not a new auth-context milestone. It is the current packaging, documentation, downstream-adopter router correctness, and release-readiness line for the reusable Rust crates, TypeScript SDK packages, Docker image, and static docs site.

The repository goal is no longer to prove whether release execution is possible. It is to keep release automation, authority docs, and the published facts aligned so the next release run stays repeatable.

## 0.2.0-beta.3 Release Record And Remaining Work

The version authority has moved to `0.2.0-beta.3`. The following release-readiness facts must stay aligned before and after publish execution:

- publishable Rust crate versions, metadata, dependency order, and the default `cargo package` report must align to `0.2.0-beta.3`
- the root `[patch.crates-io] openidconnect` override is gone and the workspace is back on `openidconnect = "4"`
- `apps/server` and `apps/cli` are explicitly `publish = false` application artifacts
- publishable TypeScript SDK packages are on `0.2.0-beta.3` and internal utility packages remain private
- both npm publish and crates publish workflows now use GitHub OIDC trusted publishing
- Angular and TanStack Router auth redirect helpers preserve attempted-route `postAuthRedirectUri` and avoid settling framework guard results after a full-page external redirect starts

The remaining work is about keeping the next release execution repeatable, not about carrying forward alpha-era blockers:

| Area | Current status | Required next step |
|---|---|---|
| Rust package gate | the default `release-cli crates publish --mode=package` path and `.github/workflows/crates-publish.yml` now run a real package gate | keep the default report refreshed with current full-package evidence before the next release |
| npm publish security posture | both the workflow and local publish entrypoints now pass `--provenance` and use trusted publishing | keep workflow, just recipes, and docs aligned on the same publish arguments |
| Docker | Docker build and tag policy are aligned with the beta rules, but image publication still depends on each release execution | keep toolchain, tag policy, labels, and docs aligned |
| Docs and roadmap authority | source docs now describe the current release and SDK facts | do not reintroduce historical blockers into current-status docs |
| Docsite | `docsite/` is the VitePress source root and root content is linked in through minimal rewrite rules | keep link behavior in sync with source docs without reintroducing a staging pipeline |

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

The pre-beta `[patch.crates-io] openidconnect` packaging blocker is closed: the workspace is back on `openidconnect = "4"`. Future release execution still requires a real `cargo package` check for every publishable crate, without treating `--allow-dirty` or `--no-verify` as acceptable evidence.

## Docker Product Boundary

The Docker image is a runtime artifact for the reference server plus web UI output. Beta readiness requires:

- toolchain versions aligned with `mise.toml` / `rust-toolchain.toml` or explicitly documented
- web UI output copy path matching the real Vite build output
- tag behavior where pre-release tags such as `v0.2.0-beta.3` do not publish `latest`
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
- `110` TS SDK migration guide

## Deferred To 0.3.0

These topics remain real, but they are outside the `0.2.0-beta.3` and `0.2.x` active release line:

- mixed-custody token ownership
- stateful BFF / server-side token-set ownership
- built-in chooser UI or router-level product-flow semantics
- heavier OTel / DI themes
- full Rust-side structured-observability/exporter stack
- Kotlin / Swift SDK productization before the TS contract settles

---

[English](100-ROADMAP.md) | [中文](../zh/100-ROADMAP.md)
