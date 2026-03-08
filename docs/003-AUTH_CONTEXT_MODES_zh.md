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
- `securitydept-creds-manage` 或未来的专用会话上下文层
- 可选的 TS 助手用于重定向登录 UX

当前仓库状态：

- 参考实现存在于 `apps/server`
- 可复用提取仍在进行中

## 模式 C：无状态 Token-Set

适用于：

- 强前端能力
- 分布式 SPA 应用
- 多提供者环境
- 无法依赖服务器端浏览器会话存储的网格状用户面对节点

目标状态表示：

- `id_token`
- `access_token`
- `sealed_refresh_token`

预期前端能力：

- 管理多个提供者/来源的 token-set
- 自动附加 `Authorization` 头
- 后台刷新
- 需要时重定向到授权端点
- 从令牌材料派生显示身份

预期后端能力：

- 作为资源服务器时验证转发的 bearer 令牌
- 可选地通过共享提供者运行时刷新发现元数据和 JWKS
- 保持 bearer 传播策略明确

重要说明：

此模式并不意味着 `oidc-client` 变成资源服务器。相反，`oidc-client` 和 `oauth-resource-server` 都应为一个共享的认证主体抽象提供支持。

## 共享的未来抽象

未来的可复用认证上下文层可能应定义：

- `AuthenticatedPrincipal`
- `ManagedTokenSet`
- `SealedRefreshMaterial`
- `AuthenticationSource`
- `BearerPropagationPolicy`

## Bearer 传播策略

对于网格状部署，仅当下游节点接受相同的发行者和受众契约时，转发原始 bearer 令牌才是有效的。

未来的策略抽象应至少区分：

- 透明转发
- 验证后转发
- 为下游令牌交换

第三个选项是未来的工作，但它应该已经存在于项目的设计语言中。

---

[English Version](003-AUTH_CONTEXT_MODES.md) | [中文版本](003-AUTH_CONTEXT_MODES_zh.md)
