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

build: build-server build-cli build-sdks build-webui-only
