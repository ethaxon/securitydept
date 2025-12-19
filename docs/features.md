# Implemented Features

What is built and where to find it in the codebase.

## OIDC Integration

- **Authorization code flow**: Login redirect to IdP; callback exchanges code for tokens and fetches userinfo. State and nonce stored for the round-trip and validated at callback.
- **PKCE**: Optional via config `pkce_enabled`. When enabled, code_challenge is sent at authorize and code_verifier at token exchange; verifier stored with state in pending OAuth store.
- **Discovery**: Optional `well_known_url`; otherwise manual `issuer_url`, endpoints, and `jwks_uri`. Provider metadata can override discovered endpoints and algs.
- **Config flexibility**: `token_endpoint_auth_methods_supported`, `scopes`, `id_token_signing_alg_values_supported`, `userinfo_signing_alg_values_supported` support comma- or space-separated strings (and arrays) via serde_with; userinfo algs can include `none`.

**Code**: `packages/core/src/oidc.rs`, `packages/core/src/config.rs` (OidcConfig); `apps/server/src/routes/auth.rs` (login, callback), `apps/server/src/state.rs` (PendingOauthStore).

## Claims Check Script

- Optional script (e.g. `.mts`) run after OIDC callback. Executed in Boa engine; must export a function that accepts claims and returns `{ success, displayName?, error?, claims? }`.
- Used to validate or reject login and to set display name. TypeScript/interface lines are stripped for Boa compatibility.

**Code**: `packages/core/src/claims_engine.rs`; example script `custom-claims-check.mts`.

## Session Management

- In-memory session store (session ID → display_name, claims, expiry). TTL set in server (e.g. 86400 s). Cookie name `securitydept_session`.
- Dev mode: when OIDC is disabled, `/auth/login` creates a session without IdP.

**Code**: `packages/core/src/session.rs`; `apps/server/src/middleware.rs` (require_session, get_session_id).

## Auth Entries and Groups

- **Entries**: Basic auth (username + Argon2 password hash) and token auth (opaque token, SHA-256 hash). Each entry has a name and a list of group names.
- **Groups**: Named groups; entries reference them by name. Used by forward-auth to resolve which entries apply to a request.
- **Persistence**: Single JSON file (path from config); Store provides CRUD and `entries_by_group` for forward-auth.

**Code**: `packages/core/src/store.rs`, `packages/core/src/models.rs`, `packages/core/src/auth.rs` (hashing, verification, header parsing); `apps/server/src/routes/entries.rs`, `routes/groups.rs`.

## REST API (Protected)

- **Entries**: `GET/POST /api/entries`, `GET/PUT/DELETE /api/entries/:id`, `POST /api/entries/basic`, `POST /api/entries/token`.
- **Groups**: `GET/POST /api/groups`, `GET/PUT/DELETE /api/groups/:id`.
- All require a valid session cookie (middleware).

**Code**: `apps/server/src/routes/mod.rs`, `entries.rs`, `groups.rs`; `apps/server/src/middleware.rs`.

## Forward-Auth Endpoints

- **Traefik**: `GET /api/forwardauth/traefik/:group` — 200 if Authorization (Basic or Bearer) matches an entry in the group; 401 otherwise. Sets `X-Auth-User` to entry name on success.
- **Nginx**: `GET /api/forwardauth/nginx/:group` — same behavior for Nginx `auth_request`.

No session; validation is against the forwarded `Authorization` header and the group’s entries only.

**Code**: `apps/server/src/routes/forward_auth.rs`; `packages/core/src/auth.rs` (check_basic_auth, check_token_auth, header parsers).

## Auth Routes (Public / Callback)

- `GET /auth/login` — Redirect to OIDC or create dev session.
- `GET /auth/callback` — OIDC callback; state/nonce/PKCE handling; claims check; session creation.
- `POST /auth/logout` — Remove session and clear cookie.
- `GET /auth/me` — Current user info (display_name, claims) for the session.

**Code**: `apps/server/src/routes/auth.rs`.

## CLI

- **Entries**: List; create basic (name, username, password, groups); create token (name, groups; prints token once); delete by id.
- **Groups**: List; create (name); delete by id.

Uses same config and data file as server; no auth (local/automation use).

**Code**: `apps/cli/src/main.rs`.

## Web UI

- React SPA: login (redirect to OIDC), dashboard, entries and groups management (list, create, edit, delete). Uses same API as above; can be served from server via `server.webui_dir` (static files + fallback to index.html).

**Code**: `apps/webui/` (Vite, React, routes, API client, components).

## Base URL Resolution

- For OIDC redirect_uri and links: either fixed URL or `auto`. When `auto`, resolution order: Forwarded (RFC 7239) → X-Forwarded-Host/Proto → Host / :authority → bind address. Protocol inferred (e.g. localhost → http, else https).

**Code**: `packages/core/src/base_url.rs`; used in server for auth and optional webui.
