# Local development entrypoints
dev-webui:
    pnpm dev:webui

dev-docs:
    cd docsite && pnpm run dev

dev-server:
    watchexec --watch apps/server --watch packages --watch config.toml --exts rs,toml -- cargo run --manifest-path apps/server/Cargo.toml

dev-all:
    zellij --layout dev.kdl

dev-cli *args:
    cargo run --manifest-path apps/cli/Cargo.toml -- {{args}}