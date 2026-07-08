# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- markdownlint-disable MD024 -->

## [0.3.0-beta.10]

### Changed

- Standardized TypeScript test resource ownership around lexical `using` scopes while preserving the ES2022 production boundary, and removed tests that treated repeated disposal or post-disposal calls as supported SDK behavior.
- Bumped release-managed Rust crates, TypeScript packages, apps, lockfiles, and shared metadata to `0.3.0-beta.10`.

### Fixed

- Fixed Token Set registry disposal so registry lifecycle, multiplexed auth, and aggregated error stream connections are released together with registered clients without exposing internal completion ordering as a public contract.
- Fixed the `@securitydept/token-set-context-client/test` registry factory default type to remain `BaseOidcModeClient` across declarations, and added built-artifact type/runtime checks that prevent test helpers or registry events from degrading to `any` or disappearing from the published test subpath.

## [0.3.0-beta.9]

### Added

- Added registry-owned `authEvents` and `errors` streams that multiplex every ready Token Set client's auth events and combine client operation errors with factory/materialization failures, removing the need for downstream hosts to flatten per-client resources.
- Added the dependency-light `@securitydept/token-set-context-client/test` subpath with canonical Base OIDC client, registry entry, and registry factories for framework and downstream tests.

### Changed

- Changed Token Set callback selectors to expose minimal frontend/backend callback client capabilities and accept an optional type guard, while preserving concrete mode `instanceof` checks by default.
- Bumped release-managed Rust crates, TypeScript packages, apps, lockfiles, and shared metadata to `0.3.0-beta.9`.

## [0.3.0-beta.8]

### Changed

- Replaced the trace timeline's `mnemonist` peer queue with an SDK-internal fixed-capacity ring buffer, preserving constant-time bounded writes and on-demand oldest-to-newest snapshots without imposing an extra runtime dependency on root-package consumers.
- Bumped release-managed Rust crates, TypeScript packages, apps, lockfiles, and shared metadata to `0.3.0-beta.8`.

### Fixed

- Fixed the Token Set registry public artifact so `TokenSetClientRegistryEventType` is available as a runtime export and `registry.events` retains its generic `EventStreamTrait<TokenSetClientRegistryEvent<TClient>>` declaration instead of degrading to `any`.
- Added built-artifact consumer checks for root-package imports and Token Set registry runtime/type contracts, preventing source-only tests from hiding published-package regressions.

## [0.3.0-beta.7]

### Added

- Added a WebUI `MessageService` backed by sonner and connected auth-context client error events to the default toast presentation flow.
- Added provider-scoped span attributes, root-to-node attribute views, shallow tracing-subscriber frame snapshots, and first-capture `ClientError` span context with customizable context-label formatting.

### Changed

- Changed Basic Auth, Session, and Token Set lifecycle event streams to non-replaying edge streams, made failure variants carry context-specific `ClientError` values, and added `isClientErrorEvent()` for type-safe downstream message filtering without a second error subject.
- Changed operation instrumentation to store `client.name`, `client.id`, and `operation.name` as shared span attributes while keeping protocol details in the tracing provider. Default error presentation now derives client and operation context without an event-type mapping.
- Simplified the TypeScript error presentation boundary to accept canonical `ClientError` instances only, removed machine-only `kind`, `source`, and `retryable` fields from the UI descriptor, and renamed its supporting contracts to `ServerErrorPresentation`, `ErrorCodePresentation`, and `ErrorRecoveryActionDescriptor`.
- Changed tracing subscribers to prototype-based classes and backed trace timeline history with the optional `mnemonist` peer queue. Timeline writes now publish only the latest entry through an event stream, while full readonly array snapshots are created on demand.
- Bumped release-managed Rust crates, TypeScript packages, apps, lockfiles, and shared metadata to `0.3.0-beta.7`.

### Fixed

- Pinned the Rust nightly toolchain to a component-complete release, made `rust-toolchain.toml` the single Rust version/component authority through mise idiomatic-file support, and removed CI repair of a moving nightly.

## [0.3.0-beta.6]

### Changed

- Changed the Angular router adapter to compose Angular Router and native-web navigation from one flattened creator-options object, dispatching in-app push/replace requests to Angular and external requests to the native-web router.
- Changed the TanStack React Router adapter to send in-app requests through `to` and external requests through `href`, matching TanStack Router's internal-route and full-document navigation contracts.
- Upgraded Angular and ng-packagr to 22.1, jsdom to 30.0, and the TOML parser to 5.0 while retaining TypeScript 6.0 for Angular compiler compatibility. Centralized the shared Node.js types and Vitest versions in the pnpm workspace catalog and realigned all React catalog consumers to React 19.2.8.
- Upgraded the Rust dependency set, including base64 0.23, jsonwebtoken 11, tower-http 0.7, tabled 0.21, kube 4.2 with k8s-openapi 0.28, swc_core 75, and the stable p256/p384 0.14 line. Centralized the shared serde_regex, tower-sessions-memory-store, and winres version requirements in the Cargo workspace.
- Bumped release-managed Rust crates, TypeScript packages, apps, lockfiles, and shared metadata to `0.3.0-beta.6`.

### Fixed

- Fixed external OIDC authorization redirects being interpreted as malformed in-app paths by the Angular and TanStack Router adapters.

## [0.3.0-beta.5]

### Added

- Added a Resource-first TypeScript reactive foundation with explicit idle/loading/reloading/resolved/error snapshots, snapshot flattening and mapping, observable interoperability, React Suspense query caching, and Angular resource/signal adapters.
- Added the versioned SecurityDept compat-fragment protocol and client-owned OIDC callback handling, including hash-router-safe redirects, backend callback routing keys for multi-client registries, frontend callback candidate selection, and popup flow state isolated in per-environment realm storage.
- Added graph-based Real-IP policy with named nodes, rules, unions, trusted resolved headers, authenticated bridge headers, recursive `X-Forwarded-For` / `Forwarded` resolution, and built-in local, container, and Kubernetes sources.
- Added structured `securitydept-cli` credential and Real-IP commands, including static Basic Auth config generation, managed entry/group operations, masked interactive input, selectable TOML/JSON output, and trusted-bridge secret-bearer generation.

### Changed

- Rebuilt the TypeScript SDK around explicit `FoundationEnvironment` capabilities, injector-owned providers, SDK Signal/Resource/EventStream traits, cooperative cancellation, disposal, spans/tracing, namespaced `ClientError` contracts, URI reference types, and synchronous realm storage. Removed ReplaySignal-era state and host-global fallback models.
- Reworked Basic Auth, session, and token-set clients into environment-backed lifecycle owners with static environment/injector factories, Resource snapshots, operation signals, typed events, and canonical `start()` / `dispose()` boundaries. Basic Auth logout now explicitly clears only the local observation because browsers expose no reliable credential-cache revocation API.
- Rebuilt token-set orchestration and registry around single-commit determination workflows, best-effort persistence, Resource-based client records, explicit initialization policies, client-owned callback state, safer transient-failure versus token-revocation handling, and unified authorization-header derivation. Auth event and trace payloads are now discriminated, secret-safe, and emitted from the base client authority.
- Replaced browser-specific frontend OIDC config materialization with an environment-backed projection resolver supporting ordered inline, realm, persisted, and network sources. Frontend and backend mode factories now compose callback input resolution from registry metadata without acquiring host capabilities implicitly.
- Unified React and Angular adapters around the core injector and client ownership model. React now uses one `SecuritydeptContext`, external-Fiber environment creation, Resource snapshot hooks, and optional Suspense query caching; Angular adapters bridge the same core Resources, registry, callback selection, routes, and transports through Angular DI.
- Migrated the React WebUI to TanStack file-based routing and domain-oriented auth composition, with Resource-driven auth mode/user state, corrected logout and playground access sequencing, streamlined playground diagnostics, and SDK-owned callback/registry flows.
- Replaced the OpenSSL-backed `josekit` JWE implementation with modular RustCrypto-backed `no-way-jose` crates. JWK/JWKS parsing, RSA/P-256/P-384 PEM loading, runtime algorithm dispatch, and core reexports no longer link OpenSSL; the reference server and OAuth resource server enable JWE in their default capability sets.
- Introduced a Turborepo task graph for the TypeScript workspace so package tests consume freshly built dependency artifacts while project-reference typechecking continues to resolve workspace source. Rolldown/tsdown decorator builds now use SWC's 2023-11 transform, and CI caches Turbo outputs by verification lane.
- Bumped release-managed Rust crates, TypeScript packages, apps, lockfiles, and shared metadata to `0.3.0-beta.5`.

### Fixed

- Fixed frontend and backend OIDC callback restoration so user-owned hashes survive redirects, sensitive callback parameters are consumed only by the matching client, and callback completion precedes resolved auth state without making persistence success a login prerequisite.
- Fixed token refresh failure handling so explicit `invalid_grant` / `invalid_token` revocation clears authorization while transient transport, server, and parsing failures retain the last in-memory and persisted state.
- Fixed Real-IP trust traversal and malformed-chain handling by replacing ambiguous provider/source grouping with an explicit graph, preventing untrusted forwarded values or bridge headers from being accepted outside their configured trust relationships.
- Fixed optional server configuration defaults, Basic Auth playground probing, auth-mode transitions, dashboard logout ordering, and protected playground access so runtime state no longer depends on stale projections or mismatched auth contexts.

### Removed

- Removed obsolete TypeScript ReplaySignal APIs, controller/service wrappers, browser-specific context-client helper layers, source-alias test resolution, and compatibility aliases that preserved superseded ownership models.
- Removed the Basic Auth server logout route and any claim that a browser Basic Auth credential cache can be programmatically revoked.

## [0.3.0-beta.4]

### Changed

- Formalized the TypeScript token-set registry dynamic lifecycle across the shared core, Angular adapter, and React adapter with canonical `unregister()` / `resetMaterialization()` verbs, registered-vs-ready snapshot APIs, and race-safe stale materialization invalidation semantics; aligned the SDK example, migration guide, and public-surface inventory with the new contract while keeping `reset()` as a compatibility alias for unregister.
- Promoted the TypeScript token-set registry and per-client auth service to shared core signal-state owners (`state`, `getState()`, `subscribe()`), moved token-set service lifecycle/restore logic out of the React and Angular adapters, and added `@securitydept/client/rx` as the canonical RxJS bridge for SDK signals and event streams.

## [0.3.0-beta.3]

### Added

- Added TypeScript SDK client-environment presets for browser page, browser worker, service worker, and browser-extension background hosts, with page capability resolution that fails fast outside real page/tab/popup documents.
- Added `ClientEnvironmentService`, React environment-service hooks, and Angular page-environment DI bridge support for provider/injector-scoped environment ownership, async materialization, and Suspense-compatible render reads.
- Added `SessionContextController` and `TokenSetCallbackResumeController` as framework-neutral state owners for session user-info refresh/logout and token-set callback resume orchestration.
- Added a cross-platform `scripts/test-cli.ts kube ...` entry with Dockerode-backed Kubernetes test image/resource management, labeled SecurityDept test resources, hot/reusable/isolated Rust e2e lanes, and explicit cleanup recipes.

### Changed

- Split backend-OIDC `/web` helpers around Web environment, page callback bootstrap, host-injected callback capture, and worker-safe restore-only flows; basic-auth and session `/web` redirects now consume the same page-environment boundary.
- Changed session React/Angular providers and the legacy single-client backend-OIDC React provider to environment-first composition roots, so canonical provider APIs now consume shared environment objects instead of long-lived transport/store capability bags.
- Added a canonical Angular page-environment DI bridge in `@securitydept/client-angular` and moved shared callback failure presentation into `@securitydept/token-set-context-client/registry` so host- or mode-specific copy is injected explicitly.
- Changed the Angular token-set callback component to use injectable current-URL and host-policy tokens, and clarified that React callback hooks plus React Query request helpers keep page URL, callback presentation, and transport overrides at the page/request boundary rather than owning auth flow state.
- Changed React and Angular session/token-set callback adapters into leaf bridges over core controllers; session initial probing is now explicit via `initialRefresh` or host-owned refresh calls.
- Changed token-set OIDC route-login surfaces to converge on the shared `OidcRedirectLoginClient.loginWithRedirect({ environment, postAuthRedirectUri })` contract across frontend OIDC, backend OIDC web clients, and Angular route helpers.
- Changed the root `justfile` into topic imports under `justfiles/`, preserving existing recipe names while keeping complex cross-platform test behavior in TypeScript CLI modules.
- Consolidated Rust test cache scopes into shared lanes so PRs, `main`, `release`, and tag-driven flows reuse bounded cache namespaces instead of per-branch or per-PR cache keys.
- Updated the release automation documentation to describe the new cache-lane model and the matching read-write / read-only ownership split.
- Kept the stable-release docs aligned with the current release line and removed reader-facing beta anchors from user-facing entry pages.
- Bumped release-managed Rust crates, TypeScript packages, apps, lockfiles, and shared metadata for `0.3.0-beta.3`.

### Removed

- Removed the broken `act-js` local workflow runner dependency path; local workflow simulation currently supports validation and dry-run/package/build behavior while the replacement runner is pending.

### Fixed

- Fixed Real-IP Docker/Kubernetes provider test cleanup and reuse behavior so SecurityDept-owned containers, networks, volumes, and images are labeled or name-prefixed and can be cleaned without targeting unrelated local Docker resources.
- Fixed Kubernetes provider readiness behavior for reusable kind/k3d loops by waiting through host-side Kubernetes checks and default ServiceAccount availability before creating provider test Pods.

## [0.3.0-beta.2]

### Added

- Added validator-aware access-token substrate config resolution with `resolve_all_with_validator(...)`, validation errors, noop validator, and validator composition.

### Changed

- Split access-token substrate config into `config/mod.rs` and `config/validator.rs`, matching the other Rust host config modules.
- Updated auth-context docs to include access-token substrate in the Rust host config resolution model.

## [0.3.0-beta.1]

### Added

- Added `SecretString` for redacted Rust config secrets, with explicit raw exposure and `config-schema` password/write-only hints.
- Added validator-aware Rust host config resolution for token-set OIDC modes, Basic Auth context, and session context, including host-supplied fixed path validators and validator composition.
- Added `redact`/`schemars`-backed config-schema coverage for Rust host config crates, including OIDC client and OAuth resource-server configs.
- Added secret-safe `ResourceTokenPrincipal` projection for verified resource tokens.

### Changed

- Bumped release-managed Rust crates, TypeScript packages, apps, lockfiles, and shared metadata for `0.3.0-beta.1`.
- Refactored Basic Auth and session context Rust config into the same `ConfigSource -> ResolvedConfig -> Service/Context` model used by token-set host config.
- Split host config validators into dedicated modules and updated the reference server to construct services from resolved configs plus explicit validators.
- Migrated OIDC/resource-server client secrets to `SecretString` and expanded related config/schema tests.
- Updated Web UI e2e lifecycle cleanup, Rust test cache lane docs, and user-facing docs for the `0.3.x` release line.

### Fixed

- Fixed OAuth resource-server JWE config schema compilation.
- Fixed OIDC config validation APIs so abstract config sources do not expose concrete fixed-redirect helpers or redirect override state.

## [0.2.0]

### Changed

- Promoted SecurityDept from the `0.2.0-beta.*` prerelease line to the first stable `0.2.0` release across the Rust crates, TypeScript SDK packages, Docker image, and authority docs.
- Normalized user-facing docs for the stable line by removing reader-facing beta anchors from the README, overview, and roadmap, while keeping precise release procedures in the release automation docs.
- Kept the release automation contract centered on `tests.yml` verification, `release.yml` trusted publishing, and version-shape/channel inference owned by `release-cli`.

### Fixed

- Finalized the short-lived token refresh recovery path so browser restore, resume reconciliation, route entry, and protected requests refresh before redirecting or sending stale bearer material when refresh material exists.

## [0.2.0-beta.6]

### Changed

- Refined release automation so `tests.yml` remains the verification authority and dispatches `release.yml` after successful `release` branch runs, while `release.yml` itself stays on the `workflow_dispatch` entrypoint required by crates.io trusted publishing.
- Bumped the workspace version to `0.2.0-beta.6` across Rust crates, TypeScript SDK packages, app manifests, lockfiles, and shared release metadata.
- Updated the release automation authority docs to describe the post-Tests dispatch path, manual dispatch expectations, and the current cache ownership model.

### Fixed

- Fixed TypeScript token-set freshness handling for short-lived access tokens by recording `accessTokenIssuedAt`, capping refresh-window and clock-skew calculations relative to the token lifetime, and using the same timing model for timer scheduling.
- Fixed browser-owned token-set recovery paths so restore, route entry, resume reconciliation, and protected requests do not immediately classify newly issued one-minute tokens as `refresh_due` or fall into redundant refresh races.

## [0.2.0-beta.5]

- Refactored github workflows and tests organization.

## [0.2.0-beta.4]

### Added

- Added a token-set access-token freshness model and freshness-aware helpers so SDK callers can distinguish fresh, refresh-due, expired, and no-expiry bearer material before protected requests.
- Added coalesced refresh barriers and fresh authorization APIs across token-set OIDC clients, registries, React services, Angular services, and authorized transports.
- Added local release-workflow simulation commands and release/test/docs workflow planning outputs so CI and publishing decisions can be inspected consistently before running publish jobs.

### Changed

- Consolidated release automation around the docs, tests, and release workflows, with release-branch publishing, expected-tag creation after successful publish jobs, shared release reports, and read-only cache consumers after cache priming.
- Updated Angular bearer interceptors, Angular route guards, React hooks/services, React Query helpers, and TanStack Router guards to use freshness-aware authentication paths instead of raw synchronous bearer projections.
- Updated token-set restore behavior so expired persisted snapshots with refresh material wait for refresh before being treated as authenticated, while expired snapshots without refresh material are cleared or treated as unauthenticated.
- Updated SDK docs and roadmap entries to describe freshness-aware bearer injection, `ExpiredSignature` diagnosis, refresh material expectations, and downstream outposts validation with locally packed SDK artifacts.

### Fixed

- Fixed protected token-set request paths that could inject stale `access_token` values after persistence restore, refresh failure, or expired-without-refresh-material states.
- Fixed refresh coalescing so concurrent protected requests share the same in-flight refresh instead of racing or reusing stale bearer state.
- Fixed TanStack and orchestration transport paths that could bypass the refresh barrier through synchronous auth checks or raw `bearerHeader()` fallback behavior.
- Fixed Firefox popup-login relay flakiness by yielding before closing the callback popup, giving the opener a chance to receive the relay `postMessage` before the e2e waits for the success trace.

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
