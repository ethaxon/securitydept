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
- `node scripts/release-cli.ts version set 0.2.0-beta.2`
- `node scripts/release-cli.ts npm publish --mode=dry-run`
- `node scripts/release-cli.ts npm publish --mode=publish --provenance`
- `node scripts/release-cli.ts crates publish --mode=package --report=temp/release/crates/package-report.json`
- `node scripts/release-cli.ts crates publish --mode=package --allow-blocked --allow-dirty --report=temp/release/crates/blocked-package-report.json`
- `node scripts/release-cli.ts crates publish --mode=publish --report=temp/release/crates/publish-report.json`
- `node scripts/release-cli.ts docker publish --ref=refs/tags/v0.2.0-beta.2`

Behavioral rules:

- `metadata sync` writes shared publish metadata from [`securitydept-metadata.toml`](../../securitydept-metadata.toml) into publishable Rust crates and publishable npm packages, including descriptions, authors, licenses, Rust crate categories, keywords, repository links, and minimal package `README.md` files.
- `version set` updates every release-managed `package.json` and `Cargo.toml` listed in [`securitydept-metadata.toml`](../../securitydept-metadata.toml).
- `version check` also validates publishable Rust `path` dependencies between workspace crates and requires exact internal requirements in the form `=X.Y.Z[-alpha.N|-beta.N]`.
- `version set` also writes those exact internal Rust dependency requirements for publishable crates, so local package verification and publish preparation stay aligned.
- `npm publish` infers the dist-tag from the version unless an explicit override is passed.
- npm package tarball manifest cleanup is owned by the root [`/.pnpmfile.cjs`](../../.pnpmfile.cjs) `hooks.beforePacking` hook rather than ad hoc release-script file rewriting. This hook rewrites `@securitydept/*` `workspace:` version specifiers to the package version that is being published, strips monorepo-only `monorepo-tsc` export conditions from all published packages, and strips Angular-only publish-time fields such as root-only `files` and `devDependencies`.
- Angular SDK packages must publish from the package root with `publishConfig.directory = "dist"`; do not run `pnpm pack` or `pnpm publish` directly inside `dist`, because that loses workspace resolution context before `beforePacking` can sanitize the manifest.
- the GitHub Actions npm publish job uses npm trusted publishing via GitHub OIDC and does not inject a long-lived `NPM_TOKEN`; both the workflow and the local publish entrypoint now pass `--provenance` explicitly so provenance does not depend on implicit defaults.
- `crates publish --allow-dirty` exists only for local blocked packaging loops where the working tree is intentionally dirty; it is not part of CI publish flows.
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

The release block intentionally avoids explicit `beta` tags. The current version already carries the stage, so commands such as `just release-npm-dry-run` and `just release-npm-publish` should infer the correct channel automatically.

## GitHub Actions Rules

Release-related workflows must follow these rules:

- npm publish uses `release-cli npm publish` directly and does not expose a manual dist-tag selector.
- npm publish must preserve the package-root invocation model so pnpm can honor root `publishConfig.directory` and the root `.pnpmfile.cjs` `beforePacking` hook for Angular packages.
- npm publish uses `release-cli npm publish` directly, relies on GitHub Actions `id-token: write`, passes `--provenance` on real publish paths, and expects npm trusted publisher settings to point at `npm-publish.yml` (optionally scoped to the `npm-release` environment).
- crates publish uses `release-cli crates publish`; the default package gate must not use `--allow-blocked`, publish jobs keep `--allow-dirty` out, and `rust-lang/crates-io-auth-action@v1` enables crates.io trusted publishing for `crates-publish.yml` (optionally scoped to the `crates-io-release` environment).
- Docker build computes tags through `release-cli docker publish --format=github-output` and feeds the resulting tags/labels directly into `docker/build-push-action`.

This keeps one implementation of:

- allowed release-version grammar
- prerelease-to-channel mapping
- stable Docker aliases
- branch / SHA / tag naming behavior for Docker images

## Local Workflow

Recommended local sequence before an actual publish:

1. `mise exec --command "just release-metadata-sync"`
2. `mise exec --command "just release-version-check"`
3. `mise exec --command "just release-npm-dry-run"`
4. `mise exec --command "just release-crates-package"`
5. `mise exec --command "just release-docker-metadata v0.2.0-beta.2"`

If the version needs to move first:

1. `mise exec --command "just release-version-set 0.2.0-beta.2"`
2. `mise exec --command "just release-version-check"`

## Maintenance Expectations

When release rules change:

- update `release-cli` first
- update workflows and `justfile` to call into that logic instead of duplicating it
- update this document and the summary rule in [AGENTS.md](../../AGENTS.md)

Do not add new release channels, ad hoc workflow-only tag rules, or manual per-command dist-tag flags without updating the shared release policy.

---

[English](008-RELEASE_AUTOMATION.md) | [中文](../zh/008-RELEASE_AUTOMATION.md)