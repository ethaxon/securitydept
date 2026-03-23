<h1 align="center">
  <img src="./assets/icons/icon.png" alt="logo" height=180/>
  <br />
  <b>SecurityDept</b>
</h1>

SecurityDept is a mesh-oriented authentication and authorization toolkit built as reusable Rust crates plus a reference server app.

The project is evolving away from a single "OIDC login + local session" product into a layered library stack that can support:

- low-level credential verification primitives
- OIDC client flows
- OAuth resource server verification
- basic-auth context flows for the simplest browser-native cases
- stateful cookie-session authentication contexts
- stateless token-set authentication contexts for distributed SPA and proxy scenarios
- local credential management for basic auth and static tokens
- a reference server app that exercises the combined stack

The current repository already contains major parts of the lower layers and a working reference server. The higher-level auth-context modes are being documented now so future implementation can follow a consistent design.

The reference server still uses Axum, but the reusable `securitydept-basic-auth-context`, `securitydept-session-context`, and `securitydept-auth-runtime` crates now keep Axum-specific response assembly outside their core APIs so they can be reused in other ecosystems more easily.

## Workspace Crates

- `securitydept-creds`
  - low-level verification primitives for basic auth, static tokens, JWT, JWE, and RFC 9068 access tokens
- `securitydept-basic-auth-context`
  - reusable basic-auth context, zone, post-auth redirect, and real-IP access-policy helpers with framework-neutral HTTP response metadata
- `securitydept-session-context`
  - reusable cookie-session auth context helpers built on tower-sessions, including post-auth redirects, without direct Axum coupling
- `securitydept-auth-runtime`
  - route-ready session, token-set, and basic-auth orchestration with independent `basic-auth-context`, `session-context`, and `token-set-context` features
- `securitydept-oauth-provider`
  - shared provider runtime for discovery metadata, JWKS, and introspection with cache and refresh
- `securitydept-oidc-client`
  - OIDC client / relying-party flows, callback handling, refresh, claims normalization
- `securitydept-oauth-resource-server`
  - bearer access-token verification for JWT, JWE, and opaque token introspection
- `securitydept-token-set-context`
  - reusable token-set auth-state, redirect, metadata-redemption, and token-propagation helpers; resource-token facts stay outside auth-state metadata, and node-aware propagation may use an optional runtime resolver
- `securitydept-realip`
  - trusted-proxy/provider-aware client IP resolution for stacked CDN and reverse-proxy deployments
- `securitydept-creds-manage`
  - local management for simple credentials such as basic auth and static tokens
- `securitydept-core`
  - aligned re-exports for downstream applications
- `securitydept-server`
  - reference Axum server used to validate combined behavior
- `securitydept-cli`
  - reference CLI for local credential management

## Planned Auth Context Modes

SecurityDept should eventually support three top-level authentication context modes:

1. Basic auth context mode
2. Cookie-session mode
3. Stateless token-set mode

These modes are intentionally above the current `oidc-client` and `oauth-resource-server` crates. They should compose lower layers instead of collapsing responsibilities into a single crate.

## Status Snapshot

- Implemented or largely implemented
  - low-level creds verification
  - OIDC client flow
  - OAuth provider runtime
  - OAuth resource server verifier
  - creds-manage for basic auth and static tokens
  - reference server app with cookie-session, basic-auth context, and stateless token-set flows
  - real-IP resolution plus optional real-IP access policy for basic-auth contexts
  - server-owned bearer propagation validation with destination allowlists and access-token-derived resource facts
- Planned / partially specified
  - richer multi-zone basic-auth context composition
  - implementation of the TypeScript client SDKs described in the formal client SDK guide
  - token-set browser-side merge, persistence, refresh, and mixed-custody behavior
  - a recommended propagation forwarder feature layered above `TokenPropagator`

## Reference Server Auth

The reference server currently exposes two dashboard-management entry styles:

- `/api/*`
  - tries bearer access-token verification first when an `Authorization: Bearer ...` header is present
  - otherwise falls back to cookie session
  - then falls back to configured basic-auth guarded by `basic-auth-context` and optional real-IP policy
  - when `X-SecurityDept-Propagation` is present, `/api/*` requires bearer access-token authentication and rejects cookie/basic flows with an auth-method mismatch response
  - the header value uses a Forwarded-style parameter format such as `by=dashboard;for=node-a;host=service.internal.example.com:443;proto=https`
  - successful bearer authentication keeps access-token-derived resource facts in request runtime context for later propagation-aware handlers
- `/basic/*`
  - dedicated basic-auth zone for the reference server dashboard
  - `/basic/api/*` aliases the dashboard management API behind the admin basic-auth flow
  - if `X-SecurityDept-Propagation` is present, the basic-auth route returns the same auth-method mismatch response

This admin basic-auth flow is separate from `creds-manage` entries. The managed basic-auth credentials stored in `creds-manage` are data for downstream/forward-auth style use cases, not dashboard administrator login.

## Docs

| Doc | Focus |
| --- | --- |
| [docs/en/000-OVERVIEW.md](docs/en/000-OVERVIEW.md) ([中文](docs/zh/000-OVERVIEW.md)) | Project goals, layers, and document index |
| [docs/en/001-ARCHITECTURE.md](docs/en/001-ARCHITECTURE.md) ([中文](docs/zh/001-ARCHITECTURE.md)) | Layered architecture and crate boundaries |
| [docs/en/002-FEATURES.md](docs/en/002-FEATURES.md) ([中文](docs/zh/002-FEATURES.md)) | Capability matrix: implemented vs planned |
| [docs/en/003-AUTH_CONTEXT_MODES.md](docs/en/003-AUTH_CONTEXT_MODES.md) ([中文](docs/zh/003-AUTH_CONTEXT_MODES.md)) | Basic zone, cookie-session, and stateless token-set modes |
| [docs/en/004-BASIC_AUTH_ZONE.md](docs/en/004-BASIC_AUTH_ZONE.md) ([中文](docs/zh/004-BASIC_AUTH_ZONE.md)) | Basic auth zone UX and protocol notes |
| [docs/en/005-ERROR_SYSTEM_DESIGN.md](docs/en/005-ERROR_SYSTEM_DESIGN.md) ([中文](docs/zh/005-ERROR_SYSTEM_DESIGN.md)) | Safe user-facing errors vs internal diagnostics, with auth-specific guidance |
| [docs/en/006-REALIP.md](docs/en/006-REALIP.md) ([中文](docs/zh/006-REALIP.md)) | Trusted-peer-aware real-IP strategy for stacked proxy and CDN deployments |
| [docs/en/007-CLIENT_SDK_GUIDE.md](docs/en/007-CLIENT_SDK_GUIDE.md) ([中文](docs/zh/007-CLIENT_SDK_GUIDE.md)) | Formal client SDK architecture: package layout, foundation protocols, adapters, runtime boundaries, and implementation rules |
| [docs/en/100-ROADMAP.md](docs/en/100-ROADMAP.md) ([中文](docs/zh/100-ROADMAP.md)) | Sequenced roadmap aligned with current goals |

## Development

```bash
cp config.example.toml config.toml
just dev-server
just dev-webui
```

## License

[MIT](LICENSE.md)

---

[English](README.md) | [中文](README_zh.md)
