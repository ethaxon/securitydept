# 架构

本文档描述了在最近的提供者、OIDC 客户端和资源服务器拆分之后的预期分层架构。

## 第 1 层：验证原语

Crate: `securitydept-creds`

职责：

- 基础认证（Basic Auth）解析和验证
- 静态令牌解析和验证
- JWT 验证助手
- JWE 解密助手
- RFC 9068 访问令牌验证
- 共享凭证和验证器 trait

该层不应了解：

- OIDC 登录重定向
- OAuth 授权码流程
- 浏览器状态
- 应用会话

## 第 2 层：远程提供者运行时

Crate: `securitydept-oauth-provider`

职责：

- OIDC 发现元数据获取和刷新
- 远程 JWKS 获取和刷新
- 共享 HTTP 客户端和连接复用
- 内省（introspection）端点访问
- 提供者配置规范化

该层由 OIDC 客户端和资源服务器验证器共享。

## 第 3 层：OIDC 客户端

Crate: `securitydept-oidc-client`

职责：

- 授权码流程
- PKCE 支持
- 回调交换
- 刷新流程
- 声明规范化和可选声明脚本
- 配置时获取 userinfo

该 crate 获取身份和令牌材料。它不验证呈现给任意 API 的 bearer 令牌。

## 第 4 层：OAuth 资源服务器

Crate: `securitydept-oauth-resource-server`

职责：

- 验证呈现给 API 的 bearer 访问令牌
- 支持 JWT、JWE 和不透明令牌内省
- 应用发行者、受众、范围和时间验证策略
- 管理本地 JWE 解密密钥和密钥轮换监视器

该 crate 验证 bearer 令牌。它不执行浏览器登录或授权码重定向流程。

## 第 5 层：认证上下文模式

计划在 1-4 层之上构建的更高级别组合：

- 基础认证区域模式
- cookie-session 模式
- 无状态 token-set 模式

这些模式是部署契约。无论身份来自以下方式，它们都应公开规范化的主体数据：

- OIDC 回调结果
- bearer 访问令牌验证
- 本地基础认证凭证
- 静态令牌凭证

未来的共享抽象可能应将所有这些规范化为通用的认证主体模型。

当前的专用 crate：

- `securitydept-basic-auth-context`
- `securitydept-session-context` —— 为 cookie-session 模式提取的可复用会话上下文抽象，包含 post-auth redirect 策略，且不再直接暴露 Axum 响应类型
- `securitydept-token-set-context` —— 为无状态 token-set 模式提取的可复用认证状态、redirect、metadata redemption 与 bearer propagation 协调层
- `securitydept-auth-runtime` —— 为 session、token-set 与 basic-auth 模式提取的面向路由的认证编排层，并为每种模式提供独立 feature gate

`securitydept-session-context` crate 提供：

- `SessionContext<T>` —— 带有主体、属性和可选额外数据的通用会话上下文
- `SessionPrincipal` —— 规范化的主体，包含显示名称、头像和声明
- `SessionContextConfig` —— 会话 cookie 和安全配置
- `SessionContextSession` —— 用于 insert/get/require/clear 操作的会话句柄

`securitydept-token-set-context` crate 当前提供：

- `AuthTokenSnapshot` / `AuthTokenDelta`
- `AuthStateMetadataSnapshot` / `AuthStateMetadataDelta`
- `AuthStateSnapshot` / `AuthStateDelta`
- `TokenPropagator`
- `PropagatedBearer`
- `TokenSetRedirectUriConfig`
- `DefaultTokenSetContext`
- `DefaultTokenSetContextConfig`
- `DefaultPendingAuthStateMetadataRedemptionStore`

当前的重要边界：

- `AuthStateMetadataSnapshot` 只承载认证侧 metadata，例如 `AuthenticatedPrincipal`
- 用于资源授权与 bearer propagation 的 access-token 事实单独建模为 `ResourceTokenPrincipal`
- `TokenPropagator` 现在校验的是 `PropagatedBearer` 与目标上下文，而不是整份 auth-state snapshot
- 仅有 `node_id` 的 propagation target 通过可选的 `PropagationNodeTargetResolver` 解析
- 真正的请求转发与核心 propagation 策略保持分离，但 `securitydept-token-set-context` 现已在 `TokenPropagator` 之上提供可选的 `axum-reverse-proxy-propagation-forwarder` feature

cookie-session 和无状态 token-set 的路由层编排位于 `securitydept-auth-runtime`：

- `SessionAuthServiceTrait`
- `OidcSessionAuthService`
- `DevSessionAuthService`
- `TokenSetAuthService`
- `BasicAuthContextService`
- `TokenSetResourceService`

当前边界说明：

- `securitydept-basic-auth-context` 与 `securitydept-auth-runtime` 现在返回与框架无关的 HTTP 响应元数据，而不是 Axum 响应类型
- Axum 专属的响应组装保留在 `apps/server`

## 第 6 层：Real IP 解析

Crate: `securitydept-realip`

职责：

- 建模 trusted peer CIDR provider
- 在多层 CDN 和反向代理链路中解析有效客户端 IP
- 对 transport 元数据和 forwarded 头应用 source-specific trust 规则
- 管理 trusted peer 列表的刷新与 watch 行为

该 crate 关注带信任边界语义的客户端 IP 解析，不负责 URL 重建、rate limiting 或流量过滤策略。

## 第 7 层：凭证管理

Crate: `securitydept-creds-manage`

职责：

- 管理本地基础认证凭证
- 管理本地静态令牌
- 为简单的操作员管理凭证提供存储和同步原语
- 支持注册表登录管理和基础网关认证等场景
- 通过 `ArcSwap` 快照发布实现无锁读取
- 原子文件写入（临时文件 → fsync → rename）防止损坏
- 基于 `notify-debouncer-full` 的去抖文件系统监听，自动回退到轮询
- 基于内容哈希的自写检测，避免递归重载

该 crate 是操作存储，而非令牌验证核心。

## 第 8 层：参考应用

Apps:

- `apps/server`
- `apps/cli`
- `apps/webui`

`apps/server` 应保持为组合能力的试验场：

- 底层验证
- basic-auth context 模式
- cookie-session 模式
- 无状态 token-set 模式
- creds-manage 集成
- 带 real-IP 约束的 dashboard 访问控制

它不是项目的架构边界。

## 重要的边界规则

- `oidc-client` 不得吸收资源服务器验证
- `oauth-resource-server` 不得吸收浏览器登录流程
- 提供者缓存/发现必须位于两者之下
- real-IP trust resolution 应位于应用层之下，不应在每个 server 中以临时逻辑重复实现
- 认证上下文模式应组合底层 crate，而不是复制其逻辑
- bearer 令牌转发应明确建模，不应隐藏在登录 API 中

## 面向网格的场景指南

对于虚拟 LAN 内的分布式节点：

- 面向用户的节点可能运行 OIDC 客户端逻辑
- 同一节点也可能验证或透明转发 bearer 令牌
- 内部节点可能只运行资源服务器验证
- 无状态操作意味着没有服务器端浏览器会话存储，而不是令牌语义的缺失

透明转发仅当下游节点接受相同的发行者和受众契约时才是正确的。如果受众不同，未来设计必须引入令牌交换，而不是简单转发。

---

[English](../en/001-ARCHITECTURE.md) | [中文](001-ARCHITECTURE.md)
