# Local development entrypoints
dev-webui:
    cd apps/webui && pnpm dev

dev-docs:
    cd docsite && pnpm run dev

dev-server:
    watchexec --watch apps/server --watch packages --watch config.toml --exts rs,toml -- cargo run --manifest-path apps/server/Cargo.toml

dev-all:
    zellij --layout dev.kdl
