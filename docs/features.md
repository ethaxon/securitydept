# Implemented Features

What is built and where to find it.

## Multi-crate Reuse

- The codebase is split into reusable Rust crates plus apps.
- OIDC capabilities are reusable via `securitydept-oidc`.
- Credential primitives and validator traits are reusable via `securitydept-creds`.
- File-backed credentials/group management is reusable via `securitydept-creds-manage`.

## OIDC Integration

- Authorization code flow with optional PKCE.
- Discovery via well-known URL or manual endpoint configuration.
- Pending OAuth state/nonce store abstraction with moka implementation.
- Optional claims check pipeline after callback.

Code:
- `packages/oidc/src/client.rs`
- `packages/oidc/src/config.rs`
- `packages/oidc/src/pending_store/*`
- `apps/server/src/routes/auth.rs`

## Credential Primitives

- Parse Basic and Bearer `Authorization` headers.
- Argon2 password hashing/verification.
- Random token generation and SHA-256 token hashing/verification.
- Traits for credential models and validators.

Code:
- `packages/creds/src/basic.rs`
- `packages/creds/src/token.rs`
- `packages/creds/src/validator.rs`

## Creds/Group Management

- JSON file-backed storage for groups, basic creds, and token creds.
- CRUD APIs used by server and CLI.
- Group membership updates synchronized across credential sets.
- Store sync behavior for external file changes and concurrent instances.

Code:
- `packages/creds-manage/src/store.rs`
- `packages/creds-manage/src/models.rs`
- `packages/creds-manage/tests/store_sync.rs`

## Session Management

- In-memory session store used by server middleware.
- Dev login mode when OIDC is disabled.

Code:
- `packages/creds-manage/src/session.rs`
- `apps/server/src/middleware.rs`

## Server APIs

- Auth routes:
  - `GET /auth/login`
  - `GET /auth/callback`
  - `POST /auth/logout`
  - `GET /auth/me`
- Protected management routes:
  - `GET /api/entries`
  - `POST /api/entries/basic`
  - `POST /api/entries/token`
  - `GET/PUT/DELETE /api/entries/{id}`
  - `GET/POST /api/groups`
  - `GET/PUT/DELETE /api/groups/{id}`
- Forward-auth routes:
  - `GET /api/forwardauth/traefik/{group}`
  - `GET /api/forwardauth/nginx/{group}`
- Health route:
  - `GET /api/health`

Code:
- `apps/server/src/routes/*`

## CLI

- Entry/group CRUD backed by the same `securitydept-creds-manage` store.

Code:
- `apps/cli/src/main.rs`

## Web UI

- Entry/group management and login UX using the same server APIs.

Code:
- `apps/webui/src/routes/*`
- `apps/webui/src/api/*`
