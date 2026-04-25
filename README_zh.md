<h1 align="center">
  <img src="./assets/icons/icon.png" alt="logo" height=180/>
  <br />
  <b>SecurityDept</b>
</h1>

SecurityDept 是一个分层的认证和授权工具包。它以可复用 Rust crates、TypeScript SDK packages，以及用于验证真实 server / browser 部署契约的 reference apps 形式交付。

当前 release line：`0.2.0-beta.2`。这条 beta line 聚焦现有 auth stack 的 packaging、文档、release automation 与 reference-app readiness。

<p class="badges" align="center">
  <a href="https://www.npmjs.com/package/@securitydept/client"><img src="https://img.shields.io/npm/v/%40securitydept%2Fclient?logo=npm&label=npm" alt="npm"></a>
  <a href="https://crates.io/crates/securitydept-core"><img src="https://img.shields.io/crates/v/securitydept-core?logo=rust&label=crates.io" alt="crates.io"></a>
  <a href="https://github.com/ethaxon/securitydept/pkgs/container/securitydept"><img src="https://img.shields.io/badge/ghcr-ethaxon%2Fsecuritydept-2496ED?logo=docker&logoColor=white" alt="ghcr"></a>
  <a href="https://github.com/ethaxon/securitydept/actions/workflows/tests.yml"><img src="https://github.com/ethaxon/securitydept/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <a href="https://github.com/ethaxon/securitydept/actions/workflows/docs.yml"><img src="https://github.com/ethaxon/securitydept/actions/workflows/docs.yml/badge.svg" alt="Docs"></a>
</p>

## 使用 SecurityDept

### Rust Crates

当你需要构建服务端 auth flow、凭证验证、OIDC/OAuth 集成，或 framework-neutral auth-context services 时，使用 Rust crates。

主要 crate families：

- `securitydept-creds`、`securitydept-creds-manage`、`securitydept-realip`
- `securitydept-oidc-client`、`securitydept-oauth-provider`、`securitydept-oauth-resource-server`
- `securitydept-basic-auth-context`、`securitydept-session-context`、`securitydept-token-set-context`
- `securitydept-core` 用于对齐下游 re-exports

典型例子：通过 `securitydept-core` 打开 `session-context` feature，然后直接使用它 re-export 出来的类型。

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

这就是当前仓库推荐的 Rust 接入方式：依赖 `securitydept-core`，只打开需要的 feature，再通过它的 re-export 导入对应产品面。

先看 [架构](docs/zh/001-ARCHITECTURE.md) 与 [认证上下文和模式](docs/zh/020-AUTH_CONTEXT_AND_MODES.md)。

### TypeScript SDKs

当你需要为 SecurityDept auth-context modes 构建 browser、React、Angular 或 host-framework 集成时，使用 npm packages。

已发布 SDK families：

- `@securitydept/client`、`@securitydept/client-react`、`@securitydept/client-angular`
- `@securitydept/basic-auth-context-client`、`@securitydept/basic-auth-context-client-react`、`@securitydept/basic-auth-context-client-angular`
- `@securitydept/session-context-client`、`@securitydept/session-context-client-react`、`@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client`、`@securitydept/token-set-context-client-react`、`@securitydept/token-set-context-client-angular`

典型例子：用 `@securitydept/basic-auth-context-client` 接一个纯浏览器 Basic Auth 入口。

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

这是最小 SDK 入口：识别某个 zone 的 `401`，然后把浏览器重定向到对应 login route。

SDK 的权威入口是 [Client SDK 指南](docs/zh/007-CLIENT_SDK_GUIDE.md)。`apps/webui/src/api/*` 是 reference-app glue，不是 public SDK API。

### Reference App 与 Docker Image

reference runtime 组合 Axum server 和 web UI，用于 dogfood：

- Basic Auth、cookie-session、token-set 三种 auth-context modes
- browser / React / Angular SDK adapter ergonomics
- protected management APIs、bearer propagation、real-IP policy、route guards 与 release packaging

典型例子：先从远程拉取官方示例配置和 compose 文件，再在本地启动 reference image。

```bash
wget -O config.toml https://raw.githubusercontent.com/ethaxon/securitydept/main/config.example.toml
wget -O docker-compose.yml https://raw.githubusercontent.com/ethaxon/securitydept/main/docker-compose.yml
docker compose up -d
```

如果你只想先看最小 compose 骨架，可以从下面这一瞥开始：

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

启动后，reference app 会暴露在 `http://localhost:7021`。

Docker image 由 `Docker Build` workflow 构建，并通过 `scripts/release-cli.ts docker publish` 统一生成 tags；详见 [Release Automation](docs/zh/008-RELEASE_AUTOMATION.md)。

## 开发本仓库

修改 SecurityDept 本身时，从这些文档进入：

- [概览](docs/zh/000-OVERVIEW.md)：文档地图与当前 artifact 边界
- [能力矩阵](docs/zh/002-FEATURES.md)：已实现与计划中能力
- [错误系统设计](docs/zh/005-ERROR_SYSTEM_DESIGN.md)：response envelope 与 diagnostics 规则
- [Reference App: Outposts](docs/zh/021-REFERENCE-APP-OUTPOSTS.md)：真实 adopter calibration
- [Roadmap](docs/zh/100-ROADMAP.md)：当前 release 状态与 deferrals
- [TS SDK 迁移记录](docs/zh/110-TS_SDK_MIGRATIONS.md)：public-surface migration records

本地初始化：

```bash
just setup
```

常用循环：

```bash
just dev-all
just lint
just test
just build-docs
```

## 项目边界

- SecurityDept 不是单体 auth service；它是由 reusable crates、SDKs 与 reference apps 组成的分层栈。
- 长期产品化 auth-context surfaces 是 Basic Auth context、session context 与 token-set context。
- mixed custody、BFF、server-side token ownership 等更复杂 token-set 部署形态，除非在 SDK guide 中明确记录，否则不属于当前 beta contract。
- 历史状态不应进入面向用户的 docs；稳定 docs 只描述当前行为或明确的未来计划。

## Docs Site

源文档位于 `docs/en` 与 `docs/zh`。`docsite/` 下的 VitePress docsite 通过 Git-compatible symlinks 引用这些源文档，并与主 app build 分离构建。

计划公开地址：`https://securitydept.ethaxon.com/`。

## 许可证

[MIT](LICENSE.md)

---

[English](README.md) | [中文](README_zh.md)
