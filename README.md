<h1 align="center">
  <img src="./assets/icons/icon.png" alt="logo" height=180/>
  <br />
  <b>SecurityDept</b>
  <div align="center">
    <a href="https://github.com/ethaxon/securitydept/actions/workflows/docker-build.yml"><img src="https://github.com/ethaxon/securitydept/actions/workflows/docker-build.yml/badge.svg" alt="docker-build-badge" /></a>
    <a href="https://github.com/ethaxon/securitydept/tags"><img src="https://img.shields.io/github/v/tag/ethaxon/securitydept?label=version&color=brightgreen" alt="version-badge" /></a>
</h1>

**Standalone auth service: OIDC login, manage local basic/token entries and groups, with forward-auth endpoints for reverse proxies (Traefik, Nginx). File-based config and data, no database.**

---

Status: v0.1.1 release-ready — Core flows are implemented across API, CLI, and Web UI. Docker image build and GHCR publish workflow are in place. See [Roadmap](docs/roadmap.md) for next milestones.

## What it does

- **Login**: External OIDC (authorization code, optional PKCE); optional claims-check script (JS in Boa).
- **Entries & groups**: Basic auth and token auth entries, grouped by name; CRUD via REST API and CLI.
- **Forward-auth**: `GET /api/forwardauth/traefik/:group` and `/api/forwardauth/nginx/:group` — validate `Authorization` against group entries; no session.
- **Config**: TOML + env (Figment); single JSON data file for entries and groups.

## Quick Start

Copy `config.example.toml` to `config.toml` and edit it.

```bash
wget https://raw.githubusercontent.com/ethaxon/securitydept/refs/heads/main/config.example.toml -O config.toml
```

Then create a `docker-compose.yml` (see below), and start it with `docker compose up -d`:

```docker-compose.yml
name: securitydept

services:
  securitydept-server:
    # build: .
    image: ghcr.io/ethaxon/securitydept:latest
    ports:
      - 7021:7021
    environment:
      - SECURITYDEPT_CONFIG=/app/config.toml
    volumes:
      - ./config.toml:/app/config.toml
      - ./data:/app/data
      # - ./custom-claims-check.mts:/app/custom-claims-check.mts # for custom claims check
      # - ./webui:/app/webui # for custom webui
```

## For Developer

**Stack**: Rust (Axum, OpenID Connect, Figment, Snafu) · TypeScript + Vite + React (TanStack, Tailwind, shadcn/ui) · mise · just · pnpm · cargo

```bash
cp config.toml.example config.toml   # edit as needed
just dev-server              # dev server
just dev-webui               # dev webui
```

## Docs

| Doc                                  | Content                                     |
| ------------------------------------ | ------------------------------------------- |
| [Overview](docs/00-overview.md)      | Goals, tech stack, index                    |
| [Architecture](docs/architecture.md) | Layout, config/data model, request flow     |
| [Features](docs/features.md)         | Implemented capabilities and code locations |
| [Roadmap](docs/roadmap.md)           | Done, gaps, suggested priorities            |

## License

[MIT](LICENSE.md)
