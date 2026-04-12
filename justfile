set dotenv-load := true
set windows-shell := ["pwsh.exe", "-NoLogo", "-ExecutionPolicy", "RemoteSigned", "-Command"]

setup:
    pnpm install
    cargo check --workspace --all-features

build-webui: build-sdks
    cd apps/webui && pnpm build

build-server:
    cargo build --manifest-path apps/server/Cargo.toml --release

build-cli:
    cargo build --manifest-path apps/cli/Cargo.toml --release

build: build-webui

run-server: build
    cargo run --manifest-path apps/server/Cargo.toml --release

dev-webui:
    cd apps/webui && pnpm dev

dev-server:
    watchexec --restart --watch apps/server --watch packages/core --watch config.toml --exts rs,toml -- cargo run --manifest-path apps/server/Cargo.toml

dev: dev-server

lint-rs:
    cargo clippy --workspace --all-features

lint-ts:
    pnpm lint

lint: lint-rs lint-ts

fix-rs:
    cargo clippy --workspace --all-features --fix --allow-dirty

fix-ts:
    pnpm lint-fix

fix: fix-rs fix-ts

test-rs:
    cargo test --workspace --all-features

test-ts:
    pnpm test

test: test-rs test-ts

update-core-feature-gates:
    node scripts/update-core-feature-gates.ts

build-sdks:
    cd sdks/ts && pnpm build

test-sdks: 
    cd sdks/ts && pnpm test

typecheck-sdks:
    cd sdks/ts && pnpm typecheck

typecheck:
    pnpm typecheck

verify-client-sdk-iteration:
    pnpm lint-fix
    pnpm lint
    cd sdks/ts && pnpm build
    cd sdks/ts && pnpm typecheck
    cd sdks/ts && pnpm test
    cd apps/webui && pnpm test
    cd apps/webui && pnpm typecheck
    cd apps/webui && pnpm build
