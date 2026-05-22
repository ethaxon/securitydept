<h1 align="center">
  <img src="./assets/icons/icon.png" alt="logo" height=180/>
  <br />
  <b>SecurityDept</b>
</h1>

SecurityDept is a layered authentication and authorization toolkit. It ships as reusable Rust crates, TypeScript SDK packages, and reference applications that exercise the same contracts in real server and browser deployments.

Use the badges above as the published-package status view. Use this README as the repository entry point; use the focused docs for detailed contracts and release policy.

<p class="badges" align="center">
  <a href="https://www.npmjs.com/package/@securitydept/client"><img src="https://img.shields.io/npm/v/%40securitydept%2Fclient?logo=npm&label=npm" alt="npm"></a>
  <a href="https://crates.io/crates/securitydept-core"><img src="https://img.shields.io/crates/v/securitydept-core?logo=rust&label=crates.io" alt="crates.io"></a>
  <a href="https://github.com/ethaxon/securitydept/pkgs/container/securitydept"><img src="https://img.shields.io/badge/ghcr-ethaxon%2Fsecuritydept-2496ED?logo=docker&logoColor=white" alt="ghcr"></a>
  <a href="https://github.com/ethaxon/securitydept/actions/workflows/tests.yml"><img src="https://github.com/ethaxon/securitydept/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <a href="https://github.com/ethaxon/securitydept/actions/workflows/docs.yml"><img src="https://github.com/ethaxon/securitydept/actions/workflows/docs.yml/badge.svg" alt="Docs"></a>
</p>

## Choose Your Entry Point

### Rust Crates

Use the Rust crates when your integration point is a server, a proxy boundary, credential management, or framework-neutral auth-context services.

Primary crate families:

- `securitydept-creds`, `securitydept-creds-manage`, `securitydept-realip`
- `securitydept-oidc-client`, `securitydept-oauth-provider`, `securitydept-oauth-resource-server`
- `securitydept-basic-auth-context`, `securitydept-session-context`, `securitydept-token-set-context`
- `securitydept-core` for aligned downstream re-exports

Recommended entry style: depend on `securitydept-core`, enable only the features you need, and import the product surface through its re-exports.

```bash
cargo add securitydept-core --features session-context
```

```rust
use securitydept_core::session_context::{
  SessionContext,
  SessionContextConfig,
  SessionPrincipal,
};

let session_config = SessionContextConfig::default();
let session = SessionContext::builder()
  .principal(
    SessionPrincipal::builder()
      .subject("dev-session")
      .display_name("dev")
      .build(),
  )
  .build();
```

Start with [Architecture](docs/en/001-ARCHITECTURE.md) for crate boundaries and [Auth Context and Modes](docs/en/020-AUTH_CONTEXT_AND_MODES.md) for the product surfaces.

### TypeScript SDKs

Use the npm packages when you are building browser, React, Angular, or host-framework integrations for SecurityDept auth-context modes.

Published SDK families:

- `@securitydept/client`, `@securitydept/client-react`, `@securitydept/client-angular`
- `@securitydept/basic-auth-context-client`, `@securitydept/basic-auth-context-client-react`, `@securitydept/basic-auth-context-client-angular`
- `@securitydept/session-context-client`, `@securitydept/session-context-client-react`, `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client`, `@securitydept/token-set-context-client-react`, `@securitydept/token-set-context-client-angular`

Typical example: handle a browser-only Basic Auth entry with `@securitydept/basic-auth-context-client`.

```bash
pnpm add @securitydept/basic-auth-context-client
```

```ts
import {
  AuthGuardResultKind,
  BasicAuthContextClient,
} from "@securitydept/basic-auth-context-client";

const client = new BasicAuthContextClient({
  baseUrl: "https://auth.example.com",
  zones: [{ zonePrefix: "/basic" }],
});

const result = client.handleUnauthorized("/basic/api/groups", 401);

if (result.kind === AuthGuardResultKind.Redirect) {
  window.location.href = result.location;
}
```

That is the minimal SDK entry: detect a zone-scoped `401` and redirect the browser to the matching login route.

Use [Client SDK Guide](docs/en/007-CLIENT_SDK_GUIDE.md) as the authority for package boundaries, subpaths, stability labels, and adapter contracts. Treat `apps/webui/src/api/*` as reference-app glue, not public SDK API.

### Reference Runtime

Use the reference runtime when you need an executable baseline rather than a library-only integration. The repo ships:

- `apps/server` as the Axum reference server
- `apps/webui` as the React reference UI
- a release Docker image that combines the server and web UI artifacts

The reference runtime dogfoods:

- Basic Auth, cookie-session, and token-set auth-context modes
- browser / React / Angular SDK adapter ergonomics
- protected management APIs, bearer propagation, real-IP policy, route guards, and release packaging

Typical example: fetch the sample config and compose file, then start the published image locally.

```bash
wget -O config.toml https://raw.githubusercontent.com/ethaxon/securitydept/main/config.example.toml
wget -O docker-compose.yml https://raw.githubusercontent.com/ethaxon/securitydept/main/docker-compose.yml
docker compose up -d
```

If you only want the smallest compose skeleton, it looks like this:

```yaml
services:
  securitydept-server:
    image: ghcr.io/ethaxon/securitydept:latest
    ports:
      - "7021:7021"
    environment:
      SECURITYDEPT_CONFIG: /app/config.toml
    volumes:
      - ./config.toml:/app/config.toml
      - ./data:/app/data
```

The reference runtime is then exposed on `http://localhost:7021`. For Docker tags, publish behavior, and release workflow, see [Release Automation](docs/en/008-RELEASE_AUTOMATION.md).

## Navigate The Docs

Start here when you need project guidance rather than package APIs:

- [Overview](docs/en/000-OVERVIEW.md) for the documentation map and artifact boundaries
- [Architecture](docs/en/001-ARCHITECTURE.md) for crate layering and runtime ownership
- [Client SDK Guide](docs/en/007-CLIENT_SDK_GUIDE.md) for TypeScript package boundaries and public contracts
- [Release Automation](docs/en/008-RELEASE_AUTOMATION.md) for versioning, publish workflow, and release authority
- [Roadmap](docs/en/100-ROADMAP.md) for active constraints and deferred topics
- [TS SDK Migrations](docs/en/110-TS_SDK_MIGRATIONS.md) for public-surface migration history
- [CHANGELOG](CHANGELOG.md) for release execution history

Use [Features](docs/en/002-FEATURES.md), [Error System Design](docs/en/005-ERROR_SYSTEM_DESIGN.md), [RealIP](docs/en/006-REALIP.md), and [Reference App: Outposts](docs/en/021-REFERENCE-APP-OUTPOSTS.md) when you need those focused contracts.

## Develop This Repository

Local setup:

```bash
mise install
pnpm install
just setup-docs
```

Common loops:

```bash
just dev-server
just dev-webui
just lint
just unittest
just integration
just e2e
just test-all
just build-docs
```

`just build-docs` is the docs-site build and verification path; it is independent from the main app build. The root `justfile` imports topic files under `justfiles/`, but recipes still execute from the repository root.

Kubernetes-backed Rust e2e resources are managed through `scripts/test-cli.ts`, with reusable labeled local Docker/kind/k3d resources and explicit cleanup recipes.

## Project Boundaries

- SecurityDept is not a single monolithic auth service; it is a layered stack of reusable crates, SDKs, and reference apps.
- The long-term product auth-context surfaces are Basic Auth context, session context, and token-set context.
- Higher-complexity token-set deployments such as mixed custody, BFF, and server-side token ownership are not part of the current release contract unless documented in the SDK guide.
- Historical status belongs outside user-facing docs; docs should describe current behavior or explicit future plans.

## Docs Site

Source docs live in `docs/en` and `docs/zh`. The VitePress docsite in `docsite/` uses Git-compatible symlinks to those source docs and is built independently from the main app build.

Planned public URL: `https://securitydept.ethaxon.com/`.

## License

[MIT](LICENSE.md)

---

[English](README.md) | [中文](README_zh.md)
