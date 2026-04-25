set dotenv-load := true
set windows-shell := ["pwsh.exe", "-NoLogo", "-ExecutionPolicy", "RemoteSigned", "-Command"]

# Workspace bootstrap and shared environments
setup: setup-docs
    pnpm install
    cargo check --workspace --all-features

setup-docs:
    cd docsite && pnpm install

setup-distrobox:
    distrobox create --name playwright-env --image ubuntu:24.04
    distrobox enter playwright-env -- bash -c "mise trust 2> /dev/null && pnpm exec playwright install --with-deps webkit"

# Local development entrypoints
dev-webui:
    cd apps/webui && pnpm dev

dev-docs:
    cd docsite && pnpm run dev

dev-server:
    watchexec --watch apps/server --watch packages --watch config.toml --exts rs,toml -- cargo run --manifest-path apps/server/Cargo.toml

# requires zellij watchexec
dev-all:
    zellij --layout dev.kdl

# Build and packaging tasks
build-sdks:
    cd sdks/ts && pnpm build

build-docs:
    cd docsite && pnpm run build

preview-docs:
    cd docsite && pnpm run preview

verify-docs: build-docs

build-webui:
    pnpm -r --filter @securitydept/webui... build

build-server:
    cargo build --manifest-path apps/server/Cargo.toml --release

build-cli:
    cargo build --manifest-path apps/cli/Cargo.toml --release

build: build-webui build-server build-cli

# Lint, formatting, and repo maintenance
lint-rs:
    cargo clippy --workspace --all-features

lint-ts:
    pnpm lint

lint: lint-rs lint-ts

fix-rs:
    cargo clippy --workspace --all-features --fix --allow-dirty

fix-ts:
    pnpm lint-fix

sync-docsite:
    node docsite/scripts/sync-docsite-symlink.ts

fix: fix-rs fix-ts sync-docsite

# Release automation and version control
release-cli *args:
    node scripts/release-cli.ts {{args}}

release-version-set version:
    just release-cli version set {{version}}

release-version-check:
    just release-cli version check

release-npm-dry-run:
    pnpm lint
    just typecheck-sdks
    just test-sdks
    just release-cli npm publish --mode=dry-run

release-npm-publish:
    pnpm lint
    just typecheck-sdks
    just test-sdks
    just release-cli npm publish --mode=publish --provenance

release-crates-package:
    just release-cli crates publish --mode=package --report=temp/release/crates/package-report.json

release-crates-package-blocked:
    just release-cli crates publish --mode=package --allow-blocked --allow-dirty --report=temp/release/crates/package-report.json

release-crates-publish:
    just release-cli crates publish --mode=publish --report=temp/release/crates/publish-report.json

release-docker-metadata ref:
    just release-cli docker publish --ref={{ref}}

# Integration test prerequisites
build-kube-test-helper:
    docker buildx build --load -t securitydept-realip-kube-integration-test-helper:v1 -f packages/realip/tests/fixtures/kube-helper/Dockerfile packages/realip/tests/fixtures/kube-helper

# Test suites and verification loops
test-rs: build-kube-test-helper
    cargo test --workspace --all-features

test-sdks: 
    cd sdks/ts && pnpm test

test-webui:
    cd apps/webui && pnpm test

test-ts:
    just test-sdks
    just test-webui

test: test-rs test-ts

e2e-webui:
    cd apps/webui && pnpm run e2e

e2e: e2e-webui

# Type checking and client iteration checks
typecheck-sdks:
    cd sdks/ts && pnpm typecheck

typecheck-webui:
    cd apps/webui && pnpm typecheck

verify-client-sdk-iteration:
    pnpm lint-fix
    pnpm lint
    cd sdks/ts && pnpm build
    cd sdks/ts && pnpm typecheck
    cd sdks/ts && pnpm test
    cd apps/webui && pnpm test
    cd apps/webui && pnpm typecheck
    pnpm -r --filter @securitydept/webui... build

# Runtime helpers and one-off utilities
run-server: build
    cargo run --manifest-path apps/server/Cargo.toml --release

# Generate an Argon2id password hash for config.toml basic_auth_context.users
hash-password password="":
    @cargo run --manifest-path apps/server/Cargo.toml -q -- hash-password {{if password != "" { "--password " + password } else { "" } }}


update-core-feature-gates:
    node scripts/update-core-feature-gates.ts