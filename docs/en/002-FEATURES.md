# Capability Matrix

This document maps the current codebase against the new project goals.

## 1. Low-level creds verification

Target:

- Basic Auth
- static token
- RFC 9068 access tokens
- JWT and JWE helpers
- reusable verification traits

Current status:

- largely implemented in `securitydept-creds`

Primary code:

- `packages/creds/src/basic.rs`
- `packages/creds/src/static_token.rs`
- `packages/creds/src/jwt.rs`
- `packages/creds/src/jwe.rs`
- `packages/creds/src/rfc9068.rs`
- `packages/creds/src/validator.rs`

## 2. Upper-layer OIDC client

Target:

- login redirect
- callback
- PKCE
- refresh
- claims normalization
- optional userinfo and claims script

Current status:

- implemented in `securitydept-oidc-client`
- now backed by shared `securitydept-oauth-provider`

Primary code:

- `packages/oidc-client/src/client.rs`
- `packages/oidc-client/src/config.rs`
- `packages/oidc-client/src/models.rs`
- `packages/oidc-client/src/pending_store/*`

## 3. Upper-layer OAuth resource server

Target:

- bearer-token verification for APIs
- JWTJWEopaque token introspection
- issueraudiencescope policy
- shared provider runtime reuse

Current status:

- implemented in `securitydept-oauth-resource-server`
- currently focused on verificationnot yet on higher-level auth-context UX

Primary code:

- `packages/oauth-resource-server/src/verifier/mod.rs`
- `packages/oauth-resource-server/src/verifier/introspection.rs`
- `packages/oauth-resource-server/src/verifier/jwe.rs`
- `packages/oauth-resource-server/src/config/*`

## 4. Basic auth zone mode

Target:

- minimal browser-native auth mode
- simple challenge-trigger flow
- thin client helper for zone-aware redirect handling around the auth endpoint

Current status:

- implemented as `securitydept-basic-auth-context`
- includes reusable zonespost-auth redirect policyand optional `securitydept-realip::RealIpAccessConfig`
- no longer requires Axum directly; callers can adapt the returned HTTP response metadata to their own framework
- integrated into the reference server as the `/basic/*` dashboard access path and `/basic/api/*` API alias
- browser-side packages ship as `@securitydept/basic-auth-context-client` (`/web`, `-react`, `-angular`); see [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md). Implementations stay thin: zone-aware `401 -> login` redirects and logout URL handling

Primary references:

- `packages/basic-auth-context/src/lib.rs`
- [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)
- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

## 5. Stateful cookie-session auth context

Target:

- simple centralized deployment mode
- good fit for weak frontend capability
- later optional TS helper for redirecting to login

Current status:

- reference implementation exists in `apps/server`
- reusable extraction now lives in `securitydept-session-context`
- reusable crate now depends on `tower-sessions` plus `http`without direct Axum response types
- the corresponding TypeScript packages ship as `@securitydept/session-context-client` with `/web`, `-react`, and `-angular` entry points; see [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

Primary references:

- `packages/session-context/src/lib.rs`
- `apps/server/src/routes/auth/mod.rs`
- `apps/server/src/routes/auth/session.rs`
- `apps/server/src/middleware.rs`
- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

## 6. Stateless token-set auth context

Target:

- composition of token snapshot/delta and metadata snapshot/delta
- no server-side browser session storage
- suitable for distributed SPA and mesh-like proxy scenarios
- TypeScript client packages for token storage, header injection, refresh, and login redirects (`token-set-context-client` family and framework adapters; see [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md))

Current status:

- core server support and shared crate are implemented
- `securitydept-token-set-context` now provides a dedicated token-set context layer
- `securitydept-auth-runtime` has been dissolved; route helpers are now in their owning crates: `BasicAuthContextService` in `securitydept-basic-auth-context`, `SessionAuthServiceTrait` / `OidcSessionAuthService` / `DevSessionAuthService` in `securitydept-session-context` (via `service` feature), and `BackendOidcModeAuthService` plus `AccessTokenSubstrateResourceService` in `securitydept-token-set-context`
- `BackendOidcModeConfigSource` trait is now in place: `BackendOidcModeConfig` (raw input) / `ResolvedBackendOidcModeConfig` (resolved bundle) / `BackendOidcModeConfigSource` trait are all implemented
- the previously split `backend-oidc-pure` and `backend-oidc-mediated` have been merged into a single `backend-oidc` capability framework:
  - OIDC protocol flows (authorize / callback / refresh / exchange) are provided by `OidcClient`; `securitydept-oidc-client::auth_state` provides identity extraction shared across presets (principal / issuer)
  - the former split modes are now expressed as `pure` and `mediated` presets / profiles, parameterized by a unified 3-axis configuration (`refresh_material_protection`, `metadata_delivery`, `post_auth_redirect_policy`); token propagation is a separate shared capability owned by `access_token_substrate`
  - `frontend_oidc_mode` now has formal `Config / ResolvedConfig / ConfigSource / Runtime / Service / ConfigProjection`
- `apps/server` already exposes `/auth/token-set/*` routes for callbackrefreshand metadata fallback
- bearer propagation now uses server-owned destination policy plus access-token-derived `ResourceTokenPrincipal` facts
- `TokenPropagator` now accepts either a direct destination target or a node-only target resolved via an optional runtime `PropagationNodeTargetResolver`
- `securitydept-token-set-context` now includes an optional `axum-reverse-proxy-propagation-forwarder` feature, with `recommend-propagation-forwarder` as a feature alias
- `apps/server` dashboard API auth order is now:
  - bearer access token first when a bearer header is present
  - then cookie session
  - then configured basic-auth guarded by `basic-auth-context` and optional real-IP policy
- `apps/server` now treats `X-SecurityDept-Propagation` as a propagation-aware dashboard context:
  - the header value uses a Forwarded-style parameter format such as `by=dashboard;for=node-a;host=service.internal.example.com:443;proto=https`
  - `/api/*` requires bearer access-token authentication in that case
  - `/basic/*` returns an auth-method mismatch response instead of challenging basic auth
- `apps/server` now integrates the `AxumReverseProxyPropagationForwarder` for actual downstream forwarding:
  - enabled when the `[propagation_forwarder]` config section is present
  - `/api/propagation/*` catch-all route forwards bearer-authenticated requests with validated propagation context to resolved downstream targets
- the client SDK now has a formal architecture and implementation guide in [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md), and the current work has moved into contract freeze / surface cleanup rather than “implementation pending”
- Axum-specific response assembly for those flows now lives in `apps/server`not inside the reusable runtime crate
- the configuration surface has been reshaped to `BackendOidcModeConfig` (raw input) / `ResolvedBackendOidcModeConfig` (resolved bundle) / `BackendOidcModeConfigSource` trait (now implemented)

Missing pieces:

- client-side merge, persistence, and background refresh behavior
- browser-side redemption and fallback handling for `metadata_redemption_id`
- multi-provider token management in the TS SDK
- mixed-custody and stateful BFF token-set behavior are now recognized as design boundaries, but remain provisional and are not a v1 implementation target
- more complete token-exchange / downstream propagation scenarios
- richer forwarding policy and more complete downstream token-exchange scenarios on top of the current `axum-reverse-proxy` forwarder feature

Planning reference:

- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

## 7. creds-manage

Target:

- manage simple Basic Auth and static token credentials
- support operator-managed scenarios such as Docker registry login accounts

Current status:

- implemented
- already used by the reference server and CLI

Storage design:

- `ArcSwap<DataFile>` for lock-free concurrent reads
- atomic file writes via `atomic-write-file` (temp file → fsync → rename)
- debounced filesystem watching via `notify-debouncer-full` on the parent directorywith automatic 1s polling fallback when FS events are unavailable
- content-hash-based self-write detection: after a successful savethe store records the written content hash; the watcher skips the next matching event to prevent recursive reloads

Primary code:

- `packages/creds-manage/src/store.rs`
- `packages/creds-manage/src/models.rs`
- `packages/creds-manage/src/auth.rs`
- `apps/cli/src/main.rs`

## 8. real-IP resolution

Target:

- trusted-peer-aware client IP resolution
- support for stacked CDN and reverse-proxy chains
- source-specific precedence for PROXY protocol and forwarded headers
- remote refresh and local watch for trusted CIDR providers

Current status:

- implemented as `securitydept-realip`
- includes provider-backed trusted CIDR resolutiontrust-boundary-aware parsingand reusable `RealIpAccessConfig`
- integrated into the reference server for basic-auth dashboard restrictions

Primary references:

- [006-REALIP.md](006-REALIP.md)

## 9. Reference server app

Target:

- validate the combined stack from items 14/5/67
- serve as the proving ground for real deployment scenarios

Current status:

- implemented as `apps/server`
- already validates cookie-sessionbasic-auth-contextstateless token-setcreds-manageand real-IP-aware dashboard access
- now integrates the `axum-reverse-proxy` propagation forwarder for bearer-authenticated downstream forwarding via `/api/propagation/*`
- should continue evolving as the proving ground for richer multi-zone deployments

## Recommended Near-Term Focus

1. continue refining the reusable auth-context abstractions above `oidc-client` and `oauth-resource-server`
2. implement basic auth zone mode as a documentedreference-backed flow
3. implement stateless token-set mode with explicit token lifecycle rules
4. add TS SDK support for modes 45and especially 6
5. implement `securitydept-realip` as a reusable trust-boundary module
6. keep `apps/server` as the integration proving ground for all supported modes

---

[English](002-FEATURES.md) | [中文](../zh/002-FEATURES.md)
