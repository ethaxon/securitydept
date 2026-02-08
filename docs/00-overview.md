# SecurityDept — Overview

Developer-oriented overview: design goals, tech stack, and document index.

## Design Goals

SecurityDept is a **standalone auth service** that:

1. **Integrates with an external OIDC provider** for user login (authorization code flow, optional PKCE).
2. **Validates OIDC claims** via an optional custom script (JS/TS run in an embedded engine).
3. **Manages auth entries and groups** after login: basic auth (username/password) and token auth (bearer tokens), associated with named groups.
4. **Exposes forward-auth endpoints** for reverse proxies (Traefik, Nginx) so upstream services can gate access by group and credential type.
5. **Uses file-based config and data** (TOML + env, JSON data file) for operations without a database.

Target operators: small teams or self-hosted setups that need a single auth layer in front of multiple backends, with OIDC for identity and local entries for API/CLI or machine access.

## Tech Stack

| Layer        | Choice |
|-------------|--------|
| **Server**  | Rust, Axum, OpenID Connect crate, Figment (config), Snafu (errors), Tokio, Tracing |
| **Core lib**| Shared config, OIDC client, store, session, auth (hashing/verification), claims engine (Boa JS + SWC TypeScript transpile), base URL resolution |
| **Web UI**  | TypeScript, Vite, React, TanStack (e.g. Query/Router), Tailwind CSS, shadcn/ui |
| **CLI**     | Rust, Clap, Tabled (output) |
| **Tooling** | mise (tools), pnpm (Node build-time only), just (tasks), cargo (Rust), GitHub Actions (Docker build/publish) |

See [AGENTS.md](../AGENTS.md) for project rules (e.g. Rust + axum + openidconnect for server; TS + Vite + React for webui).

## Document Index

| Document | Focus |
|----------|--------|
| [00-overview.md](00-overview.md) | Goals, stack, index (this file). |
| [architecture.md](architecture.md) | Workspace layout, packages/apps, config and data model, request flow. |
| [features.md](features.md) | Implemented capabilities (OIDC, entries, groups, forward-auth, CLI, WebUI). |
| [roadmap.md](roadmap.md) | Planned and future work. |

Main entry for the project: [README.md](../README.md).
