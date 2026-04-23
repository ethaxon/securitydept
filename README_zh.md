<h1 align="center">
  <img src="./assets/icons/icon.png" alt="logo" height=180/>
  <br />
  <b>SecurityDept</b>
</h1>

SecurityDept 是一个面向网格（mesh-oriented）的认证和授权工具包，由可复用的 Rust crate、一个 TypeScript client SDK workspace，以及参考 server/web 应用组成。

本项目正从单一的 "OIDC 登录 + 本地会话" 产品演进为一个分层的库栈，支持以下功能：

- 底层凭证验证原语
- OIDC 客户端流程
- OAuth 资源服务器验证
- 最简单场景下的基础认证（basic-auth）上下文流程
- 有状态的 cookie-session 认证上下文
- 无状态的 token-set 认证上下文（适用于分布式 SPA 和代理场景）
- 基础认证和静态令牌的本机凭证管理
- 验证组合栈的参考服务器应用

当前仓库已包含底层的大部分功能、一个可用的参考服务器，以及位于 `sdks/ts` 下的可用 TypeScript SDK workspace。更高级别的认证上下文模式不再只是设计说明，而是已经通过 reference app、真实下游 `outposts` calibration case 与正式 client SDK 指南进入了真实 dogfooding。当前 release-preparation 目标是 `0.2.0-beta.1`；这属于 packaging / documentation readiness 工作，不是新的 auth capability 线。

参考服务器仍然使用 Axum，但可复用的 `securitydept-basic-auth-context`、`securitydept-session-context` 与 `securitydept-token-set-context` crate 已经把 Axum 专属的响应组装留在边界层之外，以便更容易复用到其他生态中。route-facing service 已全部回到各自的 owning crate，`securitydept-auth-runtime` 聚合层不再存在。

## 工作区 Crates

- `securitydept-creds`
  - 用于基础认证、静态令牌、JWT、JWE 和 RFC 9068 访问令牌的底层验证原语
- `securitydept-basic-auth-context`
  - 可复用的 basic-auth 上下文、zone、post-auth redirect 与 real-IP 访问策略辅助，并提供与框架无关的 HTTP 响应元数据
- `securitydept-session-context`
  - 基于 tower-sessions 的可复用 cookie-session 认证上下文辅助，包含 post-auth redirect，且不再直接耦合 Axum；`SessionAuthServiceTrait`、`OidcSessionAuthService`、`DevSessionAuthService` 均已通过 `service` feature 直接归属于此 crate
- `securitydept-oauth-provider`
  - 共享提供者运行时，支持发现元数据、JWKS 和内省（introspection），带有缓存和刷新
- `securitydept-oidc-client`
  - OIDC 客户端/依赖方（relying-party）流程、回调处理、刷新、声明规范化
- `securitydept-oauth-resource-server`
  - 用于 JWT、JWE 和不透明令牌内省的 bearer 访问令牌验证
- `securitydept-token-set-context`
  - 可复用的 token-set 认证状态、redirect、metadata redemption、access-token substrate 以及单一的 `backend_oidc_mode` capability framework，其中 pure / mediated 被实现为 preset/profile
- `securitydept-realip`
  - 面向多层 CDN 与反向代理部署的 trusted-proxy/provider 感知客户端 IP 解析
- `securitydept-creds-manage`
  - 用于简单凭证（如基础认证和静态令牌）的本地管理
- `securitydept-core`
  - 面向下游应用的对齐 re-exports
- `securitydept-server`
  - 用于验证组合行为的参考 Axum 服务器
- `securitydept-cli`
  - 用于本地凭证管理的参考 CLI

## 计划中的认证上下文模式

SecurityDept 最终应支持三种顶层认证上下文模式：

1. 基础认证上下文模式（basic auth context mode）
2. Cookie-session 模式
3. 无状态 token-set 模式

这些模式有意设计在当前的 `oidc-client` 和 `oauth-resource-server` crate 之上。它们应该组合底层功能，而不是将职责合并到单个 crate 中。

## 状态快照

- 已实现或大体实现
  - 底层 creds 验证
  - OIDC 客户端流程
  - OAuth 提供者运行时
  - OAuth 资源服务器验证器
  - 用于基础认证和静态令牌的 creds-manage
  - 带有 cookie-session、basic-auth 上下文和无状态 token-set 流程的参考服务器应用
  - 位于 `sdks/ts/packages/*` 的 TypeScript SDK foundation 包、browser adapter、React / Angular framework packages，以及 `@securitydept/client` subpaths（包括 `web-router`）
  - `apps/webui` 上覆盖 session/token-set lifecycle、protected API、trace timeline 与 propagation smoke 的 reference route dogfooding
  - real-IP 解析，以及 basic-auth context 的可选 real-IP 访问策略
  - 由服务端持有的 bearer propagation 校验，包括目标 allowlist 与 access-token 资源事实校验
- 计划中/部分已规范
  - 更丰富的多 zone basic-auth context 组合
  - token-set 模式在浏览器侧的合并、持久化、刷新与 mixed-custody 行为
  - 构建在 `AccessTokenSubstrateRuntime` / `TokenPropagator` 之上的推荐 propagation forwarder feature，并通过正式的 `ConfigSource + Forwarder` trait 边界接入
  - mixed-custody、BFF、server-side token ownership 等更高复杂度 token-set 形态

## TypeScript SDK 入口

当前仓库已经包含可工作的 TypeScript SDK workspace，不再只是架构草案。

最自然的进入路径是：

- 先看 [docs/zh/007-CLIENT_SDK_GUIDE.md](docs/zh/007-CLIENT_SDK_GUIDE.md) ([English](docs/en/007-CLIENT_SDK_GUIDE.md))，理解包边界、稳定性口径、能力归属和最小接入片段
- 再看 `sdks/ts/packages/*`，确认 foundation、`./web` 与 React subpath 的真实导出
- 再看 `apps/webui/src/routes/TokenSet.tsx` 与 `apps/webui/src/routes/tokenSet/*`，把它们作为解释 lifecycle、trace 与 propagation 边界的 reference app
- 将 `apps/webui/src/api/*` 继续视为 reference app glue，而不是推荐的 SDK public API

计划中的静态文档站将在独立 VitePress / GitHub Pages pipeline 部署后通过 `https://securitydept.ethaxon.com/` 提供。在此之前，`docs/zh` 与 `docs/en` 下的 source docs 仍是权威入口。

## 参考服务器认证入口

当前参考服务器提供两种 dashboard 管理入口：

- `/api/*`
  - 如果存在 `Authorization: Bearer ...`，优先尝试通过 `oauth-resource-server` 校验 bearer access token
  - 否则回退到 cookie session
  - 最后回退到受 `basic-auth-context` 与可选 real-IP 策略约束的配置型 basic-auth
  - 如果带有 `X-SecurityDept-Propagation`，则 `/api/*` 强制要求 bearer access-token 认证，cookie/basic 会返回“认证方式不匹配”
  - 该 header 的值使用类似 `Forwarded` 的参数格式，例如 `by=dashboard;for=node-a;host=service.internal.example.com:443;proto=https`
  - bearer 认证成功后，请求运行时上下文会保留 access-token 导出的资源事实，供后续 propagation-aware handler 使用
- `/basic/*`
  - 参考服务器 dashboard 专用的 basic-auth zone
  - `/basic/api/*` 是 dashboard 管理 API 的 basic-auth 别名入口
  - 如果带有 `X-SecurityDept-Propagation`，basic-auth 路由会直接返回“认证方式不匹配”

这套管理员 basic-auth 与 `creds-manage` 中被管理的 basic-auth 账号是分离的。`creds-manage` 中的 basic-auth 凭证是供 downstream / forward-auth 等业务场景使用的数据，不是 dashboard 管理员登录账号。

## 文档

| 文档 | 重点 |
| --- | --- |
| [docs/zh/000-OVERVIEW.md](docs/zh/000-OVERVIEW.md) | 项目目标、层次结构和文档索引 |
| [docs/zh/001-ARCHITECTURE.md](docs/zh/001-ARCHITECTURE.md) | 分层架构和 crate 边界 |
| [docs/zh/002-FEATURES.md](docs/zh/002-FEATURES.md) | 能力矩阵：已实现 vs 计划中 |
| [docs/zh/005-ERROR_SYSTEM_DESIGN.md](docs/zh/005-ERROR_SYSTEM_DESIGN.md) | 对外安全错误响应、内部诊断与恢复动作设计 |
| [docs/zh/006-REALIP.md](docs/zh/006-REALIP.md) | 多层代理与多 CDN/provider 部署下的 trusted-peer real-IP 策略 |
| [docs/zh/007-CLIENT_SDK_GUIDE.md](docs/zh/007-CLIENT_SDK_GUIDE.md) | 客户端 SDK 正式架构：包布局、foundation 协议、适配层、运行时边界与实现约束 |
| [docs/zh/020-AUTH_CONTEXT_AND_MODES.md](docs/zh/020-AUTH_CONTEXT_AND_MODES.md) | 统一的认证上下文、basic-auth zone 与 token-set mode 设计 |
| [docs/zh/021-REFERENCE-APP-OUTPOSTS.md](docs/zh/021-REFERENCE-APP-OUTPOSTS.md) | SDK Angular/token-set 路径的真实下游 adopter calibration case |
| [docs/zh/100-ROADMAP.md](docs/zh/100-ROADMAP.md) | 当前 release blockers、`0.2.x` 主线与 `0.3.0` deferrals |
| [docs/zh/110-TS_SDK_MIGRATIONS.md](docs/zh/110-TS_SDK_MIGRATIONS.md) | TypeScript SDK public-surface migration ledger |

## 开发

```bash
cp config.example.toml config.toml
just dev-server
just dev-webui
```

## 许可证

[MIT](LICENSE.md)

---

[English](README.md) | [中文](README_zh.md)
