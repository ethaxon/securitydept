# 能力矩阵

本文总结 SecurityDept 当前能力。所有权边界见 [001-ARCHITECTURE.md](001-ARCHITECTURE.md)，TypeScript SDK 契约见 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)，release planning 见 [100-ROADMAP.md](100-ROADMAP.md)。

## 能力状态

| 领域 | 当前状态 | 主要表面 |
| --- | --- | --- |
| Credential verification | 已实现 Basic Auth、static tokens、JWT、JWE 与 RFC 9068 access tokens。 | `securitydept-creds` |
| OIDC client | 已实现 authorization-code / PKCE、callback exchange、refresh、claims normalization、optional userinfo 与 pending OAuth state。 | `securitydept-oidc-client` |
| OAuth resource server | 已实现 JWT、JWE、不透明 token 的 bearer verification，并支持 issuer / audience / scope policy。 | `securitydept-oauth-resource-server`、`securitydept-oauth-provider` |
| Basic Auth context | 已实现 Basic Auth zones、challenge / login / logout metadata、post-auth redirects、optional real-IP access policy、server integration，以及 browser / React / Angular helpers。 | `securitydept-basic-auth-context`、`@securitydept/basic-auth-context-client*` |
| Session context | 已实现 cookie-session context、normalized principal、OIDC session service、dev-session service、server integration，以及 browser / React / Angular helpers。 | `securitydept-session-context`、`@securitydept/session-context-client*` |
| Token-set context | 已实现 frontend/backend OIDC mode contracts、backend-mode routes、frontend-mode config projection、access-token substrate、bearer propagation、route orchestration、React / Angular adapters 与 reference-app dogfooding。 | `securitydept-token-set-context`、`@securitydept/token-set-context-client*` |
| Real-IP resolution | 已实现 trusted provider/source model，覆盖 forwarded headers、PROXY protocol、local / remote / command / Docker / Kubernetes provider sources，并集成到 reference-server Basic Auth policy。 | `securitydept-realip` |
| Credential management | 已实现本地 Basic Auth 与 static-token storage，支持 lock-free reads、atomic writes、debounced watching 与 self-write detection。 | `securitydept-creds-manage`、`apps/cli`、`apps/server` |
| Reference apps | 已实现 Axum server、React web UI、playground/reference routes、management API auth branching、bearer propagation 与 Docker image build path。 | `apps/server`、`apps/webui`、`Dockerfile` |
| TypeScript SDK release surface | 已实现 shared client foundation、Basic Auth、session、token-set、React、Angular integration 的 publishable npm package families。 | `sdks/ts/packages/*`、`public-surface-inventory.json` |

## 当前 Auth-Context Baseline

SecurityDept 当前将这些视为产品化 auth-context surfaces：

- Basic Auth context：轻量 browser-native Basic Auth zones 与 helpers。
- Session context：backend-owned session state 与 HTTP-only cookie flow。
- Token-set context：browser / backend OIDC mode contracts，加上 access-token substrate 与 framework adapters。

Token-set 有意比 Basic Auth 和 session 更丰富。Basic Auth 与 session 必须保持 discoverable 和 tested，但除非重复 adopter evidence 证明需要，否则不应膨胀成平行的大型 frontend runtime。

## Reference Server Behavior

reference server 通过以下路径验证组合行为：

- `/api/*` dashboard APIs，按 bearer-first、session-second、Basic Auth fallback 顺序授权。
- `/basic/*` Basic Auth dashboard zone，以及 `/basic/api/*` Basic Auth-protected management API mirror。
- `/auth/session/*` session login、callback、logout 与 user-info routes。
- `/auth/token-set/backend-mode/*` backend OIDC mode routes。
- `/api/auth/token-set/frontend-mode/config` frontend OIDC mode config projection。
- 配置后启用的 `/api/propagation/*` bearer-authenticated propagation forwarder。
- route-level diagnosis 与 response-shape policy tables，覆盖 shared envelope、protocol exceptions、business not-found 与 forwarding-preserved errors。

## 已知边界

这些主题是真实需求，但不属于当前 beta product baseline：

- mixed-custody token ownership
- full BFF / server-side token-set ownership
- SDK 内建 chooser UI 或 product route tables
- 非 TypeScript SDK productization
- full OTel/exporter stack
- 超出当前 propagation forwarder baseline 的 broad token-exchange policy

---

[English](../en/002-FEATURES.md) | [中文](002-FEATURES.md)
