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
- post-auth redirect 目标应通过共享的 redirect-target 限制模型校验，而不是直接使用未经限制的原始重定向字符串

该模式应组合：

- `securitydept-oidc-client`
- `securitydept-session-context` —— 提供 `SessionContext<T>`、`SessionPrincipal`、`SessionContextConfig` 和会话句柄操作
- `securitydept-auth-runtime` —— 将 `oidc-client` 与 `session-context` 组合成可直接挂接路由的 session 认证服务，例如 `OidcSessionAuthService` 与 `DevSessionAuthService`
- `tower-sessions-*` 生态中的可选后端 session store
- 可选的 TS 助手用于重定向登录 UX

当前仓库状态：

- 参考实现存在于 `apps/server`
- 可复用提取现已存在于 `securitydept-session-context`
- 路由层的 session 认证编排现已提取到 `securitydept-auth-runtime`

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
- `post_auth_redirect_uri` 由 `token-set-context` 统一解析；当前配置类型为：
  - `TokenSetRedirectUriConfig`
  - `TokenSetRedirectUriRule`
- `oidc-client` 现在为常见场景提供默认 pending OAuth store 类型别名：
  - `DefaultPendingOauthStore`
  - `DefaultPendingOauthStoreConfig`
  - `DefaultOidcClient`
  - `DefaultOidcClientConfig`
- 当前主状态模型为：
  - `AuthStateSnapshot`
  - `AuthStateDelta`
- refresh 之后，`AuthenticationSource.kind` 应切换为 `refresh_token`，并在 `kind_history` 中记录来源类型历史
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
- 由 `token-set-context` 负责 refresh material 保护、redirect URI 解析、metadata redemption、状态重建与传输 DTO 生成
- 由 `auth-runtime` 在 `token-set-context` 之上暴露可直接挂路由的 token-set 处理服务
- 提供短期 metadata redemption 存储与兑换能力
- callback 阶段通过 `oidc-client` 的 pending OAuth extra data 回传最终 `post_auth_redirect_uri`

失败语义：

- callback：token snapshot 与 metadata snapshot 都不允许失败
- refresh：token delta 不允许失败；metadata delta 允许失败，失败时视为“空 delta”

当前实现状态：

- `apps/server` 已接入：
  - `GET /auth/session/login`
  - `GET /auth/session/callback`
  - `POST /auth/session/logout`
  - `GET /auth/session/me`
  - `GET /auth/token-set/login`
  - `GET /auth/token-set/callback`
  - `POST /auth/token-set/refresh`
  - `POST /auth/token-set/metadata/redeem`
- callback 当前返回完整 token snapshot fragment，并签发 `metadata_redemption_id`
- refresh 当前返回 token delta fragment，并在 metadata 有变化时签发 `metadata_redemption_id`
- refresh 请求体当前使用：
  - 必需的 `refresh_token`
  - 可选的旧 `id_token`
  - 可选的 `current_metadata_snapshot`
- 可复用的 token-set 路由编排现已存在于 `securitydept-auth-runtime::TokenSetAuthService`
- metadata redemption 的默认实现现在包括：
  - `MokaPendingAuthStateMetadataRedemptionStore`
  - `DefaultTokenSetContext`
  - `DefaultTokenSetContextConfig`

重要说明：

此模式并不意味着 `oidc-client` 变成资源服务器。

当前代码已经明确拆分：

- `AuthenticatedPrincipal`：来自 `id_token` / `user_info` 的认证侧身份信息
- `ResourceTokenPrincipal`：来自 JWT 校验或 introspection 的 access-token 资源侧事实

## 共享的未来抽象

未来的可复用认证上下文层可能应定义或已经开始具备：

- `AuthenticatedPrincipal`
- `SealedRefreshMaterial`
- `AuthenticationSource`
- `BearerPropagationPolicy`
- `TokenPropagator`
- `PropagatedBearer`
- `AuthTokenSnapshot`
- `AuthTokenDelta`
- `AuthStateMetadataSnapshot`
- `AuthStateMetadataDelta`
- `AuthStateSnapshot`
- `AuthStateDelta`
- `PendingAuthStateMetadataRedemption`

## Bearer 传播策略

对于网格状部署，仅当下游节点接受相同的发行者和受众契约时，转发原始 bearer 令牌才是有效的。

当前的 propagation 模型完全由服务端配置决定，认证状态 metadata 已不再携带 propagation policy，也不再承载资源态 token facts。

服务端配置当前区分：

- 验证后转发
- 为下游令牌交换

直接转发依赖两类显式校验配置：

- `TokenPropagatorConfig.default_policy`
- `TokenPropagatorConfig.destination_policy`
- `TokenPropagatorConfig.token_validation`

目标 allowlist 当前支持：

- `allowed_node_ids`
- `AllowedPropagationTarget::ExactOrigin`
- `AllowedPropagationTarget::DomainSuffix`
- `AllowedPropagationTarget::DomainRegex`
- `AllowedPropagationTarget::Cidr`

token 校验当前支持：

- issuer allowlist
- audience allowlist
- 必需 scopes
- 允许的 `azp`

当前运行时边界：

- `TokenPropagator` 校验的是 `PropagatedBearer`
- `PropagatedBearer` 携带原始 bearer 字符串以及可选的 `ResourceTokenPrincipal`
- `PropagationRequestTarget` 可以直接携带 scheme/hostname/可选 port，也可以只携带 `node_id`
- 仅有 `node_id` 的 target 需要在运行时提供可选的 `PropagationNodeTargetResolver`；否则会明确校验失败
- `TokenPropagator` 暴露了运行时 `set_node_target_resolver(...)` 钩子，因此 resolver 可以在构造后安装或替换
- propagation 校验不再读取 `AuthStateSnapshot`
- 过期 / active 检查应在生成 `ResourceTokenPrincipal` 的资源服务器校验步骤中完成

当前参考服务器行为：

- 主 dashboard API（`/api/*`）可通过 `X-SecurityDept-Propagation` 进入 propagation-aware 模式
- 该 header 的值使用类似 `Forwarded` 的参数列表，例如 `by=dashboard;for=node-a;host=service.internal.example.com:443;proto=https`
- 在该模式下，服务端强制要求 bearer access-token 认证，不再回退到 cookie session 或 basic-auth
- bearer 认证成功后，资源态 token facts 会保留在请求运行时上下文里，供后续 propagation-aware handler 调用 `token-set-context` 校验

规划中的转发方向：

- `TokenPropagator` 目前仍只是策略与 header 附加组件，不是完整反向代理
- 当前规划是在 `TokenPropagator` 之上提供推荐的 forwarder feature
- 该 forwarder 应负责 `Forwarded` / `X-Forwarded-*` 等标准代理问题，而 `TokenPropagator` 继续只关注目标与 token 校验

示例：

```yaml
token_propagation:
  default_policy: validate_then_forward
  destination_policy:
    allowed_node_ids:
      - registry-mirror-a
    allowed_targets:
      - kind: exact_origin
        scheme: https
        hostname: registry-mirror.internal.example.com
        port: 443
      - kind: domain_suffix
        scheme: https
        domain_suffix: mesh.internal.example.com
        port: 443
      - kind: domain_regex
        scheme: https
        domain_regex: '^api-[a-z0-9-]+\.mesh\.internal\.example\.com$'
        port: 443
      - kind: cidr
        scheme: https
        cidr: 10.0.0.0/24
        port: 8443
    deny_sensitive_ip_literals: true
    require_explicit_port: true
  token_validation:
    required_issuers:
      - https://issuer.example.com
    allowed_audiences:
      - mesh-api
    required_scopes:
      - mesh.forward
    allowed_azp:
      - securitydept-web
```

`exchange_for_downstream_token` 仍然是未来工作，但已经保留在设计语言和配置表面中。

---

[English](../en/003-AUTH_CONTEXT_MODES.md) | [中文](003-AUTH_CONTEXT_MODES.md)
