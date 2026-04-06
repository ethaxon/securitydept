# Architecture

This document describes the intended layered architecture after the recent providerOIDC clientand resource-server split.

## Layer 1: Verification Primitives

Crate: `securitydept-creds`

Responsibilities:

- Basic Auth parsing and verification
- static token parsing and verification
- JWT verification helpers
- JWE decryption helpers
- RFC 9068 access-token validation
- shared credential and verifier traits

This layer should not know about:

- OIDC login redirects
- OAuth authorization code flow
- browser state
- application sessions

## Layer 2: Remote Provider Runtime

Crate: `securitydept-oauth-provider`

Responsibilities:

- OIDC discovery metadata fetch and refresh
- remote JWKS fetch and refresh
- shared HTTP client and connection reuse
- introspection endpoint access
- provider config normalization

This layer is shared by both the OIDC client and the resource-server verifier.

## Layer 3: OIDC Client

Crate: `securitydept-oidc-client`

Responsibilities:

- authorization code flow
- PKCE support
- callback exchange
- refresh flow
- claims normalization and optional claims script
- userinfo fetch when configured

This crate acquires identity and token material. It does not verify bearer tokens presented to arbitrary APIs.

## Layer 4: OAuth Resource Server

Crate: `securitydept-oauth-resource-server`

Responsibilities:

- verify bearer access tokens presented to APIs
- support JWTJWEand opaque token introspection
- apply issueraudiencescopeand time validation policy
- manage local JWE decryption keys and key rotation watcher

This crate validates bearer tokens. It does not perform browser login or authorization-code redirect flows.

## Layer 5: Auth Context Modes

Planned higher-level compositions built above layers 1-4:

- basic auth zone mode
- cookie-session mode
- stateless token-set mode

These modes are deployment contracts. They should expose normalized principal data regardless of whether identity came from:

- OIDC callback results
- bearer access-token verification
- local basic-auth credentials
- static-token credentials

Current dedicated crates:

- `securitydept-basic-auth-context` — reusable basic-auth context with zone modelpost-auth redirect policyand optional real-IP access control; `BasicAuthContextService` now lives directly in this crate
- `securitydept-session-context` — extracted reusable session context abstraction for cookie-session modeincluding post-auth redirect policywithout direct Axum response types; route-facing `SessionAuthServiceTrait``OidcSessionAuthService`and `DevSessionAuthService` are now directly in this crate via the `service` feature
- `securitydept-token-set-context` — extracted reusable auth-stateredirectmetadata-redemptionand bearer-propagation coordination layer for stateless token-set mode; `BackendOidcModeAuthService` and `AccessTokenSubstrateResourceService` now live directly in this crate

The `securitydept-session-context` crate provides:

- `SessionContext<T>` — generic session context with principalattributesand optional extra data
- `SessionPrincipal` — normalized principal with display namepictureand claims
- `SessionContextConfig` — session cookie and security configuration
- `SessionContextSession` — session handle for insert/get/require/clear operations

The `securitydept-token-set-context` crate currently provides:

- canonical target: top-level `frontend_oidc_mode` / `backend_oidc_mode`
- top-level `access_token_substrate` / `orchestration` / `models`
- `BackendOidcModeRuntime`
- `BackendOidcModeConfig` (raw input) / `ResolvedBackendOidcModeConfig` (resolved bundle)
- `BackendOidcModeConfigSource` trait — composable config-source trait for adopters, exposing `resolve_oidc_client`, `resolve_runtime`, and `resolve_all`
- `BackendOidcModeAuthService` — route-facing service for backend OIDC mode
- `FrontendOidcModeConfigProjection` — backend-to-frontend OIDC configuration projection
- `TokenPropagator`
- `PropagatedBearer`
- metadata-redemption store traits and related default implementations

The more accurate mode boundary is:

- `frontend-oidc` and `backend-oidc` are the formal modes
- `backend-oidc` is now unified as a 3-axis capability framework providing `pure` and `mediated` as presets / profiles; `TokenPropagation` is now owned by `access_token_substrate`
- OIDC protocol flows (authorize / callback / refresh / exchange) are provided by `OidcClient`; `securitydept-oidc-client::auth_state` provides shared cross-preset identity extraction (`OidcExtractedPrincipal`, `extract_principal_from_code_callback`, `extract_principal_from_refresh_result`)
- mode runtimes handle capability-specific post-processing (sealed refresh vs plain, metadata fallback, redirect policy, and so on)
- `backend-oidc` capability axes are parameterized by concrete config
- `frontend-oidc` has no backend runtime, but exposes formal `Config / ResolvedConfig / ConfigSource / Runtime / Service / ConfigProjection` via `frontend_oidc_mode`

Important current boundary:

- `AuthStateMetadataSnapshot` carries authentication-facing metadata such as `AuthenticatedPrincipal`
- access-token-derived facts used for resource authorization and bearer propagation are modeled separately as `ResourceTokenPrincipal`
- `TokenPropagator` now validates `PropagatedBearer` plus destination contextrather than reading the whole auth-state snapshot
- node-only propagation targets are resolved through an optional `PropagationNodeTargetResolver`
- request forwarding itself is still kept separate from the core propagation policybut `securitydept-token-set-context` now provides an optional `axum-reverse-proxy-propagation-forwarder` feature layered above `TokenPropagator`

Route-facing services now live directly in their owning crates:

- `SessionAuthServiceTrait` / `OidcSessionAuthService` / `DevSessionAuthService` → `securitydept-session-context` (feature: `service`)
- `BasicAuthContextService` → `securitydept-basic-auth-context`
- `BackendOidcModeAuthService` (formerly `TokenSetAuthService`) → `securitydept-token-set-context::backend_oidc_mode`
- `AccessTokenSubstrateResourceService` (formerly `TokenSetResourceService`) → `securitydept-token-set-context::access_token_substrate`

The `securitydept-auth-runtime` aggregation layer has been dissolved and removed from the workspace.

Current boundary note:

- the long-term direction for `securitydept-basic-auth-context``securitydept-session-context`and `securitydept-token-set-context` is framework-neutral HTTP response metadata or service contracts rather than Axum response types
- Axum-specific response assembly is kept in `apps/server`

A future shared abstraction should likely normalize all of them into a common authenticated-principal model.

## Layer 6: Real IP Resolution

Crate: `securitydept-realip`

Responsibilities:

- model trusted peer CIDR providers
- resolve effective client IP across stacked CDN and reverse-proxy hops
- apply source-specific trust rules for transport metadata and forwarded headers
- manage refresh and watch behavior for trusted peer lists

This crate is about trust-boundary-aware client-IP resolution. It is not responsible for URL reconstructionrate limitingor traffic filtering policy.

## Layer 7: Credential Management

Crate: `securitydept-creds-manage`

Responsibilities:

- manage local basic-auth credentials
- manage local static tokens
- provide storage and synchronization primitives for simple operator-managed credentials
- support scenarios such as registry login management and basic gateway auth
- lock-free reads via `ArcSwap` snapshot publishing
- atomic file writes (temp file → fsync → rename) to prevent corruption
- debounced filesystem watching (`notify-debouncer-full`) with automatic polling fallback
- content-hash-based self-write detection to avoid recursive reloads

This crate is operational storagenot the token-verification core.

## Layer 8: Reference Applications

Apps:

- `apps/server`
- `apps/cli`
- `apps/webui`

`apps/server` should remain a proving ground for combined capabilities:

- low-level verification
- basic auth context mode
- cookie-session mode
- stateless token-set mode
- creds-manage integration
- real-IP-aware dashboard access control

It is not the architecture boundary for the project.

## Important Boundary Rules

- `oidc-client` must not absorb resource-server verification.
- `oauth-resource-server` must not absorb browser login flow.
- provider caching/discovery must stay below both of them.
- real-IP trust resolution should live below applications and should not be duplicated ad hoc in each server.
- auth-context modes should compose lower crates instead of duplicating their logic.
- bearer-token forwarding should be modeled explicitly and should not be hidden inside login APIs.

## Mesh-Oriented Scenario Guidance

For distributed nodes inside a virtual LAN:

- a user-facing node may run OIDC client logic
- the same node may also validate or transparently forward bearer tokens
- internal nodes may run only resource-server verification
- stateless operation means no server-side browser session storenot the absence of token semantics

Transparent forwarding is only correct when the downstream node accepts the same issuer and audience contract. If audiences differthe future design must introduce token exchange instead of naive forwarding.

---

[English](001-ARCHITECTURE.md) | [中文](../zh/001-ARCHITECTURE.md)
