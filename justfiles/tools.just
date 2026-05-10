# Generate an Argon2id password hash for config.toml basic_auth_context.users
hash-password password="":
    @cargo run --manifest-path apps/server/Cargo.toml -q -- hash-password {{if password != "" { "--password " + password } else { "" } }}

update-core-feature-gates:
    node scripts/update-core-feature-gates.ts
