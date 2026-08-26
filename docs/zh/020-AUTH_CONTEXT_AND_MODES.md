# 认证上下文和模式

auth context 是面向应用的 authentication integration boundary。它定义 state 所在位置、redirect/persistence model，以及向 host application 暴露的 principal shape。

## 产品模型

| Context | State owner | 适用场景 | 主要 surface |
| --- | --- | --- | --- |
| Basic Auth | browser credential cache 和 server challenge boundary | 小型管理区需要 HTTP Basic Auth semantics。 | `basic-auth-context` |
| Session | server session store 和 HTTP-only cookie | server 应拥有 login、callback 和 user state。 | `session-context` |
| Token set | 所选 OIDC mode 和 client runtime | browser 或 server-mediated OIDC integration 需要 access-token state。 | `token-set-context` |

## Basic Auth Context

Basic Auth `zone` 描述一个 challenge boundary：route prefix、login path、post-auth redirect policy，以及可选 client-IP restriction。zone 不是独立的 auth context。

浏览器持有已缓存的 Basic Auth credential，且没有可靠的程序化撤销操作。因此 server 不暴露 Basic Auth logout route。`BasicAuthContextClient.logout()` 只清除 client 当前的内存 boundary projection；如果浏览器继续发送 credential，后续 probe 仍可能重新解析为 authenticated。

reference server 允许 Basic Auth 登录回跳到 WebUI 内以 `/` 开头的同源路径，包括 dashboard route。绝对 URL、`//host/path` 形式的 network-path reference 和反斜杠变体会被 server redirect policy 拒绝。

## Session Context

Session context 是 server-owned 的。server 处理 OIDC login、callback、logout 和 normalized user-info；browser 只携带 session cookie，并通过显式 client operation 进行 navigation 或 session refresh。session context 没有 mode family。

## Token-Set Context

token-set `mode` 描述 OIDC integration shape：

- `frontend-oidc`：browser 执行 authorization-code/PKCE；server 投影安全 configuration DTO；client 拥有自身 in-memory token snapshot 与 lifecycle。
- `backend-oidc`：server 执行 OIDC redirect/callback/refresh protocol，并向 client 暴露 mode contract。

backend-mode preset 与 capability choice 是 `backend-oidc` 内部配置，不是新的顶层 mode。bearer propagation 属于 access-token substrate，而不属于 backend-mode capability axis。

### Browser Projection 和 Secret Boundary

`frontend-oidc` 接收 `FrontendOidcModeConfigProjection`，即由 server 生成的 browser DTO。它包含 browser 所需的 resolved public OIDC connectivity 与 callback information，而不是 server 的完整 OIDC configuration。client secret 默认不会投影；只有显式启用 unsafe server capability 后才可能包含。browser application 不得将这一 opt-in 当作普通 deployment default。

server 持有的 secret value 使用 `SecretString`，其 debug 和 serialization 形式均会被 redacted。application boundary 也遵守同一规则：raw access token、refresh token、authorization header、password、provider secret 和 token-exchange payload 不得进入安全 configuration/principal projection 或 public event。mode client 使用的 token material 是进程内凭据，不是安全 DTO。

reference server 在 `GET /api/auth/token-set/frontend-mode/config` 暴露 public frontend projection。backend-mode 的 login、callback、refresh、metadata redemption 与 user-info 位于 `/auth/token-set/backend-mode/*`。host 可以使用不同 path，但 callback/redirect validation 必须留在 server policy 内，不得接受 caller-controlled URL。

### 浏览器运行时和 Token 复制

Frontend OIDC 需要 host 提供 Web Crypto 能力；参阅[运行时检查和 polyfill 需求](007-CLIENT_SDK_GUIDE.md#frontend-oidc-运行时能力)。server-mediated session/backend OIDC 不会将其密码学操作转移到浏览器。

reference WebUI 的新建 token 面板会尝试剪贴板复制并提示成功。clipboard API 缺失、权限拒绝或写入失败时，token 保留在只读字段中并自动选中，同时显示手动复制说明和选择按钮。应先保存再关闭；复制失败不影响 token 创建。复制反馈不包含 token 值或原始浏览器错误。

## Rust Provider HTTP Transport

`OAuthProviderRuntime` 使用 reqwest 0.13 与 rustls。`http_client()` 返回用于
直接 HTTP 请求的 reqwest client；`oauth_http_client()` 返回用于 OAuth/OIDC
`request_async(...)` 调用的 `oauth2_reqwest::ReqwestClient` adapter。二者共用
同一个连接池。Provider 请求不跟随 HTTP redirect；应配置最终的 discovery、
JWKS、token、userinfo 与 introspection endpoint URL。

SecurityDept 关闭了 `oauth2` 和 `openidconnect` 的默认 HTTP-client feature。
如果 host 也直接依赖这些 crate，应使用 `default-features = false`，避免 Cargo
feature unification 重新引入 reqwest 0.12。额外的 OAuth/OIDC 请求可使用
provider 的 adapter，或参考 [oauth2-reqwest 使用指南](https://docs.rs/oauth2-reqwest/0.1.0-alpha.3/oauth2_reqwest/)。

### Host 自定义 Rust HTTP Client

Rust host 可通过以下新增入口传入并消费 `reqwest::ClientBuilder`：

- `OAuthProviderRuntime`、`OidcClient`、`OAuthResourceServerVerifier`：`from_config_with_http_client_builder(config, builder)`。
- `BackendOidcModeRuntime`、`AccessTokenSubstrateRuntime`：`from_resolved_config_with_http_client_builder(config, builder)`。
- `RealIpResolver`：`from_config_with_http_client_builder(config, builder)` 与 `from_config_with_factories_and_http_client_builder(config, &factories, builder)`。
- `CidrNodeRegistry`：对应的 `from_configs_with_http_client_builder` 与 `from_configs_with_factories_and_http_client_builder`，参阅 [Real-IP HTTP transport](006-REALIP.md#host-自定义-http-transport)。

原有构造方法保留，使用默认 builder 委托新路径。不新增 TOML 或环境变量证书字段。认证关闭或 Real-IP registry 没有内置远程文件节点时，不构建未使用的 builder。Kubernetes/Docker 保留原生配置；propagation 的 axum-reverse-proxy、server 入站 TLS 和浏览器 SDK transport 不受影响。

```rust
// The host loads certificates; identity.pem contains the client certificate
// chain and private key, not a CA bundle.
let roots = reqwest::Certificate::from_pem_bundle(&std::fs::read("ca.pem")?)?;
let identity = reqwest::Identity::from_pem(&std::fs::read("identity.pem")?)?;
let builder = reqwest::Client::builder()
    .tls_certs_merge(roots)
    .identity(identity)
    .proxy(reqwest::Proxy::https("http://proxy.example.com:8080")?)
    .timeout(std::time::Duration::from_secs(15));
let provider = std::sync::Arc::new(
    OAuthProviderRuntime::from_config_with_http_client_builder(provider_config, builder).await?
);
let oidc = OidcClient::<MokaPendingOauthStore>::from_provider(provider.clone(), oidc_config).await?;
let verifier = OAuthResourceServerVerifier::from_provider(provider, verifier_config).await?;
```

`tls_certs_merge` 将指定根证书加入平台信任；需要隔离信任集合时改用 `tls_certs_only(roots)`。默认 TLS 继续使用 rustls；host 可启用对应 reqwest feature 后在 builder 上选择 backend。identity 只配置 TLS 客户端身份，不代表新增 OAuth `tls_client_auth`/`self_signed_tls_client_auth` 方法或 certificate-bound token 校验。host 应保护私钥，不得通过 frontend projection 或日志暴露；不要为了私有 CA 关闭证书/域名校验。

builder 只消费一次。provider 的 discovery、JWKS、refresh、token、userinfo、introspection、device 和 revocation 请求共用构建后的 client 及 OAuth adapter 连接池。通过 `from_provider` 共享 provider 也会共享缓存；分别调用便捷构造方法会分别创建 provider。TLS identity 与 default header 应用于该 provider 的全部 endpoint；不同信任域应使用独立 runtime。

OAuth provider 构建前始终用 `Policy::none()` 覆盖 builder 的 redirect policy，其他设置保留。非法配置在 build 前拒绝，build 失败沿用现有错误类型。一般 Real-IP 远程文件请求保留 host/default redirect policy，不继承 OAuth 的禁止重定向规则。

## Principal 和 Token 边界

authenticated principal 表示 session/token-set user-facing state 中已登录的人。
`ResourceTokenPrincipal` 表示已验证 bearer token 的 authorization facts：subject、
issuer、audience、scope、authorized party 与 claim。二者相关但不可互换。
raw token material、authorization header、password、provider/client secret 不得进入
safe principal claim。

## Host Configuration

Rust host 分阶段解析配置：

1. serde-facing raw configuration 接收 file/environment input。
2. crate-owned config source 应用 shared OIDC default 和 host validator。
3. resolved configuration 构造 reusable runtime。

host 将 route path、source key、account binding、display data 等 product-specific policy 放在 reusable config projection 之外。redirect target 必须经过 host policy 验证；任何 auth context 都不接受未检查的任意 redirect URL。

---

[English](../en/020-AUTH_CONTEXT_AND_MODES.md) | [中文](020-AUTH_CONTEXT_AND_MODES.md)
