# SecurityDept Overview

This document is the map for the rest of the SecurityDept docs. The README is the repository landing page; this overview explains where each audience should go next and what the current artifact boundaries are.

Current release line: `0.2.0-beta.1`.

## Audience Paths

### Rust Adopters

Use SecurityDept as Rust crates when your integration point is a server, service mesh boundary, proxy, or local credential-management tool.

- Start with [001-ARCHITECTURE.md](001-ARCHITECTURE.md) for crate layering and ownership.
- Read [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md) for Basic Auth context, session context, and token-set context.
- Use [005-ERROR_SYSTEM_DESIGN.md](005-ERROR_SYSTEM_DESIGN.md) when route-facing errors, protocol exceptions, or diagnostics matter.
- Use [006-REALIP.md](006-REALIP.md) when deployments sit behind trusted reverse proxies, CDNs, or provider-specific ingress layers.

### TypeScript SDK Adopters

Use the SDK packages when your integration point is browser, React, Angular, or host-framework code.

- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) is the authority for package boundaries, subpaths, stability labels, adapter contracts, and public API shape.
- [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) records public-surface migration decisions.
- [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md) records the downstream Angular/token-set calibration case.

### Reference App And Runtime Adopters

Use the reference app and Docker image when you need an executable baseline rather than a library-only integration.

- `apps/server` is the Axum reference server.
- `apps/webui` is the React reference UI.
- The Docker image combines the server and web UI output; release tags are planned by `release-cli docker publish`.
- [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) is the authority for package, image, docs-site, and CI release behavior.

### Contributors And Release Maintainers

Use these docs when changing SecurityDept itself.

- [002-FEATURES.md](002-FEATURES.md) tracks implemented vs planned capabilities.
- [100-ROADMAP.md](100-ROADMAP.md) tracks current release state, beta readiness, and deferrals.
- [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) explains `securitydept-metadata.toml`, `release-cli`, just recipes, and publish workflows.

## Artifact Boundaries

### Rust Crates

The publishable Rust library line is the set of reusable crates under `packages/*`:

- credential, token, and real-IP primitives
- OIDC/OAuth provider and resource-server behavior
- Basic Auth, session, and token-set auth-context services
- `securitydept-core` aligned re-exports

`apps/server` and `apps/cli` are build/runtime artifacts, not crates.io library surfaces.

### TypeScript SDK Packages

The publishable SDK line is the set of packages under `sdks/ts/packages/*`, grouped by:

- shared client foundation packages
- Basic Auth context client packages
- session context client packages
- token-set context client packages
- React and Angular framework adapters

Reference-app code under `apps/webui/src/api/*` is local glue and should not be treated as SDK API.

### Reference Applications

The reference applications prove cross-layer behavior:

- multi-context login and logout routing
- management API authorization across session, Basic Auth, and token-set modes
- bearer propagation and route-level error-envelope boundaries
- React and Angular SDK ergonomics through local and downstream adopter tests

### Docs Site

Source docs live in `docs/en` and `docs/zh`. The VitePress site in `docsite/` symlinks to those source docs and is built independently from the main app.

## Canonical Documents

| Document | Use It For |
| --- | --- |
| [001-ARCHITECTURE.md](001-ARCHITECTURE.md) | Layering, crate ownership, and runtime boundaries |
| [002-FEATURES.md](002-FEATURES.md) | Implemented vs planned capability status |
| [005-ERROR_SYSTEM_DESIGN.md](005-ERROR_SYSTEM_DESIGN.md) | Safe public errors, protocol exceptions, and internal diagnostics |
| [006-REALIP.md](006-REALIP.md) | Trusted-peer-aware client IP resolution |
| [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) | TypeScript SDK package boundaries, adapters, and public contracts |
| [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) | Release metadata, package publishing, Docker tags, and docs-site workflow |
| [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md) | Basic Auth, session, and token-set auth-context design |
| [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md) | Downstream adopter calibration for Angular/token-set integration |
| [100-ROADMAP.md](100-ROADMAP.md) | Current release state and deferrals |
| [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) | TypeScript SDK migration ledger |

## Documentation Rules

- User-facing docs describe current behavior or explicit future plans.
- Historical implementation detail belongs outside stable docs.
- When README, overview, and a focused doc overlap, the focused doc owns the detailed contract.
- English and Chinese docs should stay equivalent in meaning, with links pointing to the same-language folder when available.

---

[English](000-OVERVIEW.md) | [中文](../zh/000-OVERVIEW.md)
