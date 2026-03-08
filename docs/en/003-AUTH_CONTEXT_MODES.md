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
- `securitydept-creds-manage` or a future dedicated session-context layer
- optional TS helper for redirect-to-login UX

Current repository status:

- reference implementation exists in `apps/server`
- reusable extraction is still pending

## Mode C: Stateless Token-Set

Best for:

- strong frontend capability
- distributed SPA applications
- multi-provider environments
- mesh-like user-facing nodes that cannot depend on server-side browser session storage

Target state representation:

- `id_token`
- `access_token`
- `sealed_refresh_token`

Expected frontend capabilities:

- manage multiple provider/source token sets
- attach `Authorization` header automatically
- refresh in the background
- redirect to authorization endpoint when needed
- derive display identity from token material

Expected backend capabilities:

- verify forwarded bearer token when acting as a resource server
- optionally refresh discovery metadata and JWKS through the shared provider runtime
- keep bearer propagation policy explicit

Important note:

This mode does not mean `oidc-client` becomes a resource server. Instead, both `oidc-client` and `oauth-resource-server` should feed a shared authenticated-principal abstraction.

## Shared Future Abstractions

A future reusable auth-context layer should probably define:

- `AuthenticatedPrincipal`
- `ManagedTokenSet`
- `SealedRefreshMaterial`
- `AuthenticationSource`
- `BearerPropagationPolicy`

## Bearer Propagation Policy

For mesh-like deployments, forwarding the original bearer token is only valid when the downstream node accepts the same issuer and audience contract.

A future policy abstraction should distinguish at least:

- transparent forward
- validate then forward
- exchange for downstream token

The third option is future work, but it should already exist in the design language of the project.

---

[English](003-AUTH_CONTEXT_MODES.md) | [中文](../zh/003-AUTH_CONTEXT_MODES.md)
