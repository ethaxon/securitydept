# Release automation and version control
release-cli *args:
    node scripts/release-cli.ts {{args}}

release-version-set version:
    just release-cli version set {{version}}

release-version-check:
    just release-cli version check

release-npm-dry-run: lint-ts build-sdks typecheck-sdks unittest-ts
    just release-cli npm publish --mode=dry-run --report=temp/release/npm/dry-run-report.json

release-npm-publish: lint-ts build-sdks typecheck-sdks unittest-ts
    just release-cli npm publish --mode=publish --provenance --report=temp/release/npm/publish-report.json

release-crates-package: lint-rs unittest-rs integration-rs
    just release-cli crates publish --mode=package --report=temp/release/crates/package-report.json

release-crates-package-blocked: lint-rs unittest-rs integration-rs
    just release-cli crates publish --mode=package --allow-blocked --allow-dirty --report=temp/release/crates/blocked-package-report.json

release-crates-publish: lint-rs unittest-rs integration-rs
    just release-cli crates publish --mode=publish --report=temp/release/crates/publish-report.json

release-docker-metadata ref: lint build typecheck unittest integration
    just release-cli docker publish --ref={{ref}}

action-cli *args:
    node scripts/actions-cli.ts {{args}}

action-release-validate:
    just action-cli release validate

action-release-dry-run *args:
    just action-cli release dispatch --dry-run {{args}}

action-release-run *args:
    just action-cli release dispatch {{args}}
