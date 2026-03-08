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

- `securitydept-basic-auth-zone`

## 第 6 层：凭证管理

Crate: `securitydept-creds-manage`

职责：

- 管理本地基础认证凭证
- 管理本地静态令牌
- 为简单的操作员管理凭证提供存储和同步原语
- 支持注册表登录管理和基础网关认证等场景

该 crate 是操作存储，而非令牌验证核心。

## 第 7 层：参考应用

Apps:

- `apps/server`
- `apps/cli`
- `apps/webui`

`apps/server` 应保持为组合能力的试验场：

- 底层验证
- 基础认证区域模式
- cookie-session 模式
- 无状态 token-set 模式
- creds-manage 集成

它不是项目的架构边界。

## 重要的边界规则

- `oidc-client` 不得吸收资源服务器验证
- `oauth-resource-server` 不得吸收浏览器登录流程
- 提供者缓存/发现必须位于两者之下
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
