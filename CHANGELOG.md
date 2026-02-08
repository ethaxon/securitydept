# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Documentation updated to reflect current runtime and release pipeline behavior.

## [0.1.0]

### Added

- Initial public release of SecurityDept with OIDC login, optional claims-check script, session management, entry/group CRUD, CLI, and Web UI.
- Forward-auth endpoints for Traefik and Nginx:
  - `/api/forwardauth/traefik/{group}`
  - `/api/forwardauth/nginx/{group}`
- Public health endpoint:
  - `/api/health`
  - `/api/health?api_details=true`
- Multi-stage Docker build for server, CLI, and bundled Web UI.
- GitHub Actions workflow for Docker Buildx multi-arch image publishing to GHCR on `v*` tags with SemVer aliases.

### Changed

- Claims TypeScript transpilation moved to embedded SWC (`swc_core`) runtime path, removing Node.js runtime dependency for claims transpilation.
- Runtime container optimized to Alpine-based minimal image class (around ~64 MB in current build).

### Documentation

- Updated `README.md` with release status, workflow badge, version badge, and container publishing notes.
- Updated docs (`docs/00-overview.md`, `docs/architecture.md`, `docs/features.md`, `docs/roadmap.md`) to match current implementation and release baseline.
