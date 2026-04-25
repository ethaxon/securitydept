# SecurityDept Overview

SecurityDept is a layered authentication and authorization toolkit organized around three related outcomes:

1. reusable Rust crates for identity, token, and credential validation
2. a TypeScript SDK family for browser, React, Angular, and server-host adopters
3. reference applications used to validate those crates and SDKs against real deployment scenarios

## Project Direction

The long-term direction is not a single monolithic auth service. Instead, SecurityDept is being shaped into a stack that can support both centralized and distributed deployments:

- centralized services with server-side sessions
- simple browser-native Basic Auth flows
- distributed SPA applications that manage token sets directly
- stateless bearer-token forwarding between mesh-like nodes inside trusted network boundaries

That requires a clean split between:

- credential verification primitives
- OIDC client logic
- OAuth resource-server logic
- auth-context modes built on top of those lower layers
- local credential management
- reference applications

## Current Layers

- `securitydept-creds`
  - low-level credential and token verification primitives
- `securitydept-oauth-provider`
  - shared remote-provider connectivity and cache runtime
- `securitydept-oidc-client`
  - OIDC relying-party client behavior
- `securitydept-basic-auth-context`
  - reusable basic-auth zone and redirect abstraction with framework-neutral response metadata; `BasicAuthContextService` now lives directly in this crate
- `securitydept-session-context`
  - reusable session context abstraction for cookie-session mode without direct Axum coupling; `SessionAuthServiceTrait`, `OidcSessionAuthService`, and `DevSessionAuthService` are now directly in this crate via the `service` feature
- `securitydept-token-set-context`
  - reusable auth-state, redirect, metadata-redemption, and token-propagation layer for stateless token-set mode
- `securitydept-oauth-resource-server`
  - bearer-token verification behavior
- `securitydept-realip`
  - trusted-proxy/provider-aware client IP resolution
- `securitydept-creds-manage`
  - local basic-auth and static-token management
- `securitydept-server`
  - reference app that wires the supported auth-context modes and local-credential scenarios together

The more accurate reading now is:

- `securitydept-basic-auth-context`, `securitydept-session-context`, and `securitydept-token-set-context` are the long-term auth-context product surfaces
- route-facing services have all been moved back into their owning crates: `BasicAuthContextService` into `securitydept-basic-auth-context`, session services into `securitydept-session-context` (via the `service` feature), `BackendOidcMediatedModeAuthService`, and `AccessTokenSubstrateResourceService` into `securitydept-token-set-context`
- the `securitydept-auth-runtime` aggregation layer has been dissolved and removed from the workspace

## Target Auth Context Modes

SecurityDept should provide three explicit auth-context modes above the lower-level crates:

1. Basic auth zone mode
2. Cookie-session mode
3. Stateless token-set mode (token snapshot/deltametadata snapshot/delta)

Those modes are deployment-oriented compositions, not replacements for `oidc-client` or `oauth-resource-server`.

## Design Principles

- Prefer composition over a giant all-in-one auth crate.
- Keep token acquisition and token verification separate.
- Model stateless and stateful auth-context modes explicitly.
- Support both backend-first and frontend-strong deployments.
- Keep the server app as a proving ground, not the product boundary.
- Keep reusable crates framework-neutral when the boundary can stay in the reference app.

## TypeScript SDK Status and Entry Path

The TypeScript client SDK is now a working part of this repository, not only a future design topic. The active release-preparation target is `0.2.0-beta.1`; it focuses on packaging, docs reality, release matrices, Docker readiness, and the static docs site.

The current phase has also shifted:

- the question is no longer “does the SDK exist yet?” but “which contracts are already explainable to external consumers in the current 0.x stage?”
- the boundary between root exports, adapters, and reference-app glue should be read primarily through [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)
- token-set should currently be read through a browser-owned v1 baseline, not as if mixed-custody / BFF / server-side token-set were already inside scope

The most direct way to enter the current SDK stack is:

- start with [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) for package boundaries, capability ownership, stability labels, and minimal entry snippets
- inspect `sdks/ts/packages/*` for the actual foundation `./web` exports, framework adapters (React / Angular), and `@securitydept/client` subpaths such as `./web-router`
- inspect `apps/webui/src/routes/TokenSet.tsx` and `apps/webui/src/routes/tokenSet/*` as the main reference route for lifecycle, trace, and propagation dogfooding
- treat `apps/webui/src/api/*` as reference-app glue, not as the default SDK surface

## Document Index

- [001-ARCHITECTURE.md](001-ARCHITECTURE.md) / [中文](../zh/001-ARCHITECTURE.md)
- [002-FEATURES.md](002-FEATURES.md) / [中文](../zh/002-FEATURES.md)
- [005-ERROR_SYSTEM_DESIGN.md](005-ERROR_SYSTEM_DESIGN.md) / [中文](../zh/005-ERROR_SYSTEM_DESIGN.md)
- [006-REALIP.md](006-REALIP.md) / [中文](../zh/006-REALIP.md)
- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) / [中文](../zh/007-CLIENT_SDK_GUIDE.md)
  - formal client SDK architecture, package boundaries, foundation protocols, and implementation guidance
- [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) / [中文](../zh/008-RELEASE_AUTOMATION.md)
  - release-cli authority, allowed version shapes, channel inference, and CI workflow rules
- [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md) / [中文](../zh/020-AUTH_CONTEXT_AND_MODES.md)
  - unified auth-context, basic-auth zone, and token-set mode design
- [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md) / [中文](../zh/021-REFERENCE-APP-OUTPOSTS.md)
  - downstream adopter calibration case for the SDK Angular/token-set path
- [100-ROADMAP.md](100-ROADMAP.md) / [中文](../zh/100-ROADMAP.md)
  - current release blockers, `0.2.x` track, and `0.3.0` deferrals
- [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) / [中文](../zh/110-TS_SDK_MIGRATIONS.md)
  - TypeScript SDK public-surface migration ledger

---

[English](000-OVERVIEW.md) | [中文](../zh/000-OVERVIEW.md)
