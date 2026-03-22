# 基础认证上下文模式

基础认证上下文模式是 SecurityDept 应支持的最小认证上下文模式。

它旨在用于浏览器原生基础认证可接受且完整 OIDC 流程会过度的部署。

## UX 问题

现代 SPA 不能盲目地将所有 `401 Unauthorized` 响应与 `WWW-Authenticate: Basic` 同等对待。如果普通 API 请求触发浏览器的原生登录对话框，SPA 将失去对体验的控制。

## 核心模式

SecurityDept 应将基础认证挑战隔离在显式的挑战路由后面。

推荐行为：

- 普通 JSON API 返回 `401` 而不带 `WWW-Authenticate`
- 专用挑战入口路由返回 `401` 并带 `WWW-Authenticate: Basic`
- 当凭证有效时，该挑战路由重定向回应用

这使浏览器原生对话框成为可选而非意外的。

## 注销限制

浏览器不暴露用于清除缓存的基础认证凭证的标准 JavaScript API。

因此，未来的参考实现可能仍需要经典凭证中毒注销技巧：

- 向专用注销端点发送故意无效的基础认证凭证
- 返回 `401` 而不带 `WWW-Authenticate`
- 让浏览器静默替换缓存的凭证

## 与其他层的关系

基础认证上下文模式不应依赖 OIDC。

它主要应组合：

- `securitydept-creds`
- `securitydept-creds-manage`
- 对安全性较弱场景可选的 `securitydept-realip` 访问限制
- 可选的服务器和 TS 助手

## 当前配置方向

当前 Rust crate 为 `securitydept-basic-auth-context`。

其配置已开始区分：

- 全局 basic-auth context 设置
- 一个或多个 zone 定义及其各自的 post-auth redirect 规则
- 基于 `securitydept-realip::RealIpAccessConfig` 的可选 `real_ip_access` 访问限制

## 计划的 SDK 范围

未来用于此模式的轻量级 TypeScript SDK 仅需帮助：

- 重定向到 challenge URL
- 可选的注销助手行为

用户还应该能够在不依赖大型前端运行时的情况下自己实现。

---

[English](../en/004-BASIC_AUTH_ZONE.md) | [中文](004-BASIC_AUTH_ZONE.md)
