# SECURITYDEPT

SecurityDept, a simple, standalone auth service that integrates with external OIDC to manage and provides reusable authentication middleware endpoints for reverse proxies.

## Goals

Build a standalone auth service (Rust backend + React frontend) that integrates with external OIDC and provides reusable middleware endpoints for reverse proxies.

## Planned Capabilities

- Accept an external OIDC source for login.
  - Validate claims with custom rules.
  - Execute claim validation rules with an embedded lightweight JavaScript engine (custom JS expressions).
- After successful login, allow operators to create, edit, and delete:
  - `basic auth` entries
  - `token auth` entries
- Associate each auth entry with one or more groups.
- Expose middleware endpoints for reverse proxies:
  - `api/forwardauth/traefik/{{group}}`
  - `api/forwardauth/nginx/{{group}}`
- Provide both REST API and CLI for management and automation.

## Data and Configuration Model

- Manage all runtime configuration from local config files.
- Use local data files as the database.
- Persist user hash/password data and group mappings in human-readable, editable formats.

## License

[MIT](LICENSE.md)
