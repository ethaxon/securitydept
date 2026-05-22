# SecurityDept Overview

This document is the map for the rest of the SecurityDept docs. The repository [README](../../README.md) is the landing page; this overview tells each audience where to go next and which document owns which topic.

Use the focused docs for detailed contracts. Use [Release Automation](008-RELEASE_AUTOMATION.md) for release procedure, [Roadmap](100-ROADMAP.md) for active scope and deferrals, and [CHANGELOG](../../CHANGELOG.md) for executed release history.

## Audience Paths

### Rust Adopters

Use SecurityDept as Rust crates when your integration point is a server, proxy boundary, service mesh edge, or credential-management tool.

- Start with [001-ARCHITECTURE.md](001-ARCHITECTURE.md) for crate layering and ownership.
- Read [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md) for Basic Auth context, session context, and token-set context.
- Use [005-ERROR_SYSTEM_DESIGN.md](005-ERROR_SYSTEM_DESIGN.md) when route-facing errors, protocol exceptions, or diagnostics matter.
- Use [006-REALIP.md](006-REALIP.md) when deployments sit behind trusted reverse proxies, CDNs, or provider-specific ingress layers.

### TypeScript SDK Adopters

Use the SDK packages when your integration point is browser, React, Angular, or host-framework code.

- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) is the authority for package boundaries, subpaths, stability labels, adapter contracts, and public API shape.
- [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) records public-surface migration decisions.
- [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md) records the downstream Angular/token-set calibration case and its limits.

### Runtime Adopters

Use the reference runtime and Docker image when you need an executable baseline rather than a library-only integration.

- `apps/server` is the Axum reference server.
- `apps/webui` is the React reference UI.
- The Docker image combines the server and web UI artifacts.
- [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) owns tag policy, publish workflow, and release entrypoints.

### Contributors And Release Maintainers

Use these docs when changing SecurityDept itself.

- [002-FEATURES.md](002-FEATURES.md) tracks implemented vs planned capabilities.
- [100-ROADMAP.md](100-ROADMAP.md) tracks active `0.3.x` scope and deferred topics.
- [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) explains `securitydept-metadata.toml`, `release-cli`, just recipes, and publish workflows.
- [CHANGELOG](../../CHANGELOG.md) records executed release work; it is not the place for future-planning prose.

## Document Ownership

These documents have distinct jobs:

- [README](../../README.md): repository landing page, high-level product positioning, and contributor entry.
- `000` overview: documentation map and authority boundaries.
- [001-ARCHITECTURE.md](001-ARCHITECTURE.md): Rust/runtime layering and artifact boundaries.
- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md): TypeScript SDK package and adapter contracts.
- [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md): release rules, workflow behavior, and version/channel policy.
- [100-ROADMAP.md](100-ROADMAP.md): active product scope, release constraints, and deferred topics.
- [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md): public-surface migration ledger.
- [CHANGELOG](../../CHANGELOG.md): executed release history.

If two documents overlap, the more focused document owns the detailed contract.

## Artifact Boundaries

### Rust Crates

The publishable Rust library line is the set of reusable crates under `packages/*`:

- credential, token, and real-IP primitives
- OIDC/OAuth provider and resource-server behavior
- Basic Auth, session, and token-set auth-context services
- `securitydept-core` aligned re-exports

`apps/server` and `apps/cli` are runtime artifacts, not crates.io library surfaces.

### TypeScript SDK Packages

The publishable SDK line is the set of packages under `sdks/ts/packages/*`, grouped by:

- shared client foundation packages
- Basic Auth context client packages
- session context client packages
- token-set context client packages
- React and Angular framework adapters

Reference-app code under `apps/webui/src/api/*` is local glue and should not be treated as SDK API.

### Reference Runtime

The reference runtime proves cross-layer behavior:

- multi-context login and logout routing
- management API authorization across session, Basic Auth, and token-set modes
- bearer propagation and route-level error-envelope boundaries
- React and Angular SDK ergonomics through in-repo proof and focused downstream calibration

### Docs Site

Source docs live in `docs/en` and `docs/zh`. The VitePress site in `docsite/` renders those source docs via symlinks; it is a presentation layer, not a second content authority.

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
| [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md) | Downstream Angular/token-set calibration and host-pressure notes |
| [100-ROADMAP.md](100-ROADMAP.md) | Active release scope and deferred topics |
| [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) | TypeScript SDK migration ledger |
| [CHANGELOG](../../CHANGELOG.md) | Executed release history |

## Documentation Rules

- User-facing docs describe current behavior or explicit future plans.
- Historical implementation detail and release chronology belong in [CHANGELOG](../../CHANGELOG.md), not in stable focused docs.
- When README, overview, and a focused doc overlap, the focused doc owns the detailed contract.
- Downstream cases such as `outposts` can inform design and ergonomics, but they do not replace in-repo release evidence.
- English and Chinese docs should stay equivalent in meaning, with links pointing to the same-language folder when available.

---

[English](000-OVERVIEW.md) | [中文](../zh/000-OVERVIEW.md)
