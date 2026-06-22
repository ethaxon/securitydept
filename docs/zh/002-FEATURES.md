# 能力矩阵

本页描述当前已经实现的产品基线，不表示 reference-app 的每条 route 都是 stable SDK API。

| 领域 | 当前基线 | 主要 surface |
| --- | --- | --- |
| Credential verification | Basic credentials、static tokens、JWT/JWE、RFC 9068 access-token validation。 | `securitydept-creds` |
| Credential management | local credential/token data、atomic update、debounced reload 与 self-write detection。 | `securitydept-creds-manage` |
| OIDC/OAuth | authorization-code/PKCE、callback exchange、refresh、user-info/claims normalization、provider 和 resource-server contract。 | `securitydept-oidc-client`、`securitydept-oauth-*` |
| Basic Auth context | zone policy、challenge/login metadata、redirect policy、boundary observation 与 client adapter。 | `securitydept-basic-auth-context`、`@securitydept/basic-auth-context-client*` |
| Session context | server-owned OIDC/dev session flow、normalized session principal 与 client adapter。 | `securitydept-session-context`、`@securitydept/session-context-client*` |
| Token-set context | frontend/backend OIDC mode、orchestration、registry、access-token substrate 与 framework adapter。 | `securitydept-token-set-context`、`@securitydept/token-set-context-client*` |
| Client foundation | explicit environment、signals/resources、event stream、cancellation、span、tracing、transport、storage、router/popup abstraction 与 RxJS interop。 | `@securitydept/client` |
| Client-IP policy | 基于 rule 的可信 hop graph，支持 forwarded header、bridge proof、PROXY protocol 与 local/container/Kubernetes node。 | `securitydept-realip` |
| Reference runtime | Axum server、React WebUI、Docker runtime artifact 和 end-to-end proof path。 | `apps/server`、`apps/webui` |

## 管理 CLI

`securitydept-cli` 将不依赖配置的 material generation 与修改 credential-management 数据文件的命令分开：

```bash
# 不读取 config.toml，输出完整的 [[basic_auth_context.users]] block。
securitydept-cli creds create-basic -i

# 管理 [creds_manage].data_path 中的 entry 和 group。
securitydept-cli creds-manage entry list
securitydept-cli creds-manage entry create-basic -i
securitydept-cli creds-manage group list

# 输出用于 trusted Real-IP bridge header 的 opaque bearer。
securitydept-cli realip header create-secret-bearer
```

交互式 credential 命令使用带二次确认的掩码密码输入。静态 generator 支持 `--format toml` 与 `--format json`；只有 `creds-manage` 命令会加载 `--config`。

## JWE 基线

Reference server 与 JWT 一起启用 JWE，`securitydept-oauth-resource-server` 也默认启用 `jwe` feature。较底层的 `securitydept-creds` 继续提供细粒度 feature：JWT 与 JWE 均不会被隐式启用，其中 `jwe` feature 会包含所需的 `jwt` 和 `jwk` features。

Compact JWE 解密使用模块化 `no-way-jose` crates 与 RustCrypto 实现，不链接 OpenSSL。Rustls 负责 network TLS，与本地 JOSE cryptography 是相互独立的边界。

当前实现基线如下：

- 仅接受 nested signed JWT payload。
- 支持 `RSA-OAEP`、`RSA-OAEP-256`、ECDH-ES、AES-KW、AES-GCM-KW、direct（`dir`）与 PBES2 key management。
- 支持 128/192/256-bit 变体中的 AES-GCM 与 AES-CBC-HMAC-SHA2 content encryption。
- OAuth resource server 支持本地 JWK/JWKS key，以及 RSA PKCS#1/PKCS#8、P-256/P-384 SEC1/PKCS#8 PEM private key，并可监视 key file rotation。

已弃用的 `RSA1_5` 会被拒绝。当前 `no-way-jose` backend 尚未实现 `RSA-OAEP-384` 与 `RSA-OAEP-512`，因此也会明确拒绝这两种算法。

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
