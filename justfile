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

[windows]
setup-playwright:
    pnpm exec playwright install --with-deps webkit chromium firefox

[macos]
setup-playwright:
    pnpm exec playwright install --with-deps webkit chromium firefox

[linux]
setup-playwright:
    #!/usr/bin/env bash
    set -euo pipefail
    # if is debian/ubuntu, we can install playwright dependencies via playwright install
    # if is arch/manjaro/cachyos, we need to install playwright dependencies via pacman
    # for other distros, please refer to https://playwright.dev/docs/installation#linux-dependencies and install dependencies via system package manager
    if [[ -f /etc/os-release ]] && grep -Eq "debian|ubuntu" /etc/os-release; then
        pnpm exec playwright install --with-deps webkit chromium firefox
    elif [[ -f /etc/os-release ]] && grep -Eq "arch|manjaro|cachyos" /etc/os-release; then
        sudo pacman -S --needed --noconfirm chromium firefox
        just setup-distrobox
    else
        echo "Please install chromium and firefox via your system package manager, then run 'just install-playwright-deps'."
    fi

# Local development entrypoints
dev-webui:
    cd apps/webui && pnpm dev

dev-docs:
    cd docsite && pnpm run dev

dev-server:
    watchexec --watch apps/server --watch packages --watch config.toml --exts rs,toml -- cargo run --manifest-path apps/server/Cargo.toml

dev-all:
    zellij --layout dev.kdl

# Build and packaging tasks
build-sdks:
    cd sdks/ts && pnpm build

build-docs:
    cd docsite && pnpm run build

preview-docs:
    cd docsite && pnpm run preview

build-webui-only:
    cd apps/webui && pnpm build

build-webui:
    pnpm -r --filter @securitydept/webui... build

build-server:
    cargo build --manifest-path apps/server/Cargo.toml --release

build-cli:
    cargo build --manifest-path apps/cli/Cargo.toml --release

build: build-server build-cli build-sdks
    just build-webui-only

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

fix-docsite-symlink:
    node docsite/scripts/fix-docsite-symlink.ts

fix-release-metadata:
    just release-cli metadata sync

fix: fix-rs fix-ts fix-docsite-symlink fix-release-metadata

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

# Integration test prerequisites
build-kube-test-helper:
    docker buildx build --load -t securitydept-realip-kube-integration-test-helper:v1 -f packages/realip/tests/fixtures/kube-helper/Dockerfile packages/realip/tests/fixtures/kube-helper

# Test suites and verification loops
unittest-rs:
    cargo test --workspace --all-features --lib --bins
    cargo test --workspace --all-features --doc

integration-rs:
    cargo test --workspace --test integration --all-features

e2e-rs: build-kube-test-helper
    cargo test --workspace --test e2e --all-features

test-all-rs: unittest-rs integration-rs e2e-rs

unittest-ts:
    cd sdks/ts && pnpm test
    cd apps/webui && pnpm test

e2e-ts:
    cd apps/webui && pnpm run e2e

test-all-ts: unittest-ts e2e-ts

unittest: unittest-rs unittest-ts

integration: integration-rs

e2e: e2e-rs e2e-ts

test-all: test-all-rs test-all-ts

# Type checking and client iteration checks
typecheck-sdks:
    cd sdks/ts && pnpm typecheck

typecheck-webui:
    cd apps/webui && pnpm typecheck

typecheck: 
    pnpm typecheck

verify-client-sdk-iteration:
    pnpm lint-fix
    cd sdks/ts && pnpm build
    cd sdks/ts && pnpm typecheck
    cd sdks/ts && pnpm test
    cd apps/webui && pnpm test
    cd apps/webui && pnpm typecheck
    pnpm -r --filter @securitydept/webui... build

# Generate an Argon2id password hash for config.toml basic_auth_context.users
hash-password password="":
    @cargo run --manifest-path apps/server/Cargo.toml -q -- hash-password {{if password != "" { "--password " + password } else { "" } }}

update-core-feature-gates:
    node scripts/update-core-feature-gates.ts