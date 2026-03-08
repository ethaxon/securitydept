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
- basic-auth zone flows for the simplest browser-native cases
- stateful cookie-session authentication contexts
- stateless token-set authentication contexts for distributed SPA and proxy scenarios
- local credential management for basic auth and static tokens
- a reference server app that exercises the combined stack

The current repository already contains major parts of the lower layers and a working reference server. The higher-level auth-context modes are being documented now so future implementation can follow a consistent design.

## Workspace Crates

- `securitydept-creds`
  - low-level verification primitives for basic auth, static tokens, JWT, JWE, and RFC 9068 access tokens
- `securitydept-oauth-provider`
  - shared provider runtime for discovery metadata, JWKS, and introspection with cache and refresh
- `securitydept-oidc-client`
  - OIDC client / relying-party flows, callback handling, refresh, claims normalization
- `securitydept-oauth-resource-server`
  - bearer access-token verification for JWT, JWE, and opaque token introspection
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

1. Basic auth zone mode
2. Cookie-session mode
3. Stateless `id_token + access_token + sealed_refresh_token` mode

These modes are intentionally above the current `oidc-client` and `oauth-resource-server` crates. They should compose lower layers instead of collapsing responsibilities into a single crate.

## Status Snapshot

- Implemented or largely implemented
  - low-level creds verification
  - OIDC client flow
  - OAuth provider runtime
  - OAuth resource server verifier
  - creds-manage for basic auth and static tokens
  - reference server app with cookie-session flow
- Planned / partially specified
  - basic auth zone mode as a first-class auth-context mode
  - stateless token-set auth-context mode
  - frontend TypeScript SDKs for auth-context modes
  - mesh-aware bearer propagation and token-set management

## Docs

| Doc | Focus |
| --- | --- |
| [docs/000-OVERVIEW.md](docs/000-OVERVIEW.md) | Project goals, layers, and document index |
| [docs/001-ARCHITECTURE.md](docs/001-ARCHITECTURE.md) | Layered architecture and crate boundaries |
| [docs/002-FEATURES.md](docs/002-FEATURES.md) | Capability matrix: implemented vs planned |
| [docs/003-AUTH_CONTEXT_MODES.md](docs/003-AUTH_CONTEXT_MODES.md) | Basic zone, cookie-session, and stateless token-set modes |
| [docs/004-BASIC_AUTH_ZONE.md](docs/004-BASIC_AUTH_ZONE.md) | Basic auth zone UX and protocol notes |
| [docs/100-ROADMAP.md](docs/100-ROADMAP.md) | Sequenced roadmap aligned with current goals |

## Development

```bash
cp config.toml.example config.toml
just dev-server
just dev-webui
```

## License

[MIT](LICENSE.md)

---

[English Version](README.md) | [中文版本](README_zh.md)
