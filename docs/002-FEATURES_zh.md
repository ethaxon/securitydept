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
- `packages/creds/src/zone/mod.rs`

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
- 可选的 TS 助手用于重定向到认证端点

当前状态：

- 设计已文档化
- 底层组件已存在
- 作为一等认证上下文模式的参考集成仍不完整

主要参考：

- `packages/creds/src/zone/mod.rs`
- `docs/004-BASIC_AUTH_ZONE.md`

## 5. 有状态 cookie-session 认证上下文

目标：

- 简单的集中式部署模式
- 适用于弱前端能力
- 后期可选的 TS 助手用于重定向到登录

当前状态：

- 在 `apps/server` 中部分实现
- 当前服务器流程在 OIDC 回调后使用内存会话
- 尚未提取为专用的可复用认证上下文层

主要参考：

- `apps/server/src/routes/auth.rs`
- `apps/server/src/middleware.rs`
- `packages/creds-manage/src/session.rs`

## 6. 无状态 token-set 认证上下文

目标：

- `id_token + access_token + sealed_refresh_token`
- 无需服务器端浏览器会话存储
- 适用于分布式 SPA 和网格状代理场景
- 后期前端 TS SDK 用于令牌存储、头注入、刷新和登录重定向

当前状态：

- 计划中
- 底层组件已存在，但尚无专用的 token-set 上下文层

缺失部分：

- token-set 模型和生命周期规则
- 前端所有状态的密封刷新令牌处理契约
- 从 token-set 规范化主体提取
- 同资源转发的 bearer 传播策略
- 用于多提供者令牌管理的 TS SDK

## 7. creds-manage

目标：

- 管理简单的基础认证和静态令牌凭证
- 支持操作员管理的场景，如 Docker 注册表登录账户

当前状态：

- 已实现
- 已被参考服务器和 CLI 使用

主要代码：

- `packages/creds-manage/src/store.rs`
- `packages/creds-manage/src/models.rs`
- `packages/creds-manage/src/auth.rs`
- `apps/cli/src/main.rs`

## 8. 参考服务器应用

目标：

- 验证项目 1 + 4/5/6 + 7 的组合栈
- 作为真实部署场景的试验场

当前状态：

- 作为 `apps/server` 实现
- 当前主要验证 cookie-session 模式加上 creds-manage 和底层认证组件
- 应演变为将基础认证区域和无状态 token-set 模式作为一等场景进行验证

## 推荐的近期重点

1. 从 `oidc-client` 和 `oauth-resource-server` 之上提取可复用的认证上下文抽象
2. 将基础认证区域模式实现为有文档支持、有参考支持的流程
3. 实现无状态 token-set 模式，具有明确的令牌生命周期规则
4. 添加模式 4、5 和特别是 6 的 TS SDK 支持
5. 保持 `apps/server` 作为所有支持模式的集成试验场

---

[English Version](002-FEATURES.md) | [中文版本](002-FEATURES_zh.md)
