# 架构

SecurityDept 是分层 auth stack，不是单体认证服务。底层 crates 拥有协议和验证原语；auth-context crates 将这些原语组合成可部署的应用契约。

## 分层

### 1. 验证原语

Crate：`securitydept-creds`

- Basic Auth 与 static-token 解析 / 验证
- JWT 与 JWE helpers
- RFC 9068 access-token validation
- 共享 credential 与 verifier traits

这一层不理解 browser redirects、OIDC authorization-code flow、application sessions 或 route policy。

### 2. 远程 Provider Runtime

Crate：`securitydept-oauth-provider`

- OIDC discovery metadata fetch / refresh
- JWKS fetch / refresh
- 共享 HTTP client reuse
- introspection endpoint access
- provider configuration normalization

这一层由 OIDC client code 与 OAuth resource-server verification 共用。

### 3. OIDC Client

Crate：`securitydept-oidc-client`

- authorization-code 与 PKCE flow
- callback exchange
- refresh 与 revocation helpers
- claims normalization
- optional userinfo fetch
- pending OAuth state storage

这个 crate 获取 identity 与 token material。它不验证任意 API 请求携带的 bearer token。

### 4. OAuth Resource Server

Crate：`securitydept-oauth-resource-server`

- API bearer access-token verification
- JWT、JWE、不透明 token introspection
- issuer、audience、scope 与 time validation
- JWE decryption-key loading / refresh

这个 crate 验证已呈现的 token。它不执行 browser login 或 authorization-code redirect。

### 5. Auth Context Crates

Auth-context crates 是底层之上的部署契约：

- `securitydept-basic-auth-context`：Basic Auth zones、challenge/login/logout response metadata、post-auth redirects 与可选 real-IP access restrictions。
- `securitydept-session-context`：cookie-session auth context、normalized session principal、session service traits、OIDC session service，以及 `service` feature 下的 dev-session service。
- `securitydept-token-set-context`：frontend OIDC mode、backend OIDC mode、access-token substrate、route orchestration、metadata redemption 与 bearer propagation。

Route-facing services 位于 owning crates：

- `BasicAuthContextService` 位于 `securitydept-basic-auth-context`
- `SessionAuthServiceTrait`、`OidcSessionAuthService`、`DevSessionAuthService` 位于 `securitydept-session-context`
- `BackendOidcModeAuthService` 位于 `securitydept-token-set-context::backend_oidc_mode`
- `AccessTokenSubstrateResourceService` 位于 `securitydept-token-set-context::access_token_substrate`

已移除的 `securitydept-auth-runtime` 聚合层不是产品面。

### 6. Real-IP Resolution

Crate：`securitydept-realip`

- trusted peer CIDR providers
- 跨 stacked proxies / CDNs 的 effective client-IP resolution
- forwarded headers 与 transport metadata 的 source-specific trust rules
- trusted peer lists 的 refresh / watch 行为

这个 crate 解析 trust-boundary-aware client IP。它不拥有 URL reconstruction、rate limiting 或 business traffic policy。

### 7. Credential Management

Crate：`securitydept-creds-manage`

- 管理本地 Basic Auth credentials 与 static tokens
- 为简单 credential data 提供 operator-managed storage
- 支持 lock-free reads、atomic writes、debounced watching 与 self-write detection

这个 crate 存储本地 credential data。验证仍归属 `securitydept-creds`。

### 8. Reference Applications

Applications：

- `apps/server`：Axum reference server
- `apps/webui`：React reference UI
- `apps/cli`：local credential-management CLI

Reference applications 用于证明组合行为；它们不是 reusable crates 或 SDK packages 的产品边界。

## Token-Set Context Shape

`token-set-context` 有两个正式 OIDC modes：

- `frontend-oidc`：browser-owned OIDC flow、backend-projected configuration 与 access-token substrate integration。
- `backend-oidc`：backend-owned OIDC flow，能力轴包括 refresh-material protection、metadata delivery 与 post-auth redirect policy。

`pure`、`mediated` 这类 `backend-oidc` preset 是 `backend-oidc` mode 内部的 profiles，不是独立 first-level modes。Token propagation 是共享 access-token substrate capability，不是 `backend-oidc` preset axis。

两个 principal 概念必须保持分离：

- `AuthenticatedPrincipal`：session 与 token-set user-info surfaces 使用的人类认证身份。
- `ResourceTokenPrincipal`：API authorization 与 bearer propagation 使用的 access-token-derived resource facts。

## Server Route Boundary

reference server dashboard API 当前按以下顺序尝试认证：

1. 存在 `Authorization: Bearer ...` header 时使用 bearer access token
2. cookie session
3. 受 `basic-auth-context` 与可选 real-IP policy 约束的 configured Basic Auth

`X-SecurityDept-Propagation` 会让 `/api/*` 进入 propagation-aware dashboard context，并强制 bearer-token authentication。Basic Auth protocol routes 与 forward-auth challenge routes 刻意保留 protocol-specific response shapes，而不是强行进入 shared JSON error envelope。

## 边界规则

- `oidc-client` 不得吸收 resource-server verification。
- `oauth-resource-server` 不得吸收 browser login flow。
- provider discovery / cache 保持在 OIDC client 与 resource-server verification 下方。
- auth-context crates 组合底层 crates，而不是复制底层逻辑。
- framework-specific response assembly 属于 app 或 adapter boundary，除非 reusable crate 明确暴露 framework-neutral response metadata。
- bearer forwarding 必须显式且经过 policy check；不应隐藏在 login APIs 内部。

---

[English](../en/001-ARCHITECTURE.md) | [中文](001-ARCHITECTURE.md)
