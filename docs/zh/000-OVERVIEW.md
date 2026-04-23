# SecurityDept 概览

SecurityDept 是一个分层的认证和授权项目，旨在实现三个相关目标：

1. 可复用的 Rust crate，用于身份、令牌验证和凭证验证
2. 面向 browser、React、Angular 与 server-host adopter 的 TypeScript SDK family
3. 参考应用，用于在真实部署场景中验证这些 crate 与 SDK

## 项目方向

长期方向不是单一的单体认证服务。相反，SecurityDept 被塑造成一个栈，可以支持集中式和分布式部署：

- 带有服务器端会话的集中式服务
- 简单的浏览器原生基础认证（Basic Auth）流程
- 直接管理 token-set 的分布式 SPA 应用
- 在可信网络边界内，网格状节点间的无状态 bearer 令牌转发

这需要对以下内容进行清晰分离：

- 凭证验证原语
- OIDC 客户端逻辑
- OAuth 资源服务器逻辑
- 构建在底层之上的认证上下文模式
- 本地凭证管理
- 参考应用

## 当前层次

- `securitydept-creds`
  - 底层凭证和令牌验证原语
- `securitydept-oauth-provider`
  - 共享的远程提供者连接和缓存运行时
- `securitydept-oidc-client`
  - OIDC 依赖方（relying-party）客户端行为
- `securitydept-basic-auth-context`
  - 可复用的 basic-auth zone 与 redirect 抽象，并提供与框架无关的响应元数据；`BasicAuthContextService` 现已直接归属于此 crate
- `securitydept-session-context`
  - 可复用的 session 上下文抽象，供 cookie-session 模式使用，且不再直接耦合 Axum；`SessionAuthServiceTrait`、`OidcSessionAuthService`、`DevSessionAuthService` 现已通过 `service` feature 直接归属于此 crate
- `securitydept-token-set-context`
  - 可复用的认证状态、redirect、metadata fallback 与 token 传播层，供无状态 token-set 模式使用
- `securitydept-oauth-resource-server`
  - bearer 令牌验证行为
- `securitydept-realip`
  - 面向 trusted-proxy/provider 的客户端 IP 解析
- `securitydept-creds-manage`
  - 本地基础认证和静态令牌管理
- `securitydept-server`
  - 参考应用，将支持的认证上下文模式与本地凭证场景串联起来

当前更准确的理解是：

- `securitydept-basic-auth-context`、`securitydept-session-context`、`securitydept-token-set-context` 是长期 auth-context 产品面
- route-facing service 已全部回到各自 owning crate：`BasicAuthContextService` 归属 `securitydept-basic-auth-context`，session service 归属 `securitydept-session-context`（`service` feature），`BackendOidcMediatedModeAuthService` 与 `AccessTokenSubstrateResourceService` 归属 `securitydept-token-set-context`
- `securitydept-auth-runtime` 聚合层已解散，不再作为工作区 member 存在

## 目标认证上下文模式

SecurityDept 应在底层 crate 之上提供三种明确的认证上下文模式：

1. 基础认证区域模式（basic auth zone mode）
2. Cookie-session 模式
3. 无状态 token-set 模式（token snapshot/deltametadata snapshot/delta）

这些模式是面向部署的组合，而不是 `oidc-client` 或 `oauth-resource-server` 的替代品。

## 设计原则

- 偏好组合而非一个巨大的全能认证 crate
- 保持令牌获取和令牌验证分离
- 明确建模无状态和有状态认证上下文模式
- 支持后端优先和前端强化的部署
- 保持服务器应用作为试验场，而非产品边界
- 在可以把边界留给参考应用时，尽量保持可复用 crate 的框架中立

## TypeScript SDK 当前状态与进入路径

TypeScript client SDK 现在已经是仓库中的可用组成部分，而不再只是未来设计议题。当前 release-preparation 目标是 `0.2.0-beta.1`，重点是 packaging、docs reality、release matrices、Docker readiness 与 static docs site。

当前阶段的重点也已经变化：

- 不是“SDK 是否存在”，而是“哪些 contract 已经可以按当前 0.x 对外解释”
- 根导出、adapter、reference app glue 的边界应优先以 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) 为准
- token-set 当前应按 browser-owned v1 baseline 理解，而不是把 mixed-custody / BFF / server-side token-set 一并读进当前范围

当前更直接的进入方式是：

- 先看 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)，理解包边界、能力归属、稳定性口径与最小接入片段
- 再看 `sdks/ts/packages/*`，确认 foundation、`./web` 导出、React / Angular 等 framework adapter，以及 `@securitydept/client` 的 `./web-router` 等 subpath 的真实导出
- 再看 `apps/webui/src/routes/TokenSet.tsx` 与 `apps/webui/src/routes/tokenSet/*`，把它们作为 lifecycle、trace 与 propagation dogfooding 的主 reference route
- 将 `apps/webui/src/api/*` 继续视为 reference app glue，而不是默认 SDK surface

## 文档索引

- [001-ARCHITECTURE.md](001-ARCHITECTURE.md) - 架构和 crate 边界
- [002-FEATURES.md](002-FEATURES.md) - 能力矩阵
- [005-ERROR_SYSTEM_DESIGN.md](005-ERROR_SYSTEM_DESIGN.md) - 错误系统设计
- [006-REALIP.md](006-REALIP.md) - 多层代理与多 provider 场景下的 real-IP 策略
- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) - 客户端 SDK 正式架构、包边界、foundation 协议与实现指南
- [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md) - 统一的认证上下文、basic-auth zone 与 token-set mode 设计
- [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md) - SDK Angular/token-set 路径的真实下游 adopter calibration case
- [100-ROADMAP.md](100-ROADMAP.md) - 当前 release blockers、`0.2.x` 主线与 `0.3.0` deferrals
- [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) - TypeScript SDK public-surface migration ledger

---

[English](../en/000-OVERVIEW.md) | [中文](000-OVERVIEW.md)
