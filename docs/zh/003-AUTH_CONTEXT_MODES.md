# 认证上下文模式

本文档描述了应构建在底层 crate 之上的高级别认证上下文模式。

## 为什么存在这一层

当前底层已经分离：

- 令牌获取（`securitydept-oidc-client`）
- bearer 验证（`securitydept-oauth-resource-server`）
- 凭证原语（`securitydept-creds`）

仍然缺失的是一个可复用层，用于回答面向应用的问题，例如：

- 当前认证用户是谁？
- 该身份来自哪里？
- 前端应如何保持认证状态？
- 节点应如何向另一个节点转发凭证？

这就是认证上下文模式的作用。

## 模式 A：基础认证区域

适用于：

- 最简单的浏览器原生认证入口
- 受限环境
- 用户可以容忍浏览器基础认证提示的场景

预期属性：

- challenge 区域隔离
- challenge 触发端点
- 通过凭证中毒（credential-poisoning）变通方法实现注销
- 可选的小型 TypeScript 助手用于重定向到 challenge URL

该模式应组合：

- `securitydept-creds`
- `securitydept-creds-manage`
- 可选的服务器路由助手

## 模式 B：Cookie-Session

适用于：

- 集中式服务
- 弱前端能力
- BFF 类应用

预期属性：

- OIDC 登录和回调由后端处理
- 后端存储或管理认证上下文
- 浏览器主要携带 HTTP-only 会话 cookie
- `me` 端点返回规范化的主体数据

该模式应组合：

- `securitydept-oidc-client`
- `securitydept-session-context` —— 提供 `SessionContext<T>`、`SessionPrincipal`、`SessionContextConfig` 和会话句柄操作
- `tower-sessions-*` 生态中的可选后端 session store
- 可选的 TS 助手用于重定向登录 UX

当前仓库状态：

- 参考实现存在于 `apps/server`
- 可复用提取现已存在于 `securitydept-session-context`

## 模式 C：无状态 Token-Set

适用于：

- 强前端能力
- 分布式 SPA 应用
- 多提供者环境
- 无法依赖服务器端浏览器会话存储的网格状用户面对节点

目标状态表示：

- token 核心信息通过 fragment 传递：
  - `access_token`
  - `id_token`
  - `refresh_token`
  - `expires_at`
- 非 token metadata 通过短期兑换句柄传递：
  - `metadata_redemption_id`

约定：

- 对外字段名使用通用的 `refresh_token`
- 内部 Rust 字段名使用 `refresh_material` 以强调它可能是经过保护的刷新材料，而不一定是可直接提交给 OIDC provider 的原始 refresh token
- `redirect_uri` 由 `token-set-context` 统一解析；当前配置类型为：
  - `TokenSetRedirectUriConfig`
  - `TokenSetRedirectUriRule`
- 当前主状态模型为：
  - `AuthStateSnapshot`
  - `AuthStateDelta`
- refresh 之后，`AuthenticationSource.kind` 应切换为 `refresh_token`，并在 `source_kind_history` 中记录来源类型历史
- 状态模型当前已拆为：
  - `AuthTokenSnapshot`
  - `AuthTokenDelta`
  - `AuthStateMetadataSnapshot`
  - `AuthStateMetadataDelta`
  - `AuthStateSnapshot`
  - `AuthStateDelta`
  - `PendingAuthStateMetadataRedemption`

预期前端能力：

- 管理多个提供者/来源的 token-set
- 自动附加 `Authorization` 头
- 后台刷新
- 需要时重定向到授权端点
- 从令牌材料派生显示身份
- 处理 callback 的完整 snapshot
- 处理 refresh 的 token delta 与 metadata delta
- 在 metadata delta 获取失败时回退到已有 metadata

预期后端能力：

- 作为资源服务器时验证转发的 bearer 令牌
- 可选地通过共享提供者运行时刷新发现元数据和 JWKS
- 保持 bearer 传播策略明确
- 通过 `token-set-context` 内的协调层完成 refresh material 解封、令牌刷新、状态重建与返回 DTO 生成
- 提供短期 metadata redemption 存储与兑换能力
- callback 阶段通过 `oidc-client` 的 pending OAuth extra data 回传最终 `redirect_uri`

失败语义：

- callback：token snapshot 与 metadata snapshot 都不允许失败
- refresh：token delta 不允许失败；metadata delta 允许失败，失败时视为“空 delta”

当前实现状态：

- `apps/server` 已接入：
  - `GET /auth/login/token-set`
  - `GET /auth/callback/token-set`
  - `POST /auth/refresh`
  - `POST /auth/metadata/redeem`
- callback 当前返回完整 token snapshot fragment，并签发 `metadata_redemption_id`
- refresh 当前返回 token delta fragment，并在 metadata 有变化时签发 `metadata_redemption_id`
- refresh 请求体当前使用：
  - `current_auth_state`
- metadata redemption 默认实现当前为 `MokaPendingAuthStateMetadataRedemptionStore`

重要说明：

此模式并不意味着 `oidc-client` 变成资源服务器。相反，`oidc-client` 和 `oauth-resource-server` 都应为一个共享的认证主体抽象提供支持。

## 共享的未来抽象

未来的可复用认证上下文层可能应定义或已经开始具备：

- `AuthenticatedPrincipal`
- `SealedRefreshMaterial`
- `AuthenticationSource`
- `BearerPropagationPolicy`
- `TokenPropagator`
- `AuthTokenSnapshot`
- `AuthTokenDelta`
- `AuthStateMetadataSnapshot`
- `AuthStateMetadataDelta`
- `AuthStateSnapshot`
- `AuthStateDelta`
- `PendingAuthStateMetadataRedemption`

## Bearer 传播策略

对于网格状部署，仅当下游节点接受相同的发行者和受众契约时，转发原始 bearer 令牌才是有效的。

未来的策略抽象应至少区分：

- 透明转发
- 验证后转发
- 为下游令牌交换

第三个选项是未来的工作，但它应该已经存在于项目的设计语言中。

---

[English](../en/003-AUTH_CONTEXT_MODES.md) | [中文](003-AUTH_CONTEXT_MODES.md)
