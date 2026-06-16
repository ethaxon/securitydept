# 能力矩阵

本页描述当前已经实现的产品基线，不表示 reference-app 的每条 route 都是 stable SDK API。

| 领域 | 当前基线 | 主要 surface |
| --- | --- | --- |
| Credential verification | Basic credentials、static tokens、JWT/JWE、RFC 9068 access-token validation。 | `securitydept-creds` |
| Credential management | local credential/token data、atomic update、debounced reload 与 self-write detection。 | `securitydept-creds-manage` |
| OIDC/OAuth | authorization-code/PKCE、callback exchange、refresh、user-info/claims normalization、provider 和 resource-server contract。 | `securitydept-oidc-client`、`securitydept-oauth-*` |
| Basic Auth context | zone policy、challenge/login/logout metadata、redirect policy 与 client adapter。 | `securitydept-basic-auth-context`、`@securitydept/basic-auth-context-client*` |
| Session context | server-owned OIDC/dev session flow、normalized session principal 与 client adapter。 | `securitydept-session-context`、`@securitydept/session-context-client*` |
| Token-set context | frontend/backend OIDC mode、orchestration、registry、access-token substrate 与 framework adapter。 | `securitydept-token-set-context`、`@securitydept/token-set-context-client*` |
| Client foundation | explicit environment、signals/resources、event stream、cancellation、span、tracing、transport、storage、router/popup abstraction 与 RxJS interop。 | `@securitydept/client` |
| Client-IP policy | forwarded header、PROXY protocol 以及 local/container/Kubernetes source 的 trusted provider resolution。 | `securitydept-realip` |
| Reference runtime | Axum server、React WebUI、Docker runtime artifact 和 end-to-end proof path。 | `apps/server`、`apps/webui` |

## Reference Server Routes

参考 server 挂载以下 contract family：

- `/auth/session/*`：session login、callback、logout 和 user info。
- `/auth/token-set/backend-mode/*`：backend OIDC login、callback、refresh、metadata redemption 和 user info。
- `/api/auth/token-set/frontend-mode/config`：safe frontend OIDC configuration projection。
- `/basic/*` 与 `/basic/api/*`：Basic Auth challenge 和 protected management API。
- `/api/*`：dashboard-authenticated management API。
- `/api/propagation/*`：只在配置 bearer propagation 时存在。
- `/health` 和 `/api/health`：health check。

## 有意保留的边界

当前基线不 productize：

- mixed-custody token ownership 或通用 BFF/server-side token-set model
- 内置 chooser UI、business route table 或 product copy
- 非 TypeScript client SDK
- 完整 OpenTelemetry exporter/product observability stack
- 除已配置 propagation forwarder 外的通用 token exchange

当前工作与延期范围见 [路线图](100-ROADMAP.md)。

---

[English](../en/002-FEATURES.md) | [中文](002-FEATURES.md)
