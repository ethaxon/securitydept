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

### Host-Configured Rust HTTP Clients

Rust hosts can consume a `reqwest::ClientBuilder` through these additive entrypoints:

- `OAuthProviderRuntime`, `OidcClient`, `OAuthResourceServerVerifier`: `from_config_with_http_client_builder(config, builder)`.
- `BackendOidcModeRuntime`, `AccessTokenSubstrateRuntime`: `from_resolved_config_with_http_client_builder(config, builder)`.
- `RealIpResolver`: `from_config_with_http_client_builder(config, builder)` and `from_config_with_factories_and_http_client_builder(config, &factories, builder)`.
- `CidrNodeRegistry`: the corresponding `from_configs_with_http_client_builder` and `from_configs_with_factories_and_http_client_builder` methods; see [Real-IP HTTP transport](006-REALIP.md#host-configured-http-transport).

Existing constructors remain available and delegate using a default builder. No certificate fields are added to TOML or environment configuration. Disabled authentication and Real-IP registries without built-in remote-file nodes do not build an unused builder. Kubernetes/Docker retain their native configuration; propagation's axum-reverse-proxy, inbound server TLS, and browser SDK transport are not affected.

```rust
// The host loads certificates; identity.pem contains the client certificate
// chain and private key, not a CA bundle.
let roots = reqwest::Certificate::from_pem_bundle(&std::fs::read("ca.pem")?)?;
let identity = reqwest::Identity::from_pem(&std::fs::read("identity.pem")?)?;
let builder = reqwest::Client::builder()
    .tls_certs_merge(roots)
    .identity(identity)
    .proxy(reqwest::Proxy::https("http://proxy.example.com:8080")?)
    .timeout(std::time::Duration::from_secs(15));
let provider = std::sync::Arc::new(
    OAuthProviderRuntime::from_config_with_http_client_builder(provider_config, builder).await?
);
let oidc = OidcClient::<MokaPendingOauthStore>::from_provider(provider.clone(), oidc_config).await?;
let verifier = OAuthResourceServerVerifier::from_provider(provider, verifier_config).await?;
```

`tls_certs_merge` adds roots to platform trust; use `tls_certs_only(roots)` instead for an isolated trust set. Default TLS stays on rustls; hosts can select a backend on the builder with the corresponding reqwest features. Identity configures TLS client authentication, not new OAuth `tls_client_auth`/`self_signed_tls_client_auth` methods or certificate-bound-token enforcement. Protect private keys and never expose them through frontend projections or logging. Do not disable certificate/hostname validation to accommodate a private CA.

The builder is consumed once. Provider discovery, JWKS, refresh, token, userinfo, introspection, device and revocation requests use the same built client and OAuth adapter connection pool. Sharing the provider through `from_provider` also shares caches; separate convenience constructors build separate providers. TLS identity and default headers apply to every endpoint of that provider: separate trust domains should use separate runtimes.

OAuth provider construction always overrides the builder's redirect policy with `Policy::none()` before building. All other settings remain host-owned. Invalid configuration is rejected before building; build failures retain existing error types. General Real-IP remote-file requests retain their host/default redirect policy rather than inheriting the OAuth restriction.

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
