# Auth Context Modes

This document describes the higher-level authentication context modes that should be built above the lower-level crates.

## Why This Layer Exists

The current lower layers already separate:

- token acquisition (`securitydept-oidc-client`)
- bearer verification (`securitydept-oauth-resource-server`)
- credential primitives (`securitydept-creds`)

What is still missing is a reusable layer that answers application-facing questions such as:

- who is the current authenticated user?
- where did that identity come from?
- how should the frontend keep authentication state?
- how should a node forward credentials to another node?

That is the role of auth-context modes.

## Mode A: Basic Auth Zone

Best for:

- simplest browser-native auth entry
- constrained environments
- cases where user experience can tolerate browser Basic Auth prompts

Expected properties:

- challenge zone isolation
- challenge trigger endpoint
- logout via credential poisoning workaround
- optional tiny TypeScript helper that redirects to the challenge URL

This mode should compose:

- `securitydept-creds`
- `securitydept-creds-manage`
- optional server routing helpers

## Mode B: Cookie-Session

Best for:

- centralized services
- weak frontend capability
- BFF-like applications

Expected properties:

- OIDC login and callback handled by backend
- backend stores or manages authentication context
- browser mainly carries an HTTP-only session cookie
- `me` endpoint returns normalized principal data

This mode should compose:

- `securitydept-oidc-client`
- `securitydept-session-context` — provides `SessionContext<T>`, `SessionPrincipal`, `SessionContextConfig`, and session handle operations
- optional backing session store from the `tower-sessions-*` ecosystem
- optional TS helper for redirect-to-login UX

Current repository status:

- reference implementation exists in `apps/server`
- reusable extraction now exists in `securitydept-session-context`

## Mode C: Stateless Token-Set

Best for:

- strong frontend capability
- distributed SPA applications
- multi-provider environments
- mesh-like user-facing nodes that cannot depend on server-side browser session storage

Target state representation:

- token core data travels in the fragment:
  - `access_token`
  - `id_token`
  - `refresh_token`
  - `expires_at`
- non-token metadata travels through a short-lived redemption handle:
  - `metadata_redemption_id`

Convention:

- Use the generic external field name `refresh_token`
- Use the internal Rust field name `refresh_material` to signal that it may be protected refresh material rather than a raw refresh token that can be sent directly to the OIDC provider
- Resolve `redirect_uri` inside `token-set-context`; the current config types are:
  - `TokenSetRedirectUriConfig`
  - `TokenSetRedirectUriRule`
- The current top-level state model is:
  - `AuthStateSnapshot`
  - `AuthStateDelta`
- After refresh, `AuthenticationSource.kind` should switch to `refresh_token` and record source-kind history in `source_kind_history`
- The state model is now split into:
  - `AuthTokenSnapshot`
  - `AuthTokenDelta`
  - `AuthStateMetadataSnapshot`
  - `AuthStateMetadataDelta`
  - `AuthStateSnapshot`
  - `AuthStateDelta`
  - `PendingAuthStateMetadataRedemption`

Expected frontend capabilities:

- manage multiple provider/source token sets
- attach `Authorization` header automatically
- refresh in the background
- redirect to authorization endpoint when needed
- derive display identity from token material
- handle full snapshots on callback
- handle token deltas and metadata deltas on refresh
- fall back to existing metadata when metadata delta retrieval fails

Expected backend capabilities:

- verify forwarded bearer token when acting as a resource server
- optionally refresh discovery metadata and JWKS through the shared provider runtime
- keep bearer propagation policy explicit
- use a coordinator inside `token-set-context` to unseal refresh material, refresh tokens, rebuild state, and produce transport DTOs
- provide short-lived metadata redemption storage and exchange
- round-trip the final callback `redirect_uri` through `oidc-client` pending OAuth extra data

Failure semantics:

- callback: neither token snapshot nor metadata snapshot may fail
- refresh: token delta may not fail; metadata delta may fail and is treated as an empty delta

Current implementation status:

- `apps/server` already wires:
  - `GET /auth/login/token-set`
  - `GET /auth/callback/token-set`
  - `POST /auth/refresh`
  - `POST /auth/metadata/redeem`
- callback currently returns a full token snapshot fragment and issues `metadata_redemption_id`
- refresh currently returns a token delta fragment and issues `metadata_redemption_id` when metadata changes
- the refresh request payload now uses:
  - `current_auth_state`
- the default metadata redemption implementation is currently `MokaPendingAuthStateMetadataRedemptionStore`

Important note:

This mode does not mean `oidc-client` becomes a resource server. Instead, both `oidc-client` and `oauth-resource-server` should feed a shared authenticated-principal abstraction.

## Shared Future Abstractions

A future reusable auth-context layer should probably define, or is already starting to define:

- `AuthenticatedPrincipal`
- `SealedRefreshMaterial`
- `AuthenticationSource`
- `BearerPropagationPolicy`
- `TokenPropagator`
- `AuthTokenSnapshot`
- `AuthTokenDelta`
- `AuthStateMetadataSnapshot`
- `AuthStateMetadataDelta`
- `AuthStateSnapshot`
- `AuthStateDelta`
- `PendingAuthStateMetadataRedemption`

## Bearer Propagation Policy

For mesh-like deployments, forwarding the original bearer token is only valid when the downstream node accepts the same issuer and audience contract.

A future policy abstraction should distinguish at least:

- transparent forward
- validate then forward
- exchange for downstream token

The third option is future work, but it should already exist in the design language of the project.

---

[English](003-AUTH_CONTEXT_MODES.md) | [中文](../zh/003-AUTH_CONTEXT_MODES.md)
