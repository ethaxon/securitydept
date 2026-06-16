# 架构

SecurityDept 将可复用的安全原语与应用组合分开。Rust 负责服务端协议和配置解析；TypeScript 负责显式的 host integration 与 browser/framework lifecycle composition；参考应用共同验证这两层。

## Rust 分层

| 层 | 主要 crates | 职责 |
| --- | --- | --- |
| Foundation | `securitydept-utils`、`securitydept-core` | 共享 utility contracts 和对齐的 re-exports。 |
| Credential 和网络 policy | `securitydept-creds`、`securitydept-creds-manage`、`securitydept-realip` | credential verification/storage 与可信 client-IP resolution。 |
| OAuth/OIDC | `securitydept-oidc-client`、`securitydept-oauth-provider`、`securitydept-oauth-resource-server` | provider interaction、authorization-code flow 和 resource-token verification。 |
| Auth contexts | `securitydept-basic-auth-context`、`securitydept-session-context`、`securitydept-token-set-context` | 面向应用的 authentication model 和对应 runtime/config contracts。 |

`securitydept-core` 是便捷的对齐 re-export 入口，不替代各 crate 的职责归属。

## Auth Contexts

产品有三个顶层 auth context：

- Basic Auth context 建模浏览器 Basic-Auth challenge zones。
- Session context 建模 server-owned、cookie-backed user session。
- Token-set context 建模 OIDC token state 及其 frontend/backend integration modes。

完整 ownership 见 [认证上下文和模式](020-AUTH_CONTEXT_AND_MODES.md)。`zone` 只属于 Basic Auth，`mode` 只属于 token-set context。

## Token-Set 架构

Token-set context 有意分为 protocol-neutral 与 mode-specific 部分：

- `orchestration` 负责 token snapshot、freshness calculation、persistence helper、workflow source、lifecycle candidate 和 final determination commit。
- `frontend-oidc-mode` 负责 browser authorization-code/PKCE protocol，以及 safe server configuration projection 的消费。
- `backend-oidc-mode` 负责 server-mediated callback、refresh、metadata redemption 和 user-info contract。
- `access-token-substrate` 负责 resource-token verification 和 bearer propagation integration。
- `registry` 负责多个 mode client 的 composition 与 callback routing。

client 是自身内存 auth snapshot 的唯一 authority。workflow planner 计算闭合的、可判别的 candidate；host 一次性提交最终 determination。page resume、token-refresh timer 等 workflow source 只提供串行 lifecycle 输入，不拥有第二份 state authority。

## TypeScript Foundation

每个 client 都接收显式的 `FoundationEnvironment`。其必需基线能力为：

- neutral `transport`
- `time`
- `realmStorage`
- `span`
- `tracing`

persistent/session storage、router、page lifecycle、popup、idle callback 等 browser capability 保持可选且显式。`web`、`webext`、`server` subpath 的 environment creator 在 client construction 前适配 raw host facility。

公开 state/event 边界是 SDK 自己的 `SignalTrait`、`EventStreamTrait` 与 cancellation-token traits。它们具有 observable interop，因此内部实现可直接用 RxJS 组合，而不把 RxJS 作为 public SDK contract 泄漏出去。

## 参考运行时

`apps/server` 将 raw TOML/environment configuration 解析为 crate-owned resolved configuration，构建 context runtime 并挂载 HTTP routes。`apps/webui` 是 React reference host，使用同一显式 environment model 组合 TypeScript clients。

参考运行时是 proof surface，而不是新的 public SDK layer。其 application route、UI copy 和 local composition choice 不构成可复用 SDK contract。

## 边界规则

- raw host configuration 必须先解析和验证，再构造 reusable runtime。
- access-token facts 与 authenticated-user principal 是不同 projection。
- redirect target 是经过验证的 policy input，不是未检查的 raw URL。
- environment 边界中的 transport 是 neutral 的；authorized transport 是从 client 派生的能力，不是 environment 持有的 authorization state。
- span context 提供 trace nesting；调用者记录当前行为，而不维护另一套全局 outcome/source vocabulary。

---

[English](../en/001-ARCHITECTURE.md) | [中文](001-ARCHITECTURE.md)
