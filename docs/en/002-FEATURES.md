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
- `packages/creds/src/zone/mod.rs`

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

- design documented
- lower-level pieces exist
- reference integration is still incomplete as a first-class auth-context mode

Primary references:

- `packages/creds/src/zone/mod.rs`
- [004-BASIC_AUTH_ZONE.md](004-BASIC_AUTH_ZONE.md)

## 5. Stateful cookie-session auth context

Target:

- simple centralized deployment mode
- good fit for weak frontend capability
- later optional TS helper for redirecting to login

Current status:

- partially implemented in `apps/server`
- current server flow uses in-memory sessions after OIDC callback
- not yet extracted into a dedicated reusable auth-context layer

Primary references:

- `apps/server/src/routes/auth.rs`
- `apps/server/src/middleware.rs`
- `packages/creds-manage/src/session.rs`

## 6. Stateless token-set auth context

Target:

- `id_token + access_token + sealed_refresh_token`
- no server-side browser session storage
- suitable for distributed SPA and mesh-like proxy scenarios
- later frontend TS SDK for token storage, header injection, refresh, and login redirects

Current status:

- planned
- lower-level pieces exist, but no dedicated token-set context layer yet

Missing pieces:

- token-set model and lifecycle rules
- sealed refresh-token handling contract for frontend-owned state
- normalized principal extraction from token sets
- bearer propagation policy for same-resource forwarding
- TS SDK for multi-provider token management

## 7. creds-manage

Target:

- manage simple Basic Auth and static token credentials
- support operator-managed scenarios such as Docker registry login accounts

Current status:

- implemented
- already used by the reference server and CLI

Primary code:

- `packages/creds-manage/src/store.rs`
- `packages/creds-manage/src/models.rs`
- `packages/creds-manage/src/auth.rs`
- `apps/cli/src/main.rs`

## 8. Reference server app

Target:

- validate the combined stack from items 1 + 4/5/6 + 7
- serve as the proving ground for real deployment scenarios

Current status:

- implemented as `apps/server`
- currently validates mainly cookie-session mode plus creds-manage and lower-level auth pieces
- should evolve to validate basic auth zone and stateless token-set modes as first-class scenarios

## Recommended Near-Term Focus

1. extract reusable auth-context abstractions above `oidc-client` and `oauth-resource-server`
2. implement basic auth zone mode as a documented, reference-backed flow
3. implement stateless token-set mode with explicit token lifecycle rules
4. add TS SDK support for modes 4, 5, and especially 6
5. keep `apps/server` as the integration proving ground for all supported modes

---

[English](002-FEATURES.md) | [中文](../zh/002-FEATURES.md)
