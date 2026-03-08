# SecurityDept 概览

SecurityDept 是一个分层的认证和授权项目，旨在实现两个相关目标：

1. 可复用的 Rust crate，用于身份、令牌验证和凭证验证
2. 参考服务器应用，用于在真实部署场景中验证这些 crate

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
- `securitydept-oauth-resource-server`
  - bearer 令牌验证行为
- `securitydept-creds-manage`
  - 本地基础认证和静态令牌管理
- `securitydept-server`
  - 参考应用，当前主要验证 cookie-session 和本地凭证场景

## 目标认证上下文模式

SecurityDept 应在底层 crate 之上提供三种明确的认证上下文模式：

1. 基础认证区域模式（basic auth zone mode）
2. Cookie-session 模式
3. 无状态 token-set 模式（`id_token + access_token + sealed_refresh_token`）

这些模式是面向部署的组合，而不是 `oidc-client` 或 `oauth-resource-server` 的替代品。

## 设计原则

- 偏好组合而非一个巨大的全能认证 crate
- 保持令牌获取和令牌验证分离
- 明确建模无状态和有状态认证上下文模式
- 支持后端优先和前端强化的部署
- 保持服务器应用作为试验场，而非产品边界

## 文档索引

- [001-ARCHITECTURE.md](001-ARCHITECTURE.md) - 架构和 crate 边界
- [002-FEATURES.md](002-FEATURES.md) - 能力矩阵
- [003-AUTH_CONTEXT_MODES.md](003-AUTH_CONTEXT_MODES.md) - 认证上下文模式
- [004-BASIC_AUTH_ZONE.md](004-BASIC_AUTH_ZONE.md) - 基础认证区域
- [100-ROADMAP.md](100-ROADMAP.md) - 路线图

---

[English](../en/000-OVERVIEW.md) | [中文](000-OVERVIEW.md)
