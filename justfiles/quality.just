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
