<h1 align="center">
  <img src="./assets/icons/icon.png" alt="logo" height=180/>
  <br />
  <b>SecurityDept</b>
  <div align="center">
    <a href="https://github.com/ethaxon/securitydept/actions/workflows/docker-build.yml"><img src="https://github.com/ethaxon/securitydept/actions/workflows/docker-build.yml/badge.svg" alt="docker-build-badge" /></a>
    <a href="https://github.com/ethaxon/securitydept/tags"><img src="https://img.shields.io/github/v/tag/ethaxon/securitydept?label=version" alt="version-badge" /></a>
    <img src="https://img.shields.io/badge/status-v0.1.0%20ready-brightgreen" alt="status-badge" /></div>
</h1>

Standalone auth service: OIDC login, manage local basic/token entries and groups, with forward-auth endpoints for reverse proxies (Traefik, Nginx). File-based config and data, no database.

**Status: v0.1.0 release-ready** — Core flows are implemented across API, CLI, and Web UI. Docker image build and GHCR publish workflow are in place. See [Roadmap](docs/roadmap.md) for next milestones.

## What it does

- **Login**: External OIDC (authorization code, optional PKCE); optional claims-check script (JS in Boa).
- **Entries & groups**: Basic auth and token auth entries, grouped by name; CRUD via REST API and CLI.
- **Forward-auth**: `GET /api/forwardauth/traefik/:group` and `/api/forwardauth/nginx/:group` — validate `Authorization` against group entries; no session.
- **Config**: TOML + env (Figment); single JSON data file for entries and groups.

## Stack

Rust (Axum, OpenID Connect, Figment, Snafu) · TypeScript + Vite + React (TanStack, Tailwind, shadcn/ui) · mise · just · pnpm · cargo

## Quick start

```bash
cp .env.example .env   # edit as needed
just build            # webui + server + cli
just dev              # run server (cargo run)
```

Web UI: `just dev-webui` in another terminal, or set `server.webui_dir` and serve from the server.

## Container image

- Registry: `ghcr.io/<owner>/<repo>` (this repository resolves to `ghcr.io/ethaxon/securitydept`)
- Release tags follow SemVer aliases on `v*` tags: `1.2.3`, `1.2`, `1`, `latest`
- Multi-arch: `linux/amd64`, `linux/arm64`

## Docs

| Doc                                  | Content                                     |
| ------------------------------------ | ------------------------------------------- |
| [Overview](docs/00-overview.md)      | Goals, tech stack, index                    |
| [Architecture](docs/architecture.md) | Layout, config/data model, request flow     |
| [Features](docs/features.md)         | Implemented capabilities and code locations |
| [Roadmap](docs/roadmap.md)           | Done, gaps, suggested priorities            |

## License

[MIT](LICENSE.md)
