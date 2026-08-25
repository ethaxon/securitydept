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

Server-held secret values use `SecretString`, whose debug and serialization forms are redacted. The same rule applies at application boundaries: raw access tokens, refresh tokens, authorization headers, passwords, provider secrets, and token-exchange payloads must not enter safe configuration/principal projections or public events. Token material used by a mode client remains an in-process credential, not a safe DTO.

The reference server exposes the public frontend projection at `GET /api/auth/token-set/frontend-mode/config`. Backend-mode login, callback, refresh, metadata redemption, and user-info live below `/auth/token-set/backend-mode/*`. Hosts may mount different paths, but must keep callback and redirect validation inside server policy rather than accepting caller-controlled URLs.

### Browser Runtime And Token Copying

Frontend OIDC requires host Web Crypto capabilities; see [runtime checks and polyfill requirements](007-CLIENT_SDK_GUIDE.md#frontend-oidc-runtime-capabilities). Server-mediated session/backend OIDC does not move its cryptographic operations into the browser.

The reference WebUI's generated-token panel attempts clipboard copying and reports success. If the clipboard API is missing or permission/write fails, it keeps the token visible in a read-only field, selects it, and shows manual-copy instructions and a selection button. Save it before dismissing; copy failure does not undo token creation. Clipboard feedback does not include token values or raw browser errors.

## Rust Provider HTTP Transport

`OAuthProviderRuntime` uses reqwest 0.13 with rustls. Its `http_client()`
accessor returns the reqwest client for direct HTTP requests;
`oauth_http_client()` returns an `oauth2_reqwest::ReqwestClient` adapter for
OAuth/OIDC `request_async(...)` calls. Both share the same connection pool.
Provider requests do not follow HTTP redirects; configure the final discovery,
JWKS, token, userinfo, and introspection endpoint URLs.

SecurityDept disables the default HTTP-client features of both `oauth2` and
`openidconnect`. Hosts that also depend directly on these crates should use
`default-features = false` to avoid reintroducing reqwest 0.12 through Cargo
feature unification. For additional OAuth/OIDC requests, use the provider's
adapter or follow the [oauth2-reqwest usage guide](https://docs.rs/oauth2-reqwest/0.1.0-alpha.3/oauth2_reqwest/).

## Principal And Token Boundaries

An authenticated principal represents the signed-in person in session/token-set
user-facing state. `ResourceTokenPrincipal` represents verified bearer-token
authorization facts: subject, issuer, audiences, scopes, authorized party, and
claims. These projections are related but not interchangeable. Raw token
material, authorization headers, passwords, and provider/client secrets must not
enter safe principal claims.

## Host Configuration

Rust hosts resolve configuration in stages:

1. serde-facing raw configuration receives file and environment input.
2. a crate-owned config source applies shared OIDC defaults and host validators.
3. a resolved configuration constructs reusable runtimes.

Hosts keep route paths, source keys, account bindings, display data, and other product-specific policy outside reusable config projections. Redirect targets are validated against host policy; no auth context accepts unchecked arbitrary redirect URLs.

---

[English](020-AUTH_CONTEXT_AND_MODES.md) | [中文](../zh/020-AUTH_CONTEXT_AND_MODES.md)
