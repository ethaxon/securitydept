# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0-beta.3]

### Added

- Added attempted-route unauthenticated handler context for Angular and TanStack Router adapters so external auth redirects can preserve the correct `postAuthRedirectUri`.
- Added route helper support for full-page external auth redirects that intentionally never settle framework guard results after browser navigation starts.

### Fixed

- Fixed Angular token-set route unauthenticated handlers so `inject()` remains valid after async planner work.
- Fixed Angular and TanStack Router login redirects to avoid using stale committed router URLs when a protected target route triggers authentication.

## [0.2.0-beta.2]

### Changed

- Moved npm publish-time manifest sanitization into the root pnpm `beforePacking` hook so published package metadata is prepared through pnpm's package lifecycle rather than ad hoc release-script file rewriting.
- Switched Angular SDK package publishing to `publishConfig.directory = "dist"` from the package root, preserving workspace resolution context while still publishing the ng-packagr output.
- Updated the bilingual release automation docs and README examples to reflect the pnpmfile-based npm publish flow, the package-root Angular publish model, the `securitydept-core` Rust entrypoint guidance, and the remote-config Docker startup path.

### Fixed

- Removed monorepo-only `monorepo-tsc` export conditions from all published TypeScript SDK package manifests.
- Fixed npm tarball metadata so internal `@securitydept/*` workspace dependencies are rewritten to concrete published versions during pack/publish, including Angular package dist manifests.

## [0.2.0-beta.1]

### Added

- Expanded the Rust workspace from the original server-centered baseline into reusable auth crates for credentials, OIDC/OAuth, auth contexts, token-set flows, real-IP resolution, and credential management.
- Added a TypeScript SDK workspace with browser/server client layers plus React and Angular adapters for the main auth-context flows.
- Added richer Web UI and end-to-end coverage for basic-auth, session, and token-set OIDC flows, including browser harness and frontend/backend token-set playgrounds.

### Changed

- Refactored the server around clearer auth-context boundaries, policy/propagation routes, diagnosis surfaces, and more structured error/observability behavior.
- Promoted the documentation set to a bilingual docs structure with a VitePress-based `docsite` and synchronized release/readiness authority docs.
- Added release automation for shared metadata/version sync, package verification, and npm/crates publishing workflows with trusted publishing support.
- Documentation updated to reflect current runtime and release pipeline behavior.

### Fixed

- Improved packaging and CI reliability across Rust crates, TypeScript SDKs, docs site builds, browser harness tests, and release evidence generation.

## [0.1.1]

### Fixed

- Fixed redirect handling for docker-registry-proxy after proxy flow refactor.

### Changed

- Simplified forward-auth and auth-route debug logging to keep only high-signal events.
- Bumped project version from `0.1.0` to `0.1.1` across Rust crates, Node packages, and release docs.

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
