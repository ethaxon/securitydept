# Architecture

Workspace layout, configuration and data models, and how components interact.

## Workspace Layout

```
securitydept/
├── packages/
│   └── core/          # Shared library (config, OIDC, store, session, auth, claims engine)
├── apps/
│   ├── server/        # HTTP API + forward-auth (Axum)
│   ├── cli/           # Management CLI (entries, groups)
│   └── webui/         # React SPA (Vite)
├── config/            # Example/config location (convention)
├── docs/              # Developer documentation
├── Cargo.toml         # Workspace (core, server, cli)
├── package.json       # Root + workspaces: apps/webui
├── justfile           # Tasks: build, dev, check, lint
└── .env.example       # Env var template
```

- **securitydept-core**: No HTTP; holds config parsing, OIDC client, file-backed store, in-memory sessions, password/token hashing and verification, claims-check script execution (Boa), and base-URL resolution from headers.
- **securitydept-server**: Depends on core; runs Axum, serves auth routes, REST API (entries/groups), and forward-auth endpoints; optionally serves webui static files.
- **securitydept-cli**: Depends on core; reads same config and data file, provides entry/group CRUD for automation or headless use.

## Configuration Model

- **Source**: TOML file + environment variables. Figment merges them; env wins. Nesting uses `__` (e.g. `OIDC__CLIENT_ID` → `oidc.client_id`).
- **Main sections** (see `packages/core/src/config.rs`):
  - **server**: `host`, `port`, `webui_dir` (optional static root), `external_base_url` (`"auto"` or fixed URL for OIDC redirects).
  - **oidc**: Optional. If absent, OIDC is disabled and `/auth/login` creates a dev session. When set: `client_id`, `client_secret` (optional with PKCE), `redirect_uri`, `well_known_url` or manual endpoints, scopes, token/userinfo alg options, `claims_check_script` path, `pkce_enabled`.
  - **data**: `path` to the JSON data file (entries + groups).

Validation: if `well_known_url` is unset, `issuer_url`, `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, and `jwks_uri` must all be set.

## Data Model

- **Data file** (JSON): Single file with `entries` (array of auth entries) and `groups` (array of groups). Core `Store` loads/saves it with RwLock; server and CLI both use it.
- **Entries**: Each has `id`, `name`, `kind` (basic | token), optional `username`/`password_hash` (basic) or `token_hash` (token), `groups` (list of group names), timestamps.
- **Groups**: `id`, `name`. Entries reference groups by name; forward-auth resolves by group name.
- **Sessions**: In-memory only (no persistence). Created after OIDC callback (or dev login); keyed by session ID cookie; TTL configured in server (e.g. 24h). Used to protect `/api/*` (except forward-auth) and optional webui.

## Request Flow

1. **OIDC login**: User hits `/auth/login` → redirect to IdP with state/nonce (and PKCE challenge if enabled). Callback `/auth/callback` receives code; state/nonce (and PKCE verifier) are looked up from pending store; code exchange + userinfo; optional claims script; session created; cookie set; redirect to app.
2. **Protected API**: Requests to `/api/entries`, `/api/groups` require session cookie; middleware resolves session or returns 401.
3. **Forward-auth**: `/api/forwardauth/traefik/{group}` and `/api/forwardauth/nginx/{group}` are **not** session-based. Reverse proxy sends `Authorization` (Basic or Bearer); server loads entries for that group and validates credential; 200 or 401. Used as Traefik ForwardAuth or Nginx `auth_request` upstream.
4. **Base URL**: For OIDC redirect_uri, server uses `external_base_url`: either fixed or inferred from Forwarded / X-Forwarded-* / Host (see `packages/core/src/base_url.rs`).

## Security-Relevant Details

- **State/nonce**: Stored in a short-lived in-memory store keyed by OAuth `state`; consumed once at callback (CSRF + nonce binding).
- **PKCE**: Optional; when `pkce_enabled`, code_verifier is stored with state and sent at token exchange.
- **Secrets**: Passwords hashed with Argon2; tokens stored as SHA-256 hex; client_secret and PKCE verifier only in memory/config.
- **Forward-auth**: No session; validates the credential in the request against the group’s entries only.
