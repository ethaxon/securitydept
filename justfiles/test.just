# Integration test prerequisites
build-kube-test-runtime-images:
    node scripts/test-cli.ts kube build-runtime-images

build-kube-test-helper:
    node scripts/test-cli.ts kube build-helper

ensure-kube-test-helper:
    node scripts/test-cli.ts kube ensure-helper

clean-kube-test-artifacts:
    node scripts/test-cli.ts kube clean-artifacts

clean-kube-test-images:
    node scripts/test-cli.ts kube clean-images

# Test suites and verification loops
unittest-rs:
    cargo test --workspace --all-features --lib --bins
    cargo test --workspace --all-features --doc

integration-rs:
    cargo test --workspace --test integration --all-features

e2e-rs:
    node scripts/test-cli.ts kube run-e2e-rs

e2e-rs-hot:
    node scripts/test-cli.ts kube run-e2e-rs --keep-clusters-running

e2e-rs-isolated:
    node scripts/test-cli.ts kube run-e2e-rs --reuse-clusters=false

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
