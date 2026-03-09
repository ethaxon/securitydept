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
- 最简单场景下的基础认证（basic-auth）区域流程
- 有状态的 cookie-session 认证上下文
- 无状态的 token-set 认证上下文（适用于分布式 SPA 和代理场景）
- 基础认证和静态令牌的本机凭证管理
- 验证组合栈的参考服务器应用

当前仓库已包含底层的大部分功能和一个可用的参考服务器。更高级别的认证上下文模式正在进行文档化，以便后续实现遵循一致的设计。

## 工作区 Crates

- `securitydept-creds`
  - 用于基础认证、静态令牌、JWT、JWE 和 RFC 9068 访问令牌的底层验证原语
- `securitydept-basic-auth-zone`
  - 可复用的 basic-auth challenge-zone 配置与响应辅助
- `securitydept-session-context`
  - 基于 tower-sessions 的可复用 cookie-session 认证上下文辅助
- `securitydept-oauth-provider`
  - 共享提供者运行时，支持发现元数据、JWKS 和内省（introspection），带有缓存和刷新
- `securitydept-oidc-client`
  - OIDC 客户端/依赖方（relying-party）流程、回调处理、刷新、声明规范化
- `securitydept-oauth-resource-server`
  - 用于 JWT、JWE 和不透明令牌内省的 bearer 访问令牌验证
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

1. 基础认证区域模式（basic auth zone mode）
2. Cookie-session 模式
3. 无状态的 `id_token + access_token + sealed_refresh_token` 模式

这些模式有意设计在当前的 `oidc-client` 和 `oauth-resource-server` crate 之上。它们应该组合底层功能，而不是将职责合并到单个 crate 中。

## 状态快照

- 已实现或大体实现
  - 底层 creds 验证
  - OIDC 客户端流程
  - OAuth 提供者运行时
  - OAuth 资源服务器验证器
  - 用于基础认证和静态令牌的 creds-manage
  - 带有 cookie-session 流程的参考服务器应用
- 计划中/部分已规范
  - 基础认证区域模式作为一等认证上下文模式
  - 无状态 token-set 认证上下文模式
  - 用于认证上下文模式的前端 TypeScript SDK
  - 网格感知的 bearer 传播和 token-set 管理

## 文档

| 文档 | 重点 |
| --- | --- |
| [docs/zh/000-OVERVIEW.md](docs/zh/000-OVERVIEW.md) | 项目目标、层次结构和文档索引 |
| [docs/zh/001-ARCHITECTURE.md](docs/zh/001-ARCHITECTURE.md) | 分层架构和 crate 边界 |
| [docs/zh/002-FEATURES.md](docs/zh/002-FEATURES.md) | 能力矩阵：已实现 vs 计划中 |
| [docs/zh/003-AUTH_CONTEXT_MODES.md](docs/zh/003-AUTH_CONTEXT_MODES.md) | 基础区域、cookie-session 和无状态 token-set 模式 |
| [docs/zh/004-BASIC_AUTH_ZONE.md](docs/zh/004-BASIC_AUTH_ZONE.md) | 基础认证区域的 UX 和协议说明 |
| [docs/zh/100-ROADMAP.md](docs/zh/100-ROADMAP.md) | 与当前目标对齐的序列路线图 |

## 开发

```bash
cp config.toml.example config.toml
just dev-server
just dev-webui
```

## 许可证

[MIT](LICENSE.md)

---

[English](README.md) | [中文](README_zh.md)
