# 认证上下文与模式

本文定义 SecurityDept 中 auth context、zone 与 mode 的产品含义。Package maps 与 public SDK subpaths 见 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)。Release planning 与 deferrals 见 [100-ROADMAP.md](100-ROADMAP.md)。

## 核心术语

### Auth Context

Auth context 是 top-level application-facing authentication integration surface。它定义 auth state 存放在哪里、frontend/backend responsibilities 如何划分、redirect 与 persistence 如何工作，以及 application 接收什么 principal shape。

SecurityDept 当前有三种 auth contexts：

- `basic-auth-context`
- `session-context`
- `token-set-context`

### Zone

Zone 只存在于 `basic-auth-context` 内。它定义 Basic Auth challenge boundary：route area、login/logout behavior、post-auth redirect policy 与 optional real-IP access restrictions。

Zone 不是独立 auth context。

### Mode

Mode 只存在于 `token-set-context` 内。它描述 token-set auth state 的 OIDC integration shape。

当前 token-set modes：

- `frontend-oidc`
- `backend-oidc`

`pure`、`mediated` 这类 `backend-oidc` preset 是 `backend-oidc` 内部 profiles，不是 first-level modes。

## Auth Context Overview

| Auth Context | 适用场景 | State Ownership | 内部形态 | 主要表面 |
| --- | --- | --- | --- | --- |
| Basic Auth context | browser-native Basic Auth 与 simple admin zones | browser credential cache 和 challenge routes | zones | `securitydept-basic-auth-context`、`@securitydept/basic-auth-context-client*` |
| Session context | centralized services 与 weak frontend capability | backend session store 和 HTTP-only cookie | no mode family | `securitydept-session-context`、`@securitydept/session-context-client*` |
| Token-set context | distributed SPAs 与 stronger frontend capability | 由 frontend/backend OIDC mode 决定 | `frontend-oidc`、`backend-oidc` | `securitydept-token-set-context`、`@securitydept/token-set-context-client*` |

## Basic Auth Context

`basic-auth-context` 组合：

- `securitydept-creds`
- optional `securitydept-creds-manage`
- optional `securitydept-realip`
- Basic Auth challenge/login/logout response metadata
- thin browser / React / Angular helpers

推荐 browser UX：

- 普通 JSON APIs 返回不带 `WWW-Authenticate` 的 `401`
- 专用 challenge route 返回带 `WWW-Authenticate: Basic` 的 `401`
- challenge 成功后 redirect 回 application

Logout 必须尊重浏览器限制：没有标准 JavaScript API 能清除 cached Basic Auth credentials。SecurityDept 支持 protocol-compatible logout poisoning，而不是假装 Basic Auth 有普通 token-clear 操作。

## Session Context

`session-context` 是 backend-owned cookie-session auth context。它组合：

- `securitydept-oidc-client`
- `securitydept-session-context`
- `tower-sessions`
- optional browser / React / Angular helpers

Backend 拥有 OIDC login、callback handling、session state、logout 与 normalized user-info。Browser 携带 HTTP-only session cookie，client helper 主要用于 login URL、user-info 与 logout entrypoints。

Session context 没有 mode family。

## Token-Set Context

`token-set-context` 跨 frontend token runtime、backend OIDC runtime、access-token substrate 与 cross-boundary transport contracts。

### Frontend OIDC Mode

在 `frontend-oidc` 中：

- browser 运行 authorization、callback、token exchange 与 token storage
- backend 通过 config endpoint 投影安全 frontend configuration
- access-token material 可被 API calls 与 propagation-aware server boundaries 消费

虽然 OIDC flow 由 browser 运行，Rust 仍拥有正式 config projection 与 integration contracts。

### Backend OIDC Mode

在 `backend-oidc` 中：

- backend 运行 OIDC authorize、callback、refresh、exchange 与 user-info paths
- browser 接收 mode-qualified responses 与 token-set state
- `pure` 与 `mediated` 是同一个 backend mode 内部的 preset bundles

Backend OIDC capability axes：

- `refresh_material_protection`：例如 `passthrough` 或 `sealed`
- `metadata_delivery`：例如 `none` 或 `redemption`
- `post_auth_redirect_policy`：例如 `caller_validated` 或 `resolved`

Token propagation 不是 backend-oidc axis。它归属 `access_token_substrate`。

## Principal Boundaries

SecurityDept 区分：

- `AuthenticatedPrincipal`：session 与 token-set user-info surfaces 使用的人类认证身份。
- `ResourceTokenPrincipal`：resource-server verification、API authorization 与 propagation 使用的 access-token-derived resource facts。

不要把二者视为别名。Human principal 回答“谁登录了”；resource token principal 回答“这个 bearer token 能访问什么”。

## Redirect Boundary

Post-auth redirects 不是 unchecked raw URLs。每个 context 都必须将 redirect targets 限制在已验证 same-origin 或已配置 application paths 内。

当前相关路径：

- session callback：`/auth/session/callback`
- token-set backend-mode callback：`/auth/token-set/backend-mode/callback`
- frontend-mode config projection：`/api/auth/token-set/frontend-mode/config`
- frontend-mode browser callback route：由 host application / adapter integration 拥有

## Ownership Rules

- Basic Auth `zone` 只属于 `basic-auth-context`。
- `mode` 只属于 `token-set-context`。
- Session context 不是 token-set mode。
- Route-facing services 位于 owning crates，不位于共享 auth-runtime aggregation layer。
- App-specific chooser UI、product copy 与 business routes 属于 adopter 或 reference apps，不属于 SDK core。

---

[English](../en/020-AUTH_CONTEXT_AND_MODES.md) | [中文](020-AUTH_CONTEXT_AND_MODES.md)
