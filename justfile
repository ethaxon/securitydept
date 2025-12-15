set dotenv-load := true
set windows-shell := ["pwsh.exe", "-NoLogo", "-ExecutionPolicy", "RemoteSigned", "-Command"]

setup:
    pnpm install --ignore-scripts

build-webui:
    cd apps/webui && pnpm build

build-server:
    cargo build --manifest-path apps/server/Cargo.toml --release

build-cli:
    cargo build --manifest-path apps/cli/Cargo.toml --release

build: build-webui build-server build-cli

dev-webui:
    cd apps/webui && pnpm dev

dev-server:
    cargo run --manifest-path apps/server/Cargo.toml

dev: dev-server

check:
    cargo check --workspace

lint-rs:
    cargo clippy --workspace

lint-ts:
    pnpm lint

lint: lint-rs lint-ts
