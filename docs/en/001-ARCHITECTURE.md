# Architecture

SecurityDept separates reusable security primitives from application composition. Rust owns server-side protocols and configuration resolution; TypeScript owns explicit host integration and browser/framework lifecycle composition; the reference apps prove both surfaces together.

## Rust Layers

| Layer | Main crates | Responsibility |
| --- | --- | --- |
| Foundation | `securitydept-utils`, `securitydept-core` | Shared utility contracts and curated re-exports. |
| Credential and network policy | `securitydept-creds`, `securitydept-creds-manage`, `securitydept-realip` | Credential verification/storage and trusted client-IP resolution. |
| OAuth/OIDC | `securitydept-oidc-client`, `securitydept-oauth-provider`, `securitydept-oauth-resource-server` | Provider interaction, authorization-code flow, and resource-token verification. |
| Auth contexts | `securitydept-basic-auth-context`, `securitydept-session-context`, `securitydept-token-set-context` | Application-facing authentication models and their runtime/config contracts. |

`securitydept-core` is a convenience entry for aligned re-exports. It does not replace the ownership of the individual crates.

## Auth Contexts

The product has three top-level auth contexts:

- Basic Auth context models browser Basic-Auth challenge zones.
- Session context models server-owned, cookie-backed user sessions.
- Token-set context models OIDC token state and the frontend/backend integration modes around it.

The detailed ownership model is in [Auth Context and Modes](020-AUTH_CONTEXT_AND_MODES.md). A `zone` belongs only to Basic Auth; a `mode` belongs only to token-set context.

## Token-Set Architecture

Token-set context is intentionally split into protocol-neutral and mode-specific pieces:

- `orchestration` owns token snapshots, freshness calculation, persistence helpers, workflow sources, lifecycle candidates, and final determination commit.
- `frontend-oidc-mode` owns browser authorization-code/PKCE protocol work and safe server configuration projection consumption.
- `backend-oidc-mode` owns the server-mediated callback, refresh, metadata redemption, and user-info contract.
- `access-token-substrate` owns resource-token verification and bearer propagation integration.
- `registry` owns composition of multiple mode clients and callback routing.

The client is the sole authority for its in-memory auth snapshot. Workflow planners compute closed, discriminated candidates; the host commits one final determination. Workflow sources such as page resume and token-refresh timers only provide inputs to the serialized lifecycle, not alternate state authorities.

## TypeScript Foundation

Every client is constructed with an explicit `FoundationEnvironment`. Its required baseline is:

- neutral `transport`
- `time`
- `realmStorage`
- `span`
- `tracing`

Optional browser capabilities, such as persistent/session storage, router, page lifecycle, popup, and idle callbacks, remain optional and explicit. Environment creators in the `web`, `webext`, and `server` subpaths adapt raw host facilities before client construction.

The public state and event boundary is SDK-owned `SignalTrait`, `EventStreamTrait`, and cancellation-token traits. These implement observable interop, so implementations may compose directly with RxJS internally without exposing RxJS as the public SDK contract.

## Reference Runtime

`apps/server` resolves raw TOML/environment configuration into crate-owned resolved configuration, builds context runtimes, and mounts the HTTP routes. `apps/webui` is a React reference host that composes the TypeScript clients through the same explicit environment model.

The reference runtime is a proof surface, not an additional public SDK layer. Its application routes, UI copy, and local composition choices do not become reusable SDK contracts.

## Boundary Rules

- Raw host configuration is resolved and validated before reusable runtime construction.
- Access-token facts and authenticated-user principals are separate projections.
- Redirect targets are validated policy inputs, never unchecked raw URLs.
- Transport is neutral at the environment boundary. Authorized transport is a derived client capability, not an environment-owned authorization state.
- Span context provides trace nesting; callers record local behavior rather than maintaining parallel global outcome/source vocabularies.

---

[English](001-ARCHITECTURE.md) | [中文](../zh/001-ARCHITECTURE.md)
