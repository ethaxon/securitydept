# Roadmap

Planned and future work. See [README.md](../README.md) “Planned Capabilities” for the original list; this doc aligns with current code and adds concrete next steps.

## Aligned with README (partially or fully done)

- **External OIDC**: Done (authorization code, optional PKCE, discovery or manual endpoints).
- **Validate claims with custom rules**: Done via optional claims-check script (Boa).
- **Basic auth and token auth entries**: Done; CRUD via API and CLI.
- **Groups and association**: Done; entries have `groups`; forward-auth uses group name.
- **Forward-auth endpoints**: Done for Traefik and Nginx (`/api/forwardauth/traefik/:group`, `/api/forwardauth/nginx/:group`).
- **REST API and CLI**: Done for entries and groups.
- **Local config and data files**: Done (TOML + env, JSON data file).

## Not Yet Implemented / To Improve

- **Claims check**: Script format and Boa compatibility are limited (e.g. ES modules shimmed, type annotations stripped). Richer script API or a second engine could be considered later.
- **Web UI**: Functional but can be expanded (e.g. UX, error handling, entry update flows, group assignment UX).
- **Session persistence**: Sessions are in-memory only; server restart loses them. Optional persistence (e.g. file or encrypted cookie) would improve operability.
- **Session cleanup**: Expired sessions are only ignored on access; no background purge. A periodic cleanup task would avoid unbounded growth.
- **More reverse proxies**: Only Traefik and Nginx forward-auth are implemented. Caddy or other auth_request-style endpoints could be added.
- **Configuration**: No hot-reload; server must restart for config changes. Optional reload or a small config API could be added later.
- **Observability**: Tracing is in place; structured logs and optional metrics (e.g. Prometheus) are not yet defined.
- **Tests**: Core has unit tests (e.g. base_url); integration tests for auth flow and forward-auth are not yet in tree.
- **Release hardening**: Add smoke tests for container startup, OIDC callback, and forward-auth checks in CI before promoting tags.
- **Distribution options**: GHCR publish is in place; optional Docker Hub mirror and signed images (cosign) are not yet configured.

## Release Baseline (v0.1.0)

- **Container build**: Official multi-stage Dockerfile with Rust server/CLI and bundled Web UI.
- **Runtime size**: Runtime image optimized to ~64 MB class (Alpine-based runtime, no Node.js runtime dependency).
- **CI/CD**: GitHub Actions workflow `.github/workflows/docker-build.yml` builds multi-arch (`linux/amd64`, `linux/arm64`) and publishes to GHCR on `v*` tags with SemVer aliases.

## Suggested Priorities (for developers)

1. **Stability**: Add integration tests for login/callback and forward-auth, and run them in CI.
2. **Operations**: Session cleanup job; optional session persistence if needed.
3. **Release quality**: Add container smoke tests and optionally signed images.
4. **UX**: Harden Web UI (errors, loading, update flows).
5. **Extensibility**: Document forward-auth contract so additional proxies can be added easily; consider one more (e.g. Caddy) as reference.

No strict timeline; items can be picked by contribution or internal need.
