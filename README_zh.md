<h1 align="center">
  <img src="./assets/icons/icon.png" alt="logo" height=180/>
  <br />
  <b>SecurityDept</b>
</h1>

SecurityDept 是一个面向网格（mesh-oriented）的认证和授权工具包，由可复用的 Rust crate 和一个参考服务器应用组成。

本项目正从单一的 "OIDC 登录 + 本地会话" 产品演进为一个分层的库栈，支持以下功能：

- 底层凭证验证原语
- OIDC 客户端流程
- OAuth 资源服务器验证
- 最简单场景下的基础认证（basic-auth）上下文流程
- 有状态的 cookie-session 认证上下文
- 无状态的 token-set 认证上下文（适用于分布式 SPA 和代理场景）
- 基础认证和静态令牌的本机凭证管理
- 验证组合栈的参考服务器应用

当前仓库已包含底层的大部分功能和一个可用的参考服务器。更高级别的认证上下文模式正在进行文档化，以便后续实现遵循一致的设计。

参考服务器仍然使用 Axum，但可复用的 `securitydept-basic-auth-context`、`securitydept-session-context` 与 `securitydept-auth-runtime` crate 现在已经把 Axum 专属的响应组装留在边界层之外，以便更容易复用到其他生态中。

## 工作区 Crates

- `securitydept-creds`
  - 用于基础认证、静态令牌、JWT、JWE 和 RFC 9068 访问令牌的底层验证原语
- `securitydept-basic-auth-context`
  - 可复用的 basic-auth 上下文、zone、post-auth redirect 与 real-IP 访问策略辅助，并提供与框架无关的 HTTP 响应元数据
- `securitydept-session-context`
  - 基于 tower-sessions 的可复用 cookie-session 认证上下文辅助，包含 post-auth redirect，且不再直接耦合 Axum
- `securitydept-auth-runtime`
  - 面向参考服务器的 session、token-set 与 basic-auth 路由级认证编排，并按 `basic-auth-context`、`session-context`、`token-set-context` 三个 feature 独立控制
- `securitydept-oauth-provider`
  - 共享提供者运行时，支持发现元数据、JWKS 和内省（introspection），带有缓存和刷新
- `securitydept-oidc-client`
  - OIDC 客户端/依赖方（relying-party）流程、回调处理、刷新、声明规范化
- `securitydept-oauth-resource-server`
  - 用于 JWT、JWE 和不透明令牌内省的 bearer 访问令牌验证
- `securitydept-token-set-context`
  - 可复用的 token-set 认证状态、redirect、metadata redemption 与 token 传播辅助；资源态 token facts 不进入认证 metadata，且 node-aware propagation 可使用可选的运行时 resolver
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
  - real-IP 解析，以及 basic-auth context 的可选 real-IP 访问策略
  - 由服务端持有的 bearer propagation 校验，包括目标 allowlist 与 access-token 资源事实校验
- 计划中/部分已规范
  - 更丰富的多 zone basic-auth context 组合
  - 按正式 client SDK 指南落地 TypeScript 客户端 SDK
  - token-set 模式在浏览器侧的合并、持久化、刷新与 mixed-custody 行为
  - 构建在 `TokenPropagator` 之上的推荐 propagation forwarder feature

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
| [docs/zh/003-AUTH_CONTEXT_MODES.md](docs/zh/003-AUTH_CONTEXT_MODES.md) | 基础区域、cookie-session 和无状态 token-set 模式 |
| [docs/zh/004-BASIC_AUTH_ZONE.md](docs/zh/004-BASIC_AUTH_ZONE.md) | 基础认证区域的 UX 和协议说明 |
| [docs/zh/005-ERROR_SYSTEM_DESIGN.md](docs/zh/005-ERROR_SYSTEM_DESIGN.md) | 对外安全错误响应、内部诊断与恢复动作设计 |
| [docs/zh/006-REALIP.md](docs/zh/006-REALIP.md) | 多层代理与多 CDN/provider 部署下的 trusted-peer real-IP 策略 |
| [docs/zh/007-CLIENT_SDK_GUIDE.md](docs/zh/007-CLIENT_SDK_GUIDE.md) | 客户端 SDK 正式架构：包布局、foundation 协议、适配层、运行时边界与实现约束 |
| [docs/zh/100-ROADMAP.md](docs/zh/100-ROADMAP.md) | 与当前目标对齐的序列路线图 |

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
