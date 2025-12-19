# SecurityDept

Standalone auth service: OIDC login + local basic/token entries and groups, with forward-auth endpoints for reverse proxies (Traefik, Nginx). File-based config and data, no database.

**Status: early development** — Core flows work; API, CLI, and Web UI exist. See [Roadmap](docs/roadmap.md) for gaps and priorities.

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

## Docs

| Doc | Content |
|-----|--------|
| [Overview](docs/00-overview.md) | Goals, tech stack, index |
| [Architecture](docs/architecture.md) | Layout, config/data model, request flow |
| [Features](docs/features.md) | Implemented capabilities and code locations |
| [Roadmap](docs/roadmap.md) | Done, gaps, suggested priorities |

## License

[MIT](LICENSE.md)
