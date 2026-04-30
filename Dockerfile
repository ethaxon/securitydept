# syntax=docker/dockerfile:1
FROM rustlang/rust:nightly-alpine AS rust-chef
ENV RUSTUP_TOOLCHAIN=nightly-x86_64-unknown-linux-musl
ENV RUSTUP_SKIP_SELF_UPDATE=1
RUN --mount=type=cache,target=/var/cache/apk \
    apk add --no-cache curl ca-certificates
RUN rustup set auto-self-update disable
RUN curl -L --proto '=https' --tlsv1.2 -sSf https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh | sh
RUN cargo binstall cargo-chef --no-confirm 
WORKDIR /app

FROM rust-chef AS rust-planner 
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo chef prepare --recipe-path recipe.json

FROM rust-chef AS rust-builder
COPY --from=rust-planner /app/recipe.json recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    cargo chef cook --release --recipe-path recipe.json
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    cargo build --release

FROM node:24-alpine AS webui-builder
RUN npm install -g pnpm@10.33.0
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=cache,target=/root/.npm \
    pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm -r --filter @securitydept/webui... build

FROM alpine AS runtime
RUN --mount=type=cache,target=/var/cache/apk \
    apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=rust-builder /app/target/release/securitydept-server /app/securitydept-server
COPY --from=rust-builder /app/target/release/securitydept-cli /app/securitydept-cli
COPY --from=webui-builder /app/webui /app/webui
RUN mkdir /app/data
CMD ["/app/securitydept-server"]
