# 能力矩阵

本文档将当前代码库与新的项目目标进行映射。

## 1. 底层 creds 验证

目标：

- 基础认证（Basic Auth）
- 静态令牌
- RFC 9068 访问令牌
- JWT 和 JWE 助手
- 可复用的验证器 trait

当前状态：

- 在 `securitydept-creds` 中已大体实现

主要代码：

- `packages/creds/src/basic.rs`
- `packages/creds/src/static_token.rs`
- `packages/creds/src/jwt.rs`
- `packages/creds/src/jwe.rs`
- `packages/creds/src/rfc9068.rs`
- `packages/creds/src/validator.rs`

## 2. 上层 OIDC 客户端

目标：

- 登录重定向
- 回调
- PKCE
- 刷新
- 声明规范化
- 可选 userinfo 和声明脚本

当前状态：

- 在 `securitydept-oidc-client` 中实现
- 现在由共享的 `securitydept-oauth-provider` 支持

主要代码：

- `packages/oidc-client/src/client.rs`
- `packages/oidc-client/src/config.rs`
- `packages/oidc-client/src/models.rs`
- `packages/oidc-client/src/pending_store/*`

## 3. 上层 OAuth 资源服务器

目标：

- 用于 API 的 bearer 令牌验证
- JWT、JWE、不透明令牌内省
- 发行者、受众、范围策略
- 共享提供者运行时复用

当前状态：

- 在 `securitydept-oauth-resource-server` 中实现
- 当前专注于验证，而非更高级别的认证上下文 UX

主要代码：

- `packages/oauth-resource-server/src/verifier/mod.rs`
- `packages/oauth-resource-server/src/verifier/introspection.rs`
- `packages/oauth-resource-server/src/verifier/jwe.rs`
- `packages/oauth-resource-server/src/config/*`

## 4. 基础认证区域模式

目标：

- 最简单的浏览器原生认证模式
- 简单的 challenge-触发流程
- 轻量客户端 helper，用于围绕认证端点处理 zone-aware 重定向

当前状态：

- 已作为 `securitydept-basic-auth-context` 实现
- 包含可复用的 zones、post-auth redirect 策略和可选的 `securitydept-realip::RealIpAccessConfig`
- 已不再直接依赖 Axum；调用方可将返回的 HTTP 响应元数据适配到自己的框架
- 已集成进参考服务器，作为 `/basic/*` dashboard 入口和 `/basic/api/*` API 别名
- 对应的客户端 helper SDK 已在 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) 中正式定稿；实现上仍应保持轻量，聚焦 zone-aware 的 `401 -> login` 重定向以及 logout URL 处理
- 客户端 helper SDK 仍待实现；它应保持轻量，聚焦 zone-aware 的 `401 -> login` 重定向以及 logout URL 处理

主要参考：

- `packages/basic-auth-context/src/lib.rs`
- [004-BASIC_AUTH_ZONE.md](004-BASIC_AUTH_ZONE.md)
- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

## 5. 有状态 cookie-session 认证上下文

目标：

- 简单的集中式部署模式
- 适用于弱前端能力
- 后期可选的 TS 助手用于重定向到登录

当前状态：

- `apps/server` 中已有参考实现
- 可复用提取现已位于 `securitydept-session-context`
- 可复用 crate 当前只依赖 `tower-sessions` 与 `http`，不再直接暴露 Axum 响应类型
- 对应的 TypeScript 客户端 helper 已在 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) 中正式定义，但尚未实现

主要参考：

- `packages/session-context/src/lib.rs`
- `apps/server/src/routes/auth/mod.rs`
- `apps/server/src/routes/auth/session.rs`
- `apps/server/src/middleware.rs`
- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

## 6. 无状态 token-set 认证上下文

目标：

- token snapshot / delta 与 metadata snapshot / delta 的组合
- 无需服务器端浏览器会话存储
- 适用于分布式 SPA 和网格状代理场景
- 后期前端 TS SDK 用于令牌存储、头注入、刷新和登录重定向

当前状态：

- 核心服务端与共享 crate 已实现
- `securitydept-token-set-context` 已提供专用 token-set 上下文层
- `securitydept-auth-runtime` 已在 `securitydept-token-set-context` 之上提供路由层 token-set 编排
- `securitydept-auth-runtime` 现已将 `basic-auth-context`、`session-context` 与 `token-set-context` 拆为独立 crate feature，下游无需再引入未使用的编排路径
- `apps/server` 已接入 `/auth/token-set/*` 路径完成 callback、refresh 与 metadata redemption
- bearer propagation 现在使用服务端持有的目标策略以及来源于 access token 校验链路的 `ResourceTokenPrincipal`
- `TokenPropagator` 现在既支持直接目标，也支持通过可选运行时 `PropagationNodeTargetResolver` 解析的 node-only target
- `securitydept-token-set-context` 现已包含可选的 `axum-reverse-proxy-propagation-forwarder` feature，`recommend-propagation-forwarder` 作为其 feature 别名
- `apps/server` 的 dashboard API 当前认证顺序为：
  - 如果存在 bearer header，则优先由 `oauth-resource-server` 校验 bearer access token
  - 然后是 cookie session
  - 最后是受 `basic-auth-context` 与可选 real-IP 策略约束的配置型 basic-auth
- `apps/server` 现在将 `X-SecurityDept-Propagation` 视为 propagation-aware 的 dashboard 语境：
  - 该 header 的值使用类似 `Forwarded` 的参数格式，例如 `by=dashboard;for=node-a;host=service.internal.example.com:443;proto=https`
  - 此时 `/api/*` 强制要求 bearer access-token 认证
  - `/basic/*` 不再 challenge basic-auth，而是直接返回认证方式不匹配
- `apps/server` 现已集成 `AxumReverseProxyPropagationForwarder` 用于实际的下游转发：
  - 当 `[propagation_forwarder]` 配置节存在时启用
  - `/api/propagation/*` 通配路由将经过 bearer 认证且带有已验证 propagation 上下文的请求转发到已解析的下游目标
- 客户端 SDK 现在已有正式架构与实现指南，但具体实现仍待推进
- 这些流程的 Axum 响应组装现已留在 `apps/server` 边界层，而不是放在可复用 runtime crate 内部

缺失部分：

- 客户端 SDK 的状态合并、持久化与自动刷新
- 浏览器侧对 `metadata_redemption_id` 的兑换与回退策略落地
- 用于多提供者令牌管理的 TS SDK 实现
- mixed-custody 与 stateful BFF token-set 能力已被纳入设计边界，但当前仍属 provisional，且不是第一版实现目标
- 更完整的 token exchange / downstream propagation 场景
- 在当前 `axum-reverse-proxy` forwarder feature 之上实现更丰富的转发策略和更完整的下游 token-exchange 场景

规划参考：

- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

## 7. creds-manage

目标：

- 管理简单的基础认证和静态令牌凭证
- 支持操作员管理的场景，如 Docker 注册表登录账户

当前状态：

- 已实现
- 已被参考服务器和 CLI 使用

存储设计：

- 通过 `ArcSwap<DataFile>` 实现无锁并发读取
- 通过 `atomic-write-file` 实现原子文件写入（临时文件 → fsync → rename）
- 基于 `notify-debouncer-full` 的去抖文件系统监听（监听父目录），当 FS 事件不可用时自动回退到 1s 轮询
- 基于内容哈希的自写检测：成功保存后记录写入内容的哈希值，watcher 跳过下一个匹配事件以防止递归重载

主要代码：

- `packages/creds-manage/src/store.rs`
- `packages/creds-manage/src/models.rs`
- `packages/creds-manage/src/auth.rs`
- `apps/cli/src/main.rs`

## 8. real-IP 解析

目标：

- 面向 trusted peer 的客户端 IP 解析
- 支持多层 CDN 和反向代理链路
- 为 PROXY protocol 和 forwarded 头提供 source-specific 优先级
- 为 trusted CIDR provider 提供远程刷新和本地 watch

当前状态：

- 已作为 `securitydept-realip` 实现
- 包含 provider 驱动的 trusted CIDR 解析、带信任边界语义的 header/transport 解析，以及可复用的 `RealIpAccessConfig`
- 已集成进参考服务器，用于 basic-auth dashboard 的 real-IP 限制

主要参考：

- [006-REALIP.md](006-REALIP.md)

## 9. 参考服务器应用

目标：

- 验证项目 1 + 4/5/6 + 7 的组合栈
- 作为真实部署场景的试验场

当前状态：

- 作为 `apps/server` 实现
- 已验证 cookie-session、basic-auth-context、无状态 token-set、creds-manage 以及带 real-IP 约束的 dashboard 访问
- 现已集成 `axum-reverse-proxy` propagation forwarder，通过 `/api/propagation/*` 实现 bearer 认证的下游转发
- 后续应继续作为更丰富多 zone 部署的试验场

## 推荐的近期重点

1. 继续完善 `oidc-client` 和 `oauth-resource-server` 之上的可复用认证上下文抽象
2. 将基础认证区域模式实现为有文档支持、有参考支持的流程
3. 实现无状态 token-set 模式，具有明确的令牌生命周期规则
4. 添加模式 4、5 和特别是 6 的 TS SDK 支持
5. 将 `securitydept-realip` 实现为可复用的信任边界模块
6. 保持 `apps/server` 作为所有支持模式的集成试验场

---

[English](../en/002-FEATURES.md) | [中文](002-FEATURES.md)
