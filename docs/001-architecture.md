# Architecture

Workspace layout, crate responsibilities, and component interaction.

## Workspace Layout

```
securitydept/
├── packages/
│   ├── oidc/          # Reusable OIDC client and models
│   ├── creds/         # Reusable credential primitives and validator traits
│   ├── creds-manage/  # File-backed creds/group store + sessions + app auth helpers
│   └── utils/         # Shared base-url/http helpers
├── apps/
│   ├── server/        # HTTP API + forward-auth (Axum)
│   ├── cli/           # Management CLI (entries, groups)
│   └── webui/         # React SPA (Vite)
├── docs/
├── Cargo.toml         # Rust workspace
├── package.json       # Node workspace root (webui tooling)
└── justfile           # Developer tasks
```

## Crate Responsibilities

- **`securitydept-oidc`** (`packages/oidc`)
  - OIDC config and client (`OidcClient`)
  - Authorization-code flow helpers (authorize URL, callback exchange)
  - Claims model and claims-check integration
  - Pending OAuth store traits and moka implementation

- **`securitydept-creds`** (`packages/creds`)
  - Basic/Bearer auth header parsing
  - Argon2 password hashing and verification
  - Token generation and SHA-256 token hashing
  - Reusable traits (`BasicAuthCred`, `TokenAuthCred`, validator traits)

- **`securitydept-creds-manage`** (`packages/creds-manage`)
  - Config model for creds data path
  - Data models for entries/groups/session
  - File-backed store with lock + sync loop
  - App-layer auth checks over stored creds
  - In-memory session manager

- **`securitydept-utils`** (`packages/utils`)
  - Base URL resolution and shared HTTP utilities

- **`securitydept-server`** (`apps/server`)
  - Axum route wiring
  - Auth/session middleware
  - REST API for entries/groups
  - Forward-auth endpoints for reverse proxies

- **`securitydept-cli`** (`apps/cli`)
  - Entry/group CRUD from terminal using same store and config

## Reuse Model

This repo is now intentionally split so external Rust projects can reuse auth logic without embedding the full server:

- Import **`securitydept-oidc`** when you need OIDC login/callback handling.
- Import **`securitydept-creds`** when you only need credential hashing/parsing/validation traits.
- Import **`securitydept-creds-manage`** when you need file-backed credential/group management behavior.

`securitydept-server` is one composition of these crates, not the only possible runtime.

## Configuration Model

- **Source**: TOML file + environment variables (Figment merge; env wins).
- **Server config**: host/port, optional static webui dir, external base URL strategy.
- **OIDC config**: provider metadata/discovery, client credentials, PKCE, optional claims check script.
- **Creds-manage config**: JSON data file path for groups and credentials.

## Data Model

- **Data file**: single JSON file with:
  - `groups`
  - `basic_creds`
  - `token_creds`
- **Entry metadata**: `id`, `name`, `group_ids`, timestamps.
- **Basic entry**: `Argon2BasicAuthCred` + metadata.
- **Token entry**: `Sha256TokenAuthCred` + metadata.
- **Sessions**: in-memory session map keyed by session cookie ID.

## Request Flow

1. **OIDC login** (`/auth/login`)
   - Server calls `securitydept-oidc` to build authorize request.
2. **OIDC callback** (`/auth/callback`)
   - Server uses `securitydept-oidc` for code exchange, claims evaluation, and pending state verification.
3. **Session-protected APIs** (`/api/entries`, `/api/groups`)
   - Middleware verifies session; handlers call `securitydept-creds-manage` store.
4. **Forward-auth endpoints** (`/api/forwardauth/*`)
   - No session required.
   - Header parsing/hashing uses `securitydept-creds`; data lookup uses `securitydept-creds-manage`.

## Security-Relevant Notes

- Passwords are stored as Argon2 hashes.
- Bearer tokens are generated once and persisted only as SHA-256 hash.
- OIDC state/nonce (and PKCE verifier when enabled) are short-lived and validated at callback.
- Forward-auth validates only against configured group credentials for the incoming request.
