<h1 align="center">
  <img src="./assets/icons/icon.png" alt="SecurityDept logo" height="180">
  <br>
  <b>SecurityDept</b>
</h1>

SecurityDept is a layered authentication and authorization toolkit. It ships reusable Rust crates, a TypeScript client SDK workspace, and an Axum/React reference runtime that exercises the same contracts.

<p class="badges" align="center">
  <a href="https://www.npmjs.com/package/@securitydept/client"><img src="https://img.shields.io/npm/v/%40securitydept%2Fclient?logo=npm&label=npm" alt="npm"></a>
  <a href="https://crates.io/crates/securitydept-core"><img src="https://img.shields.io/crates/v/securitydept-core?logo=rust&label=crates.io" alt="crates.io"></a>
  <a href="https://github.com/ethaxon/securitydept/pkgs/container/securitydept"><img src="https://img.shields.io/badge/ghcr-ethaxon%2Fsecuritydept-2496ED?logo=docker&logoColor=white" alt="ghcr"></a>
  <a href="https://github.com/ethaxon/securitydept/actions/workflows/tests.yml"><img src="https://github.com/ethaxon/securitydept/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <a href="https://github.com/ethaxon/securitydept/actions/workflows/docs.yml"><img src="https://github.com/ethaxon/securitydept/actions/workflows/docs.yml/badge.svg" alt="Docs"></a>
</p>

## What To Use

| Need | Use |
| --- | --- |
| Server-side credentials, OAuth/OIDC, client-IP policy, or auth contexts | The Rust crates under `packages/*`; start with `securitydept-core` or the owning crate. |
| Browser, React, Angular, or host-runtime authentication integration | The TypeScript SDK under `sdks/ts/packages/*`; start with `@securitydept/client` and the relevant context client. |
| An executable baseline with server and browser behavior | `apps/server`, `apps/webui`, `config.example.toml`, and the published Docker image. |

SecurityDept has three product auth contexts:

- Basic Auth context for HTTP Basic Auth challenge zones.
- Session context for server-owned cookie sessions.
- Token-set context for frontend- or backend-mediated OIDC token state.

Read [Architecture](docs/en/001-ARCHITECTURE.md) for ownership boundaries and [Auth Context and Modes](docs/en/020-AUTH_CONTEXT_AND_MODES.md) for the model.

## TypeScript SDK

The TypeScript SDK uses explicit host capabilities. Construct a `FoundationEnvironment` through a host-specific creator, then pass it to a context client. The required baseline is neutral transport, time, realm storage, span, and tracing; browser capabilities such as router, popup, and persistent storage remain explicit optional dependencies.

The core package exposes SDK-owned signals, event streams, cancellation tokens, spans, tracing, transport, and RxJS interoperability. Public APIs expose SDK traits rather than raw RxJS observables; internal implementations are free to compose with RxJS directly.

Token-set clients use one in-memory auth snapshot authority. `start()` is the initial lifecycle entry; a registry owns readiness when it constructs clients. See [Client SDK Guide](docs/en/007-CLIENT_SDK_GUIDE.md) before choosing a package or subpath.

## First Integration

For a Rust server integration, add the owning crate directly or use the curated `securitydept-core` re-exports with only the required feature set:

```bash
cargo add securitydept-core --features session-context
```

For a browser Basic Auth boundary, install the foundation and context client, construct an explicit browser environment, then use the public factory rather than a constructor:

```bash
pnpm add @securitydept/client @securitydept/basic-auth-context-client
```

```ts
import { BasicAuthContextClient } from "@securitydept/basic-auth-context-client";
import { createEnvironmentForNativeWeb } from "@securitydept/client/web";

const environment = createEnvironmentForNativeWeb({});
const client = BasicAuthContextClient.fromEnvironmentConfig({
  environment,
  config: {
    baseUrl: "https://auth.example.com",
    zones: [{ zonePrefix: "/basic" }],
    probePath: "/basic/api/status",
  },
});

await client.start();
```

The environment creator is the browser composition root. Framework applications should compose their framework environment or injector there, rather than allowing a client to discover browser globals later.

## Reference Runtime

The reference server mounts session, Basic Auth, token-set backend OIDC, token-set frontend configuration projection, management, propagation, and health route families. The React WebUI is an executable host for the same SDK contracts.

To run the published runtime locally:

```bash
wget -O config.toml https://raw.githubusercontent.com/ethaxon/securitydept/main/config.example.toml
wget -O docker-compose.yml https://raw.githubusercontent.com/ethaxon/securitydept/main/docker-compose.yml
docker compose up -d
```

The default service address is `http://localhost:7021`. The supplied configuration is the authority for enabled routes and provider settings.

## Develop

Use the declared toolchain:

```bash
mise install
pnpm install
just setup-docs
```

Common commands:

```bash
just dev-server
just dev-webui
just lint
just test-all
just build-docs
```

`just build-docs` validates the VitePress site independently from the runtime build. Source documentation lives in `docs/en` and `docs/zh`; `docsite/` renders those files through symlinks.

## Documentation

- [Overview](docs/en/000-OVERVIEW.md)
- [Architecture](docs/en/001-ARCHITECTURE.md)
- [Capability Matrix](docs/en/002-FEATURES.md)
- [Client SDK Guide](docs/en/007-CLIENT_SDK_GUIDE.md)
- [Release Automation](docs/en/008-RELEASE_AUTOMATION.md)
- [TS SDK Migrations](docs/en/110-TS_SDK_MIGRATIONS.md)
- [CHANGELOG](CHANGELOG.md)

## License

[MIT](LICENSE.md)

---

[English](README.md) | [中文](README_zh.md)
