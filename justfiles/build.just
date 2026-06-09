# Build and packaging tasks
build-sdks:
    pnpm build:sdks

build-docs:
    cd docsite && pnpm run build

preview-docs:
    cd docsite && pnpm run preview

build-webui-only:
    pnpm build:webui

build-webui:
    pnpm stage:webui

build-server:
    cargo build --manifest-path apps/server/Cargo.toml --release

build-cli:
    cargo build --manifest-path apps/cli/Cargo.toml --release

build: build-server build-cli build-sdks build-webui-only
