<h1 align="center">
  <img src="./assets/icons/icon.png" alt="logo" height=180/>
  <br />
  <b>SecurityDept</b>
</h1>

SecurityDept 是一个分层的认证与授权工具包。它以可复用的 Rust crates、TypeScript SDK packages，以及用于验证真实 server / browser 部署契约的参考应用形式交付。

上方徽章反映已发布 package 的状态。这份 README 只负责仓库入口和导航；具体契约、发布规则与迁移记录以 focused docs 为准。

<p class="badges" align="center">
  <a href="https://www.npmjs.com/package/@securitydept/client"><img src="https://img.shields.io/npm/v/%40securitydept%2Fclient?logo=npm&label=npm" alt="npm"></a>
  <a href="https://crates.io/crates/securitydept-core"><img src="https://img.shields.io/crates/v/securitydept-core?logo=rust&label=crates.io" alt="crates.io"></a>
  <a href="https://github.com/ethaxon/securitydept/pkgs/container/securitydept"><img src="https://img.shields.io/badge/ghcr-ethaxon%2Fsecuritydept-2496ED?logo=docker&logoColor=white" alt="ghcr"></a>
  <a href="https://github.com/ethaxon/securitydept/actions/workflows/tests.yml"><img src="https://github.com/ethaxon/securitydept/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <a href="https://github.com/ethaxon/securitydept/actions/workflows/docs.yml"><img src="https://github.com/ethaxon/securitydept/actions/workflows/docs.yml/badge.svg" alt="Docs"></a>
</p>

## 从哪里进入

### Rust Crates

当你的集成点是 server、proxy 边界、凭证管理，或 framework-neutral auth-context services 时，使用 Rust crates。

主要 crate families：

- `securitydept-creds`、`securitydept-creds-manage`、`securitydept-realip`
- `securitydept-oidc-client`、`securitydept-oauth-provider`、`securitydept-oauth-resource-server`
- `securitydept-basic-auth-context`、`securitydept-session-context`、`securitydept-token-set-context`
- `securitydept-core` 用于对齐下游 re-exports

推荐入口方式是：依赖 `securitydept-core`，只打开需要的 feature，再通过它的 re-export 导入产品面。

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

先看 [架构](docs/zh/001-ARCHITECTURE.md) 理解 crate 边界，再看 [认证上下文和模式](docs/zh/020-AUTH_CONTEXT_AND_MODES.md) 理解产品面。

### TypeScript SDKs

当你需要为 SecurityDept auth-context modes 构建 browser、React、Angular 或 host-framework 集成时，使用 npm packages。

已发布 SDK families：

- `@securitydept/client`、`@securitydept/client-react`、`@securitydept/client-angular`
- `@securitydept/basic-auth-context-client`、`@securitydept/basic-auth-context-client-react`、`@securitydept/basic-auth-context-client-angular`
- `@securitydept/session-context-client`、`@securitydept/session-context-client-react`、`@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client`、`@securitydept/token-set-context-client-react`、`@securitydept/token-set-context-client-angular`

典型例子：用 `@securitydept/basic-auth-context-client` 处理一个纯浏览器 Basic Auth 入口。

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

[Client SDK 指南](docs/zh/007-CLIENT_SDK_GUIDE.md) 是 package boundaries、subpaths、stability labels 与 adapter contracts 的权威文档。`apps/webui/src/api/*` 是 reference-app glue，不是 public SDK API。

### 参考运行时

当你需要一个可执行基线，而不是只做 library-only integration 时，使用参考运行时。仓库提供：

- `apps/server` 作为 Axum 参考服务端
- `apps/webui` 作为 React 参考界面
- 一个组合 server 与 web UI 制品的 release Docker image

参考运行时主要用于 dogfood：

- Basic Auth、cookie-session、token-set 三种 auth-context modes
- browser / React / Angular SDK adapter ergonomics
- protected management APIs、bearer propagation、real-IP policy、route guards 与 release packaging

典型例子：先拉取示例配置和 compose 文件，再在本地启动已发布 image。

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

启动后，参考运行时会暴露在 `http://localhost:7021`。Docker tags、publish 行为和 release workflow 详见 [发布自动化](docs/zh/008-RELEASE_AUTOMATION.md)。

## 文档导航

当你需要项目说明而不是 package API 时，从这些文档进入：

- [概览](docs/zh/000-OVERVIEW.md)：文档地图与制品边界
- [架构](docs/zh/001-ARCHITECTURE.md)：crate 分层与 runtime ownership
- [Client SDK 指南](docs/zh/007-CLIENT_SDK_GUIDE.md)：TypeScript package boundaries 与 public contracts
- [发布自动化](docs/zh/008-RELEASE_AUTOMATION.md)：versioning、publish workflow 与 release authority
- [Roadmap](docs/zh/100-ROADMAP.md)：当前约束与延期主题
- [TS SDK 迁移记录](docs/zh/110-TS_SDK_MIGRATIONS.md)：公共接口迁移记录
- [CHANGELOG](CHANGELOG.md)：发布执行历史

如果你需要专项契约，再看 [能力矩阵](docs/zh/002-FEATURES.md)、[错误系统设计](docs/zh/005-ERROR_SYSTEM_DESIGN.md)、[RealIP](docs/zh/006-REALIP.md) 与 [Outposts 参考案例](docs/zh/021-REFERENCE-APP-OUTPOSTS.md)。

## 开发本仓库

本地初始化：

```bash
mise install
pnpm install
just setup-docs
```

常用循环：

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

`just build-docs` 是 docs site 的构建与验证路径，独立于主 app build。根 `justfile` 通过 `import` 拆分到 `justfiles/`，但所有 recipe 仍从仓库根目录执行。

Kubernetes Rust e2e 资源由 `scripts/test-cli.ts` 管理，使用带 `securitydept.test=true` 标签的可复用本地 Docker/kind/k3d 资源，并提供显式清理 recipe。

## 项目边界

- SecurityDept 不是单体 auth service；它是由 reusable crates、SDKs 与参考应用组成的分层栈。
- 长期产品化 auth-context surfaces 是 Basic Auth context、session context 与 token-set context。
- mixed custody、BFF、server-side token ownership 等更复杂 token-set 部署形态，除非在 SDK guide 中明确记录，否则不属于当前 release contract。
- 历史状态不应进入面向用户的 docs；稳定 docs 只描述当前行为或明确的未来计划。

## Docs Site

源文档位于 `docs/en` 与 `docs/zh`。`docsite/` 下的 VitePress docsite 通过 Git-compatible symlinks 引用这些源文档，并与主 app build 分离构建。

计划公开地址：`https://securitydept.ethaxon.com/`。

## 许可证

[MIT](LICENSE.md)

---

[English](README.md) | [中文](README_zh.md)
