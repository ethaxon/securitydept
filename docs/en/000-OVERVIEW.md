# SecurityDept Overview

SecurityDept is a layered authentication and authorization project for two related outcomes:

1. reusable Rust crates for identity, token verification, and credential validation
2. a reference server app used to validate those crates against real deployment scenarios

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
- `securitydept-auth-runtime`
  - route-ready auth orchestration with independently gated basic-auth, session, and token-set features
- `securitydept-basic-auth-context`
  - reusable basic-auth zone and redirect abstraction with framework-neutral response metadata
- `securitydept-session-context`
  - reusable session context abstraction for cookie-session mode without direct Axum coupling
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

## Target Auth Context Modes

SecurityDept should provide three explicit auth-context modes above the lower-level crates:

1. Basic auth zone mode
2. Cookie-session mode
3. Stateless token-set mode (token snapshot/delta + metadata snapshot/delta)

Those modes are deployment-oriented compositions, not replacements for `oidc-client` or `oauth-resource-server`.

## Design Principles

- Prefer composition over a giant all-in-one auth crate.
- Keep token acquisition and token verification separate.
- Model stateless and stateful auth-context modes explicitly.
- Support both backend-first and frontend-strong deployments.
- Keep the server app as a proving ground, not the product boundary.
- Keep reusable crates framework-neutral when the boundary can stay in the reference app.

## Document Index

- [001-ARCHITECTURE.md](001-ARCHITECTURE.md) / [中文](../zh/001-ARCHITECTURE.md)
- [002-FEATURES.md](002-FEATURES.md) / [中文](../zh/002-FEATURES.md)
- [003-AUTH_CONTEXT_MODES.md](003-AUTH_CONTEXT_MODES.md) / [中文](../zh/003-AUTH_CONTEXT_MODES.md)
- [004-BASIC_AUTH_ZONE.md](004-BASIC_AUTH_ZONE.md) / [中文](../zh/004-BASIC_AUTH_ZONE.md)
- [005-ERROR_SYSTEM_DESIGN.md](005-ERROR_SYSTEM_DESIGN.md) / [中文](../zh/005-ERROR_SYSTEM_DESIGN.md)
- [006-REALIP.md](006-REALIP.md) / [中文](../zh/006-REALIP.md)
- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) / [中文](../zh/007-CLIENT_SDK_GUIDE.md)
  - formal client SDK architecture, package boundaries, foundation protocols, and implementation guidance
- [100-ROADMAP.md](100-ROADMAP.md) / [中文](../zh/100-ROADMAP.md)
