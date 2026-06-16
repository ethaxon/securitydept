<h1 align="center">
  <img src="./assets/icons/icon.png" alt="SecurityDept logo" height="180">
  <br>
  <b>SecurityDept</b>
</h1>

SecurityDept 是分层的认证与授权工具包，交付为可复用 Rust crates、TypeScript client SDK workspace，以及共同验证同一 contract 的 Axum/React reference runtime。

<p class="badges" align="center">
  <a href="https://www.npmjs.com/package/@securitydept/client"><img src="https://img.shields.io/npm/v/%40securitydept%2Fclient?logo=npm&label=npm" alt="npm"></a>
  <a href="https://crates.io/crates/securitydept-core"><img src="https://img.shields.io/crates/v/securitydept-core?logo=rust&label=crates.io" alt="crates.io"></a>
  <a href="https://github.com/ethaxon/securitydept/pkgs/container/securitydept"><img src="https://img.shields.io/badge/ghcr-ethaxon%2Fsecuritydept-2496ED?logo=docker&logoColor=white" alt="ghcr"></a>
  <a href="https://github.com/ethaxon/securitydept/actions/workflows/tests.yml"><img src="https://github.com/ethaxon/securitydept/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <a href="https://github.com/ethaxon/securitydept/actions/workflows/docs.yml"><img src="https://github.com/ethaxon/securitydept/actions/workflows/docs.yml/badge.svg" alt="Docs"></a>
</p>

## 选择入口

| 需求 | 使用内容 |
| --- | --- |
| 服务端 credential、OAuth/OIDC、client-IP policy 或 auth context | `packages/*` 下的 Rust crates；从 `securitydept-core` 或拥有该职责的 crate 开始。 |
| browser、React、Angular 或 host-runtime authentication integration | `sdks/ts/packages/*` 下的 TypeScript SDK；从 `@securitydept/client` 与对应 context client 开始。 |
| 需要可执行的 server/browser 基线 | `apps/server`、`apps/webui`、`config.example.toml` 和发布的 Docker image。 |

SecurityDept 有三个产品 auth context：

- Basic Auth context：HTTP Basic Auth challenge zone。
- Session context：server-owned cookie session。
- Token-set context：frontend 或 backend mediated OIDC token state。

crate 和 runtime ownership 见 [架构](docs/zh/001-ARCHITECTURE.md)，产品模型见 [认证上下文和模式](docs/zh/020-AUTH_CONTEXT_AND_MODES.md)。

## TypeScript SDK

TypeScript SDK 使用显式 host capability。通过 host-specific creator 构造 `FoundationEnvironment` 后传给 context client。required baseline 是 neutral transport、time、realm storage、span、tracing；router、popup、persistent storage 等 browser capability 保持显式 optional dependency。

core package 提供 SDK-owned signal、event stream、cancellation token、span、tracing、transport 和 RxJS interop。public API 暴露 SDK trait 而非 raw RxJS observable；internal implementation 可以直接用 RxJS 组合。

token-set client 只有一个 in-memory auth snapshot authority。`start()` 是 initial lifecycle entry；如果 client 由 registry 构造，则 registry 负责 readiness。选择 package 或 subpath 前请阅读 [Client SDK 指南](docs/zh/007-CLIENT_SDK_GUIDE.md)。

## 首次集成

Rust server integration 可以直接添加 owning crate，或通过 curated `securitydept-core` re-export 只启用所需 feature：

```bash
cargo add securitydept-core --features session-context
```

对于 browser Basic Auth boundary，安装 foundation 和 context client，构造显式 browser environment，再使用 public factory，而不是直接调用 constructor：

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

environment creator 是 browser composition root。framework application 应在此处组合 framework environment 或 injector，而不是让 client 在稍后自行发现 browser global。

## Reference Runtime

reference server 挂载 session、Basic Auth、token-set backend OIDC、token-set frontend configuration projection、management、propagation 和 health route family。React WebUI 是同一 SDK contract 的 executable host。

本地运行已发布 runtime：

```bash
wget -O config.toml https://raw.githubusercontent.com/ethaxon/securitydept/main/config.example.toml
wget -O docker-compose.yml https://raw.githubusercontent.com/ethaxon/securitydept/main/docker-compose.yml
docker compose up -d
```

默认服务地址是 `http://localhost:7021`。实际启用的 route 与 provider setting 以配置文件为准。

## 开发

使用声明的 toolchain：

```bash
mise install
pnpm install
just setup-docs
```

常用命令：

```bash
just dev-server
just dev-webui
just lint
just test-all
just build-docs
```

`just build-docs` 独立验证 VitePress site。源文档位于 `docs/en` 与 `docs/zh`；`docsite/` 通过 symlink 渲染它们。

## 文档

- [概览](docs/zh/000-OVERVIEW.md)
- [架构](docs/zh/001-ARCHITECTURE.md)
- [能力矩阵](docs/zh/002-FEATURES.md)
- [Client SDK 指南](docs/zh/007-CLIENT_SDK_GUIDE.md)
- [发布自动化](docs/zh/008-RELEASE_AUTOMATION.md)
- [TS SDK 迁移记录](docs/zh/110-TS_SDK_MIGRATIONS.md)
- [CHANGELOG](CHANGELOG.md)

## 许可证

[MIT](LICENSE.md)

---

[English](README.md) | [中文](README_zh.md)
