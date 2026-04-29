# Release Automation

This document is the detailed authority for SecurityDept release automation. It expands the short rules in [AGENTS.md](../../AGENTS.md) and defines how local release commands, versioning, and GitHub workflows are expected to behave.

## Scope

The release authority is split into two layers only:

- [`securitydept-metadata.toml`](../../securitydept-metadata.toml) is the checked-in source of truth for the project version and the set of release-managed manifests.
- [`scripts/release-cli.ts`](../../scripts/release-cli.ts) is the only supported entrypoint for version changes, npm publishing, crates publishing, and Docker tag calculation.

`justfile`, pre-commit hooks, and GitHub Actions should call `release-cli` or `just release-*` recipes. They should not carry a second copy of release-channel or tag-derivation logic.

## Supported Version Shapes

SecurityDept release versions are intentionally restricted to three shapes:

- `X.Y.Z`
- `X.Y.Z-alpha.N`
- `X.Y.Z-beta.N`

Rejected shapes include:

- `-rc.N`
- prerelease identifiers other than `alpha` or `beta`
- extra prerelease segments such as `-beta.1.foo`
- build metadata such as `+build.5`

The repository enforces this through `release-cli version check` and `release-cli version set`.

## Channel Mapping

Release channels are inferred from the version, not passed manually.

| Version shape | Stage | npm dist-tag | Docker channel tag |
| --- | --- | --- | --- |
| `X.Y.Z-alpha.N` | early prerelease | `nightly` | `nightly` |
| `X.Y.Z-beta.N` | release-candidate track | `rc` | `rc` |
| `X.Y.Z` | stable | `latest` | `latest`, `release` |

Rationale:

- `latest` is the standard stable npm/container convention.
- `nightly` is a clear signal that alpha builds are still fast-moving and not for default consumption.
- `rc` is a better external signal than `beta` for publish channels because it tells downstream users the build is pre-release but intended for release validation.
- stable container images also publish `release` as an explicit stable alias for human-facing deployment references, while `latest` remains the default ecosystem convention.

## Release CLI Commands

Primary commands:

- `node scripts/release-cli.ts metadata sync`
- `node scripts/release-cli.ts version check`
- `node scripts/release-cli.ts version set X.Y.Z[-alpha.N|-beta.N]`
- `node scripts/release-cli.ts npm publish --mode=dry-run --report=temp/release/npm/dry-run-report.json`
- `node scripts/release-cli.ts npm publish --mode=publish --provenance --report=temp/release/npm/publish-report.json`
- `node scripts/release-cli.ts crates publish --mode=package --report=temp/release/crates/package-report.json`
- `node scripts/release-cli.ts crates publish --mode=package --allow-blocked --allow-dirty --report=temp/release/crates/blocked-package-report.json`
- `node scripts/release-cli.ts crates publish --mode=publish --report=temp/release/crates/publish-report.json`
- `node scripts/release-cli.ts docker publish --ref=refs/tags/vX.Y.Z[-alpha.N|-beta.N]`
- `node scripts/release-cli.ts workflow tests-preflight --format=github-output`
- `node scripts/release-cli.ts workflow release-plan --format=github-output`

Behavioral rules:

- `metadata sync` writes shared publish metadata from [`securitydept-metadata.toml`](../../securitydept-metadata.toml) into publishable Rust crates and publishable npm packages, including descriptions, authors, licenses, Rust crate categories, keywords, repository links, and minimal package `README.md` files.
- `version set` updates every release-managed `package.json` and `Cargo.toml` listed in [`securitydept-metadata.toml`](../../securitydept-metadata.toml).
- `version check` also validates publishable Rust `path` dependencies between workspace crates and requires exact internal requirements in the form `=X.Y.Z[-alpha.N|-beta.N]`.
- `version set` also writes those exact internal Rust dependency requirements for publishable crates, so local package verification and publish preparation stay aligned.
- `npm publish` infers the dist-tag from the version unless an explicit override is passed.
- `npm publish` disables pnpm Git branch checks automatically in GitHub Actions tag workflows, so detached release-tag checkouts do not fail on `publish-branch` enforcement.
- `npm publish --mode=publish` queries the npm registry first and skips any package version that is already published, so rerunning after a partial publish only continues with the remaining packages.
- `npm publish --report=...` writes the package publish/skip result set used by both local release recipes and GitHub Actions artifacts.
- npm package tarball manifest cleanup is owned by the root [`/.pnpmfile.cjs`](../../.pnpmfile.cjs) `hooks.beforePacking` hook rather than ad hoc release-script file rewriting. This hook rewrites `@securitydept/*` `workspace:` version specifiers to the package version that is being published, strips monorepo-only `monorepo-tsc` export conditions from all published packages, and strips Angular-only publish-time fields such as root-only `files` and `devDependencies`.
- Angular SDK packages must publish from the package root with `publishConfig.directory = "dist"`; do not run `pnpm pack` or `pnpm publish` directly inside `dist`, because that loses workspace resolution context before `beforePacking` can sanitize the manifest.
- the GitHub Actions npm publish job uses npm trusted publishing via GitHub OIDC and does not inject a long-lived `NPM_TOKEN`; both the workflow and the local publish entrypoint now pass `--provenance` explicitly so provenance does not depend on implicit defaults.
- `crates publish --allow-dirty` exists only for local blocked packaging loops where the working tree is intentionally dirty; it is not part of CI publish flows.
- the default `crates publish --mode=package` gate packages all publishable workspace crates in one `cargo package --workspace` invocation. This is required for prerelease internal dependencies, because Cargo verifies later crates against the temporary packaged registry instead of looking only at crates.io for versions that have not been published yet.
- `crates publish --mode=package` and `crates publish --mode=publish` use Cargo's default package/publish verification behavior. They do not pass `--release`; the verification compile therefore uses the dev/debug target directory and `crates-release` restores the Tests workflow debug cache read-only, not the Docker release-profile cache.
- `crates publish --mode=publish` queries crates.io before each crate upload and skips versions that are already present, so rerunning after a partial publish does not fail on duplicate uploads.
- `temp/release/crates/package-report.json` is reserved for the real package gate without `--allow-blocked` and without `--allow-dirty`; blocked diagnostics must write to a separate report such as `temp/release/crates/blocked-package-report.json`.
- the GitHub Actions crates publish job uses crates.io trusted publishing by exchanging the GitHub OIDC token through `rust-lang/crates-io-auth-action@v1`, then passes the short-lived token to `cargo publish`; it does not read a repository-stored `CARGO_REGISTRY_TOKEN` secret.
- `docker publish` is the authoritative Docker tag planner and can emit human-readable output, JSON, or GitHub Actions outputs.

## Just Recipes

`justfile` is grouped by topic so local entrypoints remain predictable:

- bootstrap and environment setup
- local development
- build tasks
- lint and maintenance
- release automation
- tests and verification
- utilities

The release block intentionally avoids explicit prerelease tags. The current version already carries the stage, so commands such as `just release-npm-dry-run` and `just release-npm-publish` should infer the correct channel automatically.

## GitHub Actions Rules

Release-related workflows must follow these rules:

- active workflow entrypoints are limited to `.github/workflows/docs.yml`, `.github/workflows/tests.yml`, and `.github/workflows/release.yml`.
- `tests.yml` owns repository verification. It runs on `main`, `release`, `v*.*.*` tags, pull requests to `main`, and manual dispatch. It writes `tests-workflow-report` so release runs can be audited against the source SHA they depend on. After every successful `release` branch push run, `tests.yml` dispatches `.github/workflows/release.yml` through `workflow_dispatch` with explicit source ref/SHA and publish toggles.
- `release.yml` is the only release/build/publish authority. It only starts through `workflow_dispatch` because crates.io trusted publishing does not support the `workflow_run` trigger event; the automated path must therefore be a post-Tests dispatch instead of requesting OIDC from `workflow_run`.
- `release.yml` owns the source publish gate: it resolves the source with `release-cli workflow release-plan`, runs `release-cli version check`, compares the checked-in version to the expected tag, and verifies tag or `release` branch source lineage before any publish job can run.
- `release` branch publish is the primary automated path. Its expected tag policy is `create-after-publish`: `release-plan` and `validate-release-ref` report the expected tag status, a missing expected tag is allowed before publish, and an existing expected tag must already point to the selected source SHA or the release fails before publishing.
- After all selected publish jobs succeed, the `release-tag` job creates and pushes the expected `vX.Y.Z[-alpha.N|-beta.N]` tag for `release` branch sources. On the release branch path, the tag is the release result and audit anchor; auditing or retrying a tag or another source requires manually dispatching `release.yml` and passing the same release gate.
- `workflow_dispatch` on `release.yml` may publish only when the selected source passes the same release gate; manual toggles choose whether npm, crates, and Docker publish jobs run.
- Local `act` runs are detected by `release-cli workflow release-plan` through `ACT=true` or `SECURITYDEPT_LOCAL_ACTIONS=true` and emit `local_run=true`. The workflow keeps the same job graph, but publish jobs switch to local-safe behavior: npm uses `--mode=dry-run`, crates stop at the package gate and copy that report as the publish report, and Docker builds/loads the runtime image locally without logging in or pushing.
- Local `act` release source validation keeps version/tag shape checks but avoids remote `origin/release` fetches. Real GitHub runs still enforce release-branch reachability against `origin/release` before publishing.
- npm publish uses `release-cli npm publish` directly and does not expose a manual dist-tag selector.
- npm publish must preserve the package-root invocation model so pnpm can honor root `publishConfig.directory` and the root `.pnpmfile.cjs` `beforePacking` hook for Angular packages.
- real npm OIDC publish runs in the `npm-release` job inside `release.yml` with the `npm-release` environment. npm trusted publisher configuration must therefore bind publishable packages to `.github/workflows/release.yml` and `npm-release`.
- `npm-release` is the only job that may request npm `id-token: write`; it builds the TypeScript SDK packages from the validated source and publishes with `release-cli npm publish --mode=publish --provenance --report=...`.
- npm publish relies on GitHub Actions trusted publishing and passes `--provenance` on real publish paths.
- crates publish uses `release-cli crates publish`; package gates must not use `--allow-blocked`, publish jobs keep `--allow-dirty` and `--allow-blocked` out, and `rust-lang/crates-io-auth-action@v1` enables crates.io trusted publishing.
- real crates.io OIDC publish runs in the `crates-release` job inside `release.yml` with the `crates-io-release` environment. crates.io trusted publisher configuration must bind publishable crates to `.github/workflows/release.yml` and `crates-io-release`.
- `crates-release` is the only job that may request crates.io `id-token: write`; it runs `crates publish --mode=package`, exchanges GitHub OIDC through `rust-lang/crates-io-auth-action@v1`, then runs `crates publish --mode=publish`. Package and publish reports are uploaded separately.
- Docker release publishing is artifact-first inside the single `docker-release` job: the job builds `securitydept-server`, `securitydept-cli`, and the web UI outside Docker, stages them under `release-runtime/`, then builds `Dockerfile.runtime` in the same job.
- `Dockerfile.runtime` is the release Docker path. It is Debian slim based to match the GNU/glibc binaries built on GitHub Ubuntu runners. The existing cargo-chef/Alpine `Dockerfile` remains a full-build diagnostic fallback, not the release publish path.
- Docker tag calculation still comes from `release-cli docker publish --format=github-output` and feeds the resulting tags/labels directly into `docker/build-push-action`. When the source is `refs/heads/release`, Docker tag calculation uses `refs/tags/<expected-tag>` so release-branch publishes also produce the version and channel tags (`vX.Y.Z...`, `vX.Y`, `vX`, `rc` / `nightly` / `latest`) plus the immutable `sha-*` tag.
- standalone npm, crates, Docker, and common-CI workflows are not active release entrypoints. Reintroducing one requires updating this document and moving trusted-publisher bindings deliberately.

Cache and artifact rules:

- pnpm and Rust setup/cache behavior is owned by repo-local composite actions under `.github/actions/`.
- pnpm cache modes are explicit: `read-write`, `read-only`, and `none`. The stable restore key is `pnpm-store-${runner.os}-${hashFiles(lockfile)}`; only one job in a workflow topology may be the read-write owner for that key.
- Rust cache modes are also explicit. A job that uses the shared key as `read-write` must be the only writer in that topology; downstream jobs use `read-only` restore or artifacts.
- Debug CI topology lives directly in `.github/workflows/tests.yml`; `release.yml` is dispatched by the successful `Tests` run instead of repeating the same debug verification graph, and it avoids the crates.io-unsupported `workflow_run` publish entrypoint.
- Rust shared keys are stable lane/profile scopes such as `securitydept-rust-${runner.os}-pr-mainline-debug`, `securitydept-rust-${runner.os}-mainline-debug`, and `securitydept-rust-${runner.os}-release`. Do not embed `hashFiles(...)` manually in workflow `shared-key` values; `Swatinem/rust-cache` already adds its own Rust-environment hash for Cargo manifests, lockfiles, toolchains, and relevant env vars, and it can restore from previous lockfile versions.
- Rust cache ownership is split by profile and workflow source:

	| Cache key profile | Read-write owner | Consumers | Notes |
	| --- | --- | --- | --- |
	| `securitydept-rust-${runner.os}-${cache_scope}-debug` | the Tests workflow `rust-debug-cache-prime` job | clippy, Rust tests, E2E prebuild, and `release.yml` `crates-release` read-only restore | owned by the debug CI topology; `cache_scope` is intentionally collapsed into shared lanes such as `pr-mainline` and `mainline` instead of per-PR/per-branch names so the cache budget stays bounded while `main`, `release`, and tag-driven flows still reuse the same debug artifacts |
	| `securitydept-rust-${runner.os}-${cache_scope}-release` in `release.yml` | `docker-release` when `publish_docker=true` | runtime binary builds inside the same `docker-release` job | only Docker consumes release-profile artifacts today, so the writer lives in the single consuming job; split out a prime job only if future release-profile consumers need the same cache |

	Each row has exactly one read-write owner for its cache key. Jobs outside that owner restore read-only or do not touch the key. This is the current practice-approved provisional optimization and depends on the unique-writer topology; its wall-clock benefit still needs a reproducible local workflow benchmark before further tuning.
- Docker buildx cache is scoped only to Docker layer caching. The runtime release scope no longer attempts to cache cargo or pnpm builds because those happen before Docker.
- already-published skip behavior remains owned by `release-cli npm publish` and `release-cli crates publish`, so partial release reruns continue instead of failing on duplicate npm package or crate versions.

This keeps one implementation of:

- allowed release-version grammar
- prerelease-to-channel mapping
- stable Docker aliases
- branch / SHA / tag naming behavior for Docker images

## Local Workflow

Recommended local sequence before an actual publish:

1. `mise exec --command "just fix-release-metadata"`
2. `mise exec --command "just release-version-check"`
3. `mise exec --command "just release-npm-dry-run"`
4. `mise exec --command "just release-crates-package"`
5. `mise exec --command "just release-docker-metadata vX.Y.Z[-alpha.N|-beta.N]"`

If the version needs to move first:

1. `mise exec --command "just release-version-set X.Y.Z[-alpha.N|-beta.N]"`
2. `mise exec --command "just release-version-check"`

For local workflow simulation, prefer the `just` wrappers around `scripts/actions-cli.ts`: `just action-release-validate`, `just action-release-dry-run`, and `just action-release-run`. The real local run creates a temporary MockGithub repository and executes `.github/workflows/release.yml` through act-js, so checkout and artifact behavior are handled in the local mock GitHub environment. Because act sets `ACT=true` and the wrapper also sets `SECURITYDEPT_LOCAL_ACTIONS=true`, the release publish jobs perform only local dry-run/package/build work and never push to npm, crates.io, or GHCR.

Example validation commands:

```bash
just action-release-validate
just action-release-dry-run
just action-release-run publish_npm=false publish_crates=false publish_docker=true
```

The action recipes accept both CLI-style flags such as `--publish-npm=false` and just-friendly shorthand such as `publish_npm=false`.
Publish toggles default to `false`, matching `release.yml` manual dispatch defaults; opt in per channel when local package/build simulation is needed.

`act -n` does not execute `release-plan`, so jobs whose `if` condition depends on `needs.release-plan.outputs.*` may not expand in dry-run mode. A real local `act workflow_dispatch` run receives `local_run=true` from `release-plan` and follows the local dry-run/package/no-push branches.

## Maintenance Expectations

When release rules change:

- update `release-cli` first
- update workflows and `justfile` to call into that logic instead of duplicating it
- update this document and the summary rule in [AGENTS.md](../../AGENTS.md)

Do not add new release channels, ad hoc workflow-only tag rules, or manual per-command dist-tag flags without updating the shared release policy.

---

[English](008-RELEASE_AUTOMATION.md) | [中文](../zh/008-RELEASE_AUTOMATION.md)
