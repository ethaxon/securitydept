# Auth Context and Modes

An auth context is an application-facing authentication integration boundary. It owns the location of state, the redirect and persistence model, and the principal shape exposed to the host application.

## Product Model

| Context | State owner | Use when | Main surfaces |
| --- | --- | --- | --- |
| Basic Auth | Browser credential cache and server challenge boundary | A small administrative area needs HTTP Basic Auth semantics. | `basic-auth-context` |
| Session | Server session store and HTTP-only cookie | The server should own login, callback, and user state. | `session-context` |
| Token set | The selected OIDC mode and client runtime | A browser or server-mediated OIDC integration needs access-token state. | `token-set-context` |

## Basic Auth Context

A Basic Auth `zone` describes one challenge boundary: route prefix, login path, post-auth redirect policy, and optional client-IP restrictions. A zone is not an auth context of its own.

The browser owns cached Basic Auth credentials and exposes no reliable programmatic revocation operation. The server therefore exposes no Basic Auth logout route. `BasicAuthContextClient.logout()` only clears the client's current in-memory boundary projection; a later probe may resolve as authenticated again when the browser continues sending credentials.

The reference server accepts root-absolute, same-origin WebUI return paths for Basic Auth login, including dashboard routes. Absolute URLs, network-path references such as `//host/path`, and backslash variants are rejected by the server redirect policy.

## Session Context

Session context is server owned. The server handles OIDC login, callback, logout, and normalized user-info; the browser carries the session cookie and invokes explicit client operations for navigation or session refresh. Session context has no mode family.

## Token-Set Context

A token-set `mode` describes the OIDC integration shape:

- `frontend-oidc`: the browser performs authorization-code/PKCE work. The server projects a safe configuration DTO; the client owns its in-memory token snapshot and lifecycle.
- `backend-oidc`: the server performs the OIDC redirect/callback/refresh protocol and exposes the mode contract to the client.

Backend-mode presets and capability choices are configurations within `backend-oidc`, not additional top-level modes. Bearer propagation belongs to the access-token substrate, not to a backend-mode capability axis.

### Browser Projection And Secret Boundary

`frontend-oidc` receives `FrontendOidcModeConfigProjection`, a server-produced browser DTO. It contains the resolved public OIDC connectivity and callback information needed by the browser, not the server's complete OIDC configuration. Client secrets are omitted by default and can be included only through an explicit unsafe server capability; a browser application must not treat that opt-in as a normal deployment default.

Server-held secret values use `SecretString`, whose debug and serialization forms are redacted. The same rule applies at application boundaries: raw access tokens, refresh tokens, authorization headers, passwords, provider secrets, and token-exchange payloads are never safe browser projections or public event data.

The reference server exposes the public frontend projection at `GET /api/auth/token-set/frontend-mode/config`. Backend-mode login, callback, refresh, metadata redemption, and user-info live below `/auth/token-set/backend-mode/*`. Hosts may mount different paths, but must keep callback and redirect validation inside server policy rather than accepting caller-controlled URLs.

## Principal And Token Boundaries

- An authenticated principal represents the signed-in person and is used for session/token-set user-facing state.
- A resource-token principal represents verified bearer-token authorization facts such as subject, issuer, audiences, scopes, and authorized party.

They are related but not interchangeable. Raw token material, authorization headers, passwords, and provider/client secrets must not be projected into safe principal claims.

`ResourceTokenPrincipal` is authorization evidence derived from a verified bearer token: subject, issuer, audiences, scopes, authorized party, and claims. It is not a substitute for the authenticated human principal used by session or token-set user-facing state.

## Host Configuration

Rust hosts resolve configuration in stages:

1. serde-facing raw configuration receives file and environment input.
2. a crate-owned config source applies shared OIDC defaults and host validators.
3. a resolved configuration constructs reusable runtimes.

Hosts keep route paths, source keys, account bindings, display data, and other product-specific policy outside reusable config projections. Redirect targets are validated against host policy; no auth context accepts unchecked arbitrary redirect URLs.

---

[English](020-AUTH_CONTEXT_AND_MODES.md) | [中文](../zh/020-AUTH_CONTEXT_AND_MODES.md)
