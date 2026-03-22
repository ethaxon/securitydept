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
- JWT, JWE, opaque token introspection
- issuer, audience, scope policy
- shared provider runtime reuse

Current status:

- implemented in `securitydept-oauth-resource-server`
- currently focused on verification, not yet on higher-level auth-context UX

Primary code:

- `packages/oauth-resource-server/src/verifier/mod.rs`
- `packages/oauth-resource-server/src/verifier/introspection.rs`
- `packages/oauth-resource-server/src/verifier/jwe.rs`
- `packages/oauth-resource-server/src/config/*`

## 4. Basic auth zone mode

Target:

- minimal browser-native auth mode
- simple challenge-trigger flow
- optional TS helper for redirecting to the auth endpoint

Current status:

- implemented as `securitydept-basic-auth-context`
- includes reusable zones, post-auth redirect policy, and optional `securitydept-realip::RealIpAccessConfig`
- integrated into the reference server as the `/basic/*` dashboard access path and `/basic/api/*` API alias

Primary references:

- `packages/basic-auth-context/src/lib.rs`
- [004-BASIC_AUTH_ZONE.md](004-BASIC_AUTH_ZONE.md)

## 5. Stateful cookie-session auth context

Target:

- simple centralized deployment mode
- good fit for weak frontend capability
- later optional TS helper for redirecting to login

Current status:

- reference implementation exists in `apps/server`
- reusable extraction now lives in `securitydept-session-context`

Primary references:

- `packages/session-context/src/lib.rs`
- `apps/server/src/routes/auth/mod.rs`
- `apps/server/src/routes/auth/session.rs`
- `apps/server/src/middleware.rs`

## 6. Stateless token-set auth context

Target:

- composition of token snapshot/delta and metadata snapshot/delta
- no server-side browser session storage
- suitable for distributed SPA and mesh-like proxy scenarios
- later frontend TS SDK for token storage, header injection, refresh, and login redirects

Current status:

- core server support and shared crate are implemented
- `securitydept-token-set-context` now provides a dedicated token-set context layer
- `securitydept-auth-runtime` now provides route-ready token-set orchestration on top of `securitydept-token-set-context`
- `apps/server` already exposes `/auth/token-set/*` routes for callback, refresh, and metadata redemption
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
- the client SDK is still planned as a separate follow-up

Missing pieces:

- client-side merge, persistence, and background refresh behavior
- browser-side redemption and fallback handling for `metadata_redemption_id`
- TS SDK for multi-provider token management
- more complete token-exchange / downstream propagation scenarios
- richer forwarding policy and more complete downstream token-exchange scenarios on top of the current `axum-reverse-proxy` forwarder feature

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
- debounced filesystem watching via `notify-debouncer-full` on the parent directory, with automatic 1s polling fallback when FS events are unavailable
- content-hash-based self-write detection: after a successful save, the store records the written content hash; the watcher skips the next matching event to prevent recursive reloads

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
- includes provider-backed trusted CIDR resolution, trust-boundary-aware parsing, and reusable `RealIpAccessConfig`
- integrated into the reference server for basic-auth dashboard restrictions

Primary references:

- [006-REALIP.md](006-REALIP.md)

## 9. Reference server app

Target:

- validate the combined stack from items 1 + 4/5/6 + 7
- serve as the proving ground for real deployment scenarios

Current status:

- implemented as `apps/server`
- already validates cookie-session, basic-auth-context, stateless token-set, creds-manage, and real-IP-aware dashboard access
- now integrates the `axum-reverse-proxy` propagation forwarder for bearer-authenticated downstream forwarding via `/api/propagation/*`
- should continue evolving as the proving ground for richer multi-zone deployments

## Recommended Near-Term Focus

1. continue refining the reusable auth-context abstractions above `oidc-client` and `oauth-resource-server`
2. implement basic auth zone mode as a documented, reference-backed flow
3. implement stateless token-set mode with explicit token lifecycle rules
4. add TS SDK support for modes 4, 5, and especially 6
5. implement `securitydept-realip` as a reusable trust-boundary module
6. keep `apps/server` as the integration proving ground for all supported modes

---

[English](002-FEATURES.md) | [中文](../zh/002-FEATURES.md)
