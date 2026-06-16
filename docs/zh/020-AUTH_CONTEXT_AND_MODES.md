# 认证上下文和模式

auth context 是面向应用的 authentication integration boundary。它定义 state 所在位置、redirect/persistence model，以及向 host application 暴露的 principal shape。

## 产品模型

| Context | State owner | 适用场景 | 主要 surface |
| --- | --- | --- | --- |
| Basic Auth | browser credential cache 和 server challenge boundary | 小型管理区需要 HTTP Basic Auth semantics。 | `basic-auth-context` |
| Session | server session store 和 HTTP-only cookie | server 应拥有 login、callback 和 user state。 | `session-context` |
| Token set | 所选 OIDC mode 和 client runtime | browser 或 server-mediated OIDC integration 需要 access-token state。 | `token-set-context` |

## Basic Auth Context

Basic Auth `zone` 描述一个 challenge boundary：route prefix、login/logout path、post-auth redirect policy，以及可选 client-IP restriction。zone 不是独立的 auth context。

浏览器不能可靠地清除已缓存的 Basic Auth credential。logout 因此使用 protocol-compatible challenge/poisoning flow，不能描述成普通 token deletion。

## Session Context

Session context 是 server-owned 的。server 处理 OIDC login、callback、logout 和 normalized user-info；browser 只携带 session cookie，并通过显式 client operation 进行 navigation 或 session refresh。session context 没有 mode family。

## Token-Set Context

token-set `mode` 描述 OIDC integration shape：

- `frontend-oidc`：browser 执行 authorization-code/PKCE；server 投影安全 configuration DTO；client 拥有自身 in-memory token snapshot 与 lifecycle。
- `backend-oidc`：server 执行 OIDC redirect/callback/refresh protocol，并向 client 暴露 mode contract。

backend-mode preset 与 capability choice 是 `backend-oidc` 内部配置，不是新的顶层 mode。bearer propagation 属于 access-token substrate，而不属于 backend-mode capability axis。

### Browser Projection 和 Secret Boundary

`frontend-oidc` 接收 `FrontendOidcModeConfigProjection`，即由 server 生成的 browser DTO。它包含 browser 所需的 resolved public OIDC connectivity 与 callback information，而不是 server 的完整 OIDC configuration。client secret 默认不会投影；只有显式启用 unsafe server capability 后才可能包含。browser application 不得将这一 opt-in 当作普通 deployment default。

server 持有的 secret value 使用 `SecretString`，其 debug 和 serialization 形式均会被 redacted。application boundary 也遵守同一规则：raw access token、refresh token、authorization header、password、provider secret 和 token-exchange payload 都不是安全的 browser projection 或 public event data。

reference server 在 `GET /api/auth/token-set/frontend-mode/config` 暴露 public frontend projection。backend-mode 的 login、callback、refresh、metadata redemption 与 user-info 位于 `/auth/token-set/backend-mode/*`。host 可以使用不同 path，但 callback/redirect validation 必须留在 server policy 内，不得接受 caller-controlled URL。

## Principal 和 Token 边界

- authenticated principal 表示已登录的人，用于 session/token-set 的 user-facing state。
- resource-token principal 表示已验证 bearer-token authorization facts，例如 subject、issuer、audience、scope 和 authorized party。

二者相关但不可互换。raw token material、authorization header、password、provider/client secret 不得进入 safe principal claim。

`ResourceTokenPrincipal` 是从已验证 bearer token 导出的 authorization evidence：subject、issuer、audience、scope、authorized party 和 claim。它不是 session 或 token-set user-facing state 所使用的 authenticated human principal 的替代品。

## Host Configuration

Rust host 分阶段解析配置：

1. serde-facing raw configuration 接收 file/environment input。
2. crate-owned config source 应用 shared OIDC default 和 host validator。
3. resolved configuration 构造 reusable runtime。

host 将 route path、source key、account binding、display data 等 product-specific policy 放在 reusable config projection 之外。redirect target 必须经过 host policy 验证；任何 auth context 都不接受未检查的任意 redirect URL。

---

[English](../en/020-AUTH_CONTEXT_AND_MODES.md) | [中文](020-AUTH_CONTEXT_AND_MODES.md)
