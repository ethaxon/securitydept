# Architecture

SecurityDept is a layered auth stack, not a monolithic authentication service. Lower crates own protocol and verification primitives; auth-context crates compose those primitives into deployable application contracts.

## Layers

### 1. Verification Primitives

Crate: `securitydept-creds`

- Basic Auth and static-token parsing / verification
- JWT and JWE helpers
- RFC 9068 access-token validation
- shared credential and verifier traits

This layer does not know about browser redirects, OIDC authorization-code flow, application sessions, or route policy.

### 2. Remote Provider Runtime

Crate: `securitydept-oauth-provider`

- OIDC discovery metadata fetch and refresh
- JWKS fetch and refresh
- shared HTTP client reuse
- introspection endpoint access
- provider configuration normalization

This layer is shared by OIDC client code and OAuth resource-server verification.

### 3. OIDC Client

Crate: `securitydept-oidc-client`

- authorization-code and PKCE flow
- callback exchange
- refresh and revocation helpers
- claims normalization
- optional userinfo fetch
- pending OAuth state storage

This crate acquires identity and token material. It does not validate arbitrary bearer tokens presented to APIs.

### 4. OAuth Resource Server

Crate: `securitydept-oauth-resource-server`

- bearer access-token verification for APIs
- JWT, JWE, and opaque-token introspection
- issuer, audience, scope, and time validation
- JWE decryption-key loading and refresh

This crate validates presented tokens. It does not perform browser login or authorization-code redirects.

### 5. Auth Context Crates

Auth-context crates are deployment contracts above the lower layers:

- `securitydept-basic-auth-context`: Basic Auth zones, challenge/login/logout response metadata, post-auth redirects, and optional real-IP access restrictions.
- `securitydept-session-context`: cookie-session auth context, normalized session principal, session service traits, OIDC session service, and dev-session service behind the `service` feature.
- `securitydept-token-set-context`: frontend OIDC mode, backend OIDC mode, access-token substrate, route orchestration, metadata redemption, and bearer propagation.

Route-facing services live in their owning crates:

- `BasicAuthContextService` in `securitydept-basic-auth-context`
- `SessionAuthServiceTrait`, `OidcSessionAuthService`, and `DevSessionAuthService` in `securitydept-session-context`
- `BackendOidcModeAuthService` in `securitydept-token-set-context::backend_oidc_mode`
- `AccessTokenSubstrateResourceService` in `securitydept-token-set-context::access_token_substrate`

The removed `securitydept-auth-runtime` aggregation layer is not a product surface.

### 6. Real-IP Resolution

Crate: `securitydept-realip`

- trusted peer CIDR providers
- effective client-IP resolution across stacked proxies and CDNs
- source-specific trust rules for forwarded headers and transport metadata
- refresh / watch behavior for trusted peer lists

This crate resolves trust-boundary-aware client IP. It does not own URL reconstruction, rate limiting, or business traffic policy.

### 7. Credential Management

Crate: `securitydept-creds-manage`

- manage local Basic Auth credentials and static tokens
- provide operator-managed storage for simple credential data
- support lock-free reads, atomic writes, debounced watching, and self-write detection

This crate stores local credential data. Verification still belongs to `securitydept-creds`.

### 8. Reference Applications

Applications:

- `apps/server`: Axum reference server
- `apps/webui`: React reference UI
- `apps/cli`: local credential-management CLI

Reference applications prove combined behavior; they are not the product boundary for reusable crates or SDK packages.

## Token-Set Context Shape

`token-set-context` has two formal OIDC modes:

- `frontend-oidc`: browser-owned OIDC flow, backend-projected configuration, and access-token substrate integration.
- `backend-oidc`: backend-owned OIDC flow with capability axes for refresh-material protection, metadata delivery, and post-auth redirect policy.

`backend-oidc` presets such as `pure` and `mediated` are profiles inside the `backend-oidc` mode, not separate first-level modes. Token propagation is a shared access-token substrate capability, not a `backend-oidc` preset axis.

Two principal concepts must stay separate:

- `AuthenticatedPrincipal`: human authentication identity used by session and token-set user-info surfaces.
- `ResourceTokenPrincipal`: access-token-derived resource facts used for API authorization and bearer propagation.

## Server Route Boundary

The reference server dashboard API currently tries auth in this order:

1. bearer access token when an `Authorization: Bearer ...` header is present
2. cookie session
3. configured Basic Auth guarded by `basic-auth-context` and optional real-IP policy

`X-SecurityDept-Propagation` makes `/api/*` a propagation-aware dashboard context and requires bearer-token authentication. Basic Auth protocol routes and forward-auth challenge routes intentionally keep protocol-specific response shapes instead of being forced into the shared JSON error envelope.

## Boundary Rules

- `oidc-client` must not absorb resource-server verification.
- `oauth-resource-server` must not absorb browser login flow.
- provider discovery / cache stays below both OIDC client and resource-server verification.
- auth-context crates compose lower crates instead of duplicating their logic.
- framework-specific response assembly belongs at the app or adapter boundary unless the reusable crate intentionally exposes framework-neutral response metadata.
- bearer forwarding must be explicit and policy-checked; it should not be hidden inside login APIs.

---

[English](001-ARCHITECTURE.md) | [中文](../zh/001-ARCHITECTURE.md)
