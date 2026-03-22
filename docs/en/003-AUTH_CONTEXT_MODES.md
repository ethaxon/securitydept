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
- post-auth redirect targets should be validated through the shared redirect-target restriction model instead of using unchecked raw redirect strings

This mode should compose:

- `securitydept-oidc-client`
- `securitydept-session-context` — provides `SessionContext<T>`, `SessionPrincipal`, `SessionContextConfig`, and session handle operations
- `securitydept-auth-runtime` — composes `oidc-client` and `session-context` into route-ready session auth services such as `OidcSessionAuthService` and `DevSessionAuthService`
- optional backing session store from the `tower-sessions-*` ecosystem
- optional TS helper for redirect-to-login UX

Current repository status:

- reference implementation exists in `apps/server`
- reusable extraction now exists in `securitydept-session-context`
- route-level session auth orchestration now exists in `securitydept-auth-runtime`

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
- Resolve `post_auth_redirect_uri` inside `token-set-context`; the current config types are:
  - `TokenSetRedirectUriConfig`
  - `TokenSetRedirectUriRule`
- `oidc-client` now exposes default pending OAuth store aliases for the common case:
  - `DefaultPendingOauthStore`
  - `DefaultPendingOauthStoreConfig`
  - `DefaultOidcClient`
  - `DefaultOidcClientConfig`
- The current top-level state model is:
  - `AuthStateSnapshot`
  - `AuthStateDelta`
- After refresh, `AuthenticationSource.kind` should switch to `refresh_token` and record source-kind history in `kind_history`
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
- let `token-set-context` own refresh material protection, redirect URI resolution, metadata redemption, state reconstruction, and transport DTO generation
- let `auth-runtime` expose route-ready token-set handlers on top of `token-set-context`
- provide short-lived metadata redemption storage and exchange
- round-trip the final callback `post_auth_redirect_uri` through `oidc-client` pending OAuth extra data

Failure semantics:

- callback: neither token snapshot nor metadata snapshot may fail
- refresh: token delta may not fail; metadata delta may fail and is treated as an empty delta

Current implementation status:

- `apps/server` already wires:
  - `GET /auth/session/login`
  - `GET /auth/session/callback`
  - `POST /auth/session/logout`
  - `GET /auth/session/me`
  - `GET /auth/token-set/login`
  - `GET /auth/token-set/callback`
  - `POST /auth/token-set/refresh`
  - `POST /auth/token-set/metadata/redeem`
- callback currently returns a full token snapshot fragment and issues `metadata_redemption_id`
- refresh currently returns a token delta fragment and issues `metadata_redemption_id` when metadata changes
- the refresh request payload now uses:
  - required `refresh_token`
  - optional previous `id_token`
  - optional `current_metadata_snapshot`
- reusable token-set route orchestration now exists in `securitydept-auth-runtime::TokenSetAuthService`
- the default metadata redemption implementation now includes:
  - `MokaPendingAuthStateMetadataRedemptionStore`
  - `DefaultTokenSetContext`
  - `DefaultTokenSetContextConfig`

Important note:

This mode does not mean `oidc-client` becomes a resource server.

Current code separates:

- `AuthenticatedPrincipal` for authentication-facing identity data from `id_token` / `user_info`
- `ResourceTokenPrincipal` for access-token-derived resource facts from JWT validation or introspection

## Shared Future Abstractions

A future reusable auth-context layer should probably define, or is already starting to define:

- `AuthenticatedPrincipal`
- `SealedRefreshMaterial`
- `AuthenticationSource`
- `BearerPropagationPolicy`
- `TokenPropagator`
- `PropagatedBearer`
- `AuthTokenSnapshot`
- `AuthTokenDelta`
- `AuthStateMetadataSnapshot`
- `AuthStateMetadataDelta`
- `AuthStateSnapshot`
- `AuthStateDelta`
- `PendingAuthStateMetadataRedemption`

## Bearer Propagation Policy

For mesh-like deployments, forwarding the original bearer token is only valid when the downstream node accepts the same issuer and audience contract.

The current propagation model is server-owned. The auth-state metadata does not carry propagation policy, and it does not carry resource-token facts.

The server config now distinguishes:

- validate then forward
- exchange for downstream token

Direct forwarding uses explicit destination and token validation configuration:

- `TokenPropagatorConfig.default_policy`
- `TokenPropagatorConfig.destination_policy`
- `TokenPropagatorConfig.token_validation`

Destination allowlists support:

- `allowed_node_ids`
- `AllowedPropagationTarget::ExactOrigin`
- `AllowedPropagationTarget::DomainSuffix`
- `AllowedPropagationTarget::DomainRegex`
- `AllowedPropagationTarget::Cidr`

Token validation supports:

- issuer allowlist
- audience allowlist
- required scopes
- allowed `azp`

Current runtime boundary:

- `TokenPropagator` validates `PropagatedBearer`
- `PropagatedBearer` carries the raw bearer string plus optional `ResourceTokenPrincipal`
- `PropagationRequestTarget` may be fully specified with scheme/hostname/optional port, or may carry only `node_id`
- node-only targets require an optional runtime `PropagationNodeTargetResolver`; otherwise validation fails explicitly
- `TokenPropagator` exposes a runtime `set_node_target_resolver(...)` hook, so the resolver can be installed or swapped after construction
- propagation checks do not read `AuthStateSnapshot`
- expiration / active checks are expected to happen in the resource-server verification step that produced `ResourceTokenPrincipal`

Current reference-server behavior:

- the main dashboard API (`/api/*`) can enter a propagation-aware mode via `X-SecurityDept-Propagation`
- the header value uses a Forwarded-style parameter list, for example `by=dashboard;for=node-a;host=service.internal.example.com:443;proto=https`
- in that mode the server requires bearer access-token authentication and does not fall back to cookie session or basic-auth
- successful bearer authentication keeps resource-token facts in request runtime context so propagation-aware handlers can perform `token-set-context` validation

Planned forwarding direction:

- `TokenPropagator` is still only a policy and header-attachment component; it is not a full reverse proxy
- the planned direction is a recommended forwarder feature layered above `TokenPropagator`
- that forwarder should handle standard proxy concerns such as `Forwarded` / `X-Forwarded-*`, while `TokenPropagator` remains focused on destination and token validation

Example:

```yaml
token_propagation:
  default_policy: validate_then_forward
  destination_policy:
    allowed_node_ids:
      - registry-mirror-a
    allowed_targets:
      - kind: exact_origin
        scheme: https
        hostname: registry-mirror.internal.example.com
        port: 443
      - kind: domain_suffix
        scheme: https
        domain_suffix: mesh.internal.example.com
        port: 443
      - kind: domain_regex
        scheme: https
        domain_regex: '^api-[a-z0-9-]+\.mesh\.internal\.example\.com$'
        port: 443
      - kind: cidr
        scheme: https
        cidr: 10.0.0.0/24
        port: 8443
    deny_sensitive_ip_literals: true
    require_explicit_port: true
  token_validation:
    required_issuers:
      - https://issuer.example.com
    allowed_audiences:
      - mesh-api
    required_scopes:
      - mesh.forward
    allowed_azp:
      - securitydept-web
```

`exchange_for_downstream_token` is still future work, but it remains part of the design language and config surface.

---

[English](003-AUTH_CONTEXT_MODES.md) | [中文](../zh/003-AUTH_CONTEXT_MODES.md)
