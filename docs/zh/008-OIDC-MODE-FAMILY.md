# OIDC 模式家族设计

> 本文档定义了 securitydept 认证栈统一的 OIDC 模式家族术语和共享配置模型。
> 它取代了之前的"三驾马车"/"token-set"命名，用更清晰的跨前后端词汇。

## 1. OIDC 模式家族

认证栈支持三种集成模式，全部基于 OIDC/OAuth 2.0：

| 模式 | 谁运行 OIDC 流程 | Provider 交互 | 关键特征 |
|---|---|---|---|
| `frontend-oidc` | 前端（浏览器） | 直接 | 浏览器通过 `oauth4webapi` 处理 authorize/callback/token-exchange；后端只提供配置规则 |
| `backend-oidc-pure` | 后端 | 直接 | 后端运行标准 OIDC client；前端接收不透明 session 或 tokens |
| `backend-oidc-mediated` | 后端（经中介） | 通过后端隔离 | 后端运行增强版 OIDC，含 sealed refresh material、metadata redemption、post-auth redirect 规则；前端不直接接触 provider |

### 为什么替换"三驾马车"/"token-set"

- "三驾马车"偏前端视角，未覆盖后端侧
- "token-set"混淆了数据结构名与操作模式名
- 新术语清晰表达**谁运行 OIDC 流程**以及**provider 交互如何被中介**

### 产品面

| 产品面 | SDK / Crate | 角色 |
|---|---|---|
| **前端** | `token-set-context-client`（TS） | 所有 OIDC 模式的统一前端入口 |
| **后端** | `securitydept-token-set-context`（Rust） | 统一后端入口 — `backend::BackendOidcPureRawConfig` / `BackendOidcMediatedRawConfig` |

### 后端入口映射

| 模式 | 后端入口（通过 `token-set-context::backend`） | 说明 |
|---|---|---|
| `frontend-oidc` | （后端仅提供配置，不需要 mode-level 入口） | 后端返回前端可消费的 OIDC 配置规则 |
| `backend-oidc-pure` | `BackendOidcPureRawConfig::resolve_config()` | 标准 OIDC client + resource server |
| `backend-oidc-mediated` | `BackendOidcMediatedRawConfig::resolve_config()` | 增强版 OIDC：sealed refresh、metadata redemption、token propagation |

### 基础设施层（内部实现 crate）

| Crate | 职责 | 面向 Adopter？ |
|---|---|---|
| `securitydept-oauth-provider` | OIDC discovery、JWKS、metadata 刷新、`OidcSharedConfig` | 否 — 通过 `backend` 重导出 |
| `securitydept-oidc-client` | OIDC 授权码 / 设备流 | 否 — 通过 `backend` 重导出 |
| `securitydept-oauth-resource-server` | JWT 验证、introspection | 否 — 通过 `backend` 重导出 |
| `securitydept-utils` | 共享工具库 | 否 |

## 2. 共享 OIDC 配置模型

### 现状 — 已共享的部分

`securitydept-oidc-client` 和 `securitydept-oauth-resource-server` 已经都 flatten 了来自 `securitydept-oauth-provider` 的 `OAuthProviderRemoteConfig`：

```rust
// 已通过 securitydept-oauth-provider 共享
pub struct OAuthProviderRemoteConfig {
    pub well_known_url: Option<String>,   // OIDC discovery URL
    pub issuer_url: Option<String>,       // issuer 标识
    pub jwks_uri: Option<String>,         // JWKS 端点
    pub metadata_refresh_interval: Duration,
    pub jwks_refresh_interval: Duration,
}
```

### 设计：`oidc` alias block

在单 OIDC provider 同时服务两个角色的部署场景下，不应重复配置。`oidc` alias block 提供回退：

```toml
# 共享 OIDC provider 配置 — oidc-client 和 resource-server 在本地块缺省时读取
[oidc]
well_known_url = "https://auth.example.com/.well-known/openid-configuration"

# OIDC client 配置 — provider 字段从 [oidc] 读取，添加 client 专属字段
[oidc_client]
client_id = "my-app"
client_secret = "secret"
scopes = "openid profile email"
redirect_url = "/auth/callback"

# Resource server 配置 — provider 字段从 [oidc] 读取，添加验证器专属字段
[oauth_resource_server]
audiences = ["api://my-app"]
required_scopes = ["entries.read"]
# well_known_url 无需在此设置 — 运行时从 [oidc].well_known_url 继承
```

### 解析优先级（按字段类型分组）

不同字段类型的实际支持程度不同：

**URL 字段**（`well_known_url`、`issuer_url`、`jwks_uri`）：真实 presence-aware fallback — 本地有值则使用，否则从 `[oidc]` 回退，否则 None

**Credential 字段**（`client_id`、`client_secret`）：同样 presence-aware — 注意 resource-server 侧仅在 `introspection` 块已显式存在时注入，不自动创建

**Duration 字段**（`metadata_refresh_interval`、`jwks_refresh_interval`）：使用 sentinel heuristic（`0` 或默认值），无法区分"本地显式设为默认值"与"本地未配置"，**非**真实 presence-aware

### 哪些字段可通过 `[oidc]` 共享

| 字段 | 可共享？ | 原因 |
|---|---|---|
| `well_known_url` | ✅ | client 和 verifier 使用同一 provider |
| `issuer_url` | ✅ | 同一 issuer |
| `jwks_uri` | ✅ | 同一 JWKS |
| `metadata_refresh_interval` | ✅ | 运维参数 |
| `jwks_refresh_interval` | ✅ | 运维参数 |
| `client_id` | ⚠️ | 非纯 provider connectivity；但在单 provider 部署中，oidc-client 和 resource-server introspection 常用同值。可作为 `[oidc]` 共享默认值，需在 `OAuthProviderRemoteConfig` 之外单独解析。 |
| `client_secret` | ⚠️ | 同 `client_id` — 非纯 provider connectivity，但在单 provider introspection 部署中常共用。 |
| `scopes` | ❌ | Client 与 verifier 的 scope 语义不同 |
| `audiences` | ❌ | Verifier 专属 |
| `redirect_url` | ❌ | Client 专属 |
| `introspection.*` | ❌ | Verifier 专属 |

**按字段类型的规则**：
- **URL 字段**（`well_known_url`、`issuer_url`、`jwks_uri`）：真实 presence-aware fallback ✅
- **Credential 字段**（`client_id`、`client_secret`）：presence-aware，需单独解析；resource-server 侧只注入到已存在的 `introspection` 块 ⚠️
- **Duration 字段**（`metadata_refresh_interval`、`jwks_refresh_interval`）：可共享，但用 sentinel heuristic ⚠️
- **本地专属**（`scopes`、`audiences`、`redirect_url`、`introspection.*` 行为开关）：不共享 ❌

## 3. 实现：`backend` 模块

`securitydept-token-set-context::backend` 模块是统一的后端产品面。它重导出底层 crate 的基础设施类型，使 adopter 只需依赖一个 crate：

```rust
use securitydept_token_set_context::backend::{
    // 模式入口
    BackendOidcPureRawConfig, BackendOidcPureConfig,
    BackendOidcMediatedRawConfig, BackendOidcMediatedConfig,
    // 共享配置（重导出自 oauth-provider）
    OidcSharedConfig,
    // 基础设施类型（重导出）
    OidcClient, OidcClientConfig, OAuthResourceServerConfig,
    OAuthResourceServerVerifier, OAuthProviderRuntime,
    BackendConfigError,
};
```

两个模式入口遵循相同的 `resolve_config()` 模式：

```rust
// backend-oidc-pure：OidcClient + ResourceServer
impl<PC> BackendOidcPureRawConfig<PC> {
    pub fn resolve_config(self, shared: &OidcSharedConfig)
        -> Result<BackendOidcPureConfig<PC>, BackendConfigError>;
}

// backend-oidc-mediated：OidcClient + ResourceServer + MediatedContext
impl<PC, MC> BackendOidcMediatedRawConfig<PC, MC> {
    pub fn resolve_config(self, shared: &OidcSharedConfig)
        -> Result<BackendOidcMediatedConfig<PC, MC>, BackendConfigError>;
}
```

**已知限制**：Duration 字段（`metadata_refresh_interval`、`jwks_refresh_interval`）仍使用 sentinel heuristic。后续迭代应迁移到 `Option<Duration>`。

### 3.1 推荐加载路径

所有后端模式通过 `securitydept_token_set_context::backend` 进入：

**`backend-oidc-pure`**：

```rust
use securitydept_token_set_context::backend::{
    BackendOidcPureRawConfig, OidcSharedConfig,
};

let shared: OidcSharedConfig = /* from [oidc] */;
let raw: BackendOidcPureRawConfig<PC> = /* from config */;
let config = raw.resolve_config(&shared)?;
// config.oidc_client + config.oauth_resource_server 已就绪
```

**`backend-oidc-mediated`**：

```rust
use securitydept_token_set_context::backend::{
    BackendOidcMediatedRawConfig, OidcSharedConfig,
};

let shared: OidcSharedConfig = /* from [oidc] */;
let raw: BackendOidcMediatedRawConfig<PC, MC> = /* from config */;
let config = raw.resolve_config(&shared)?;
// config.oidc_client + config.oauth_resource_server + config.mediated_context
```

| 模式 | 入口 | 状态 |
|---|---|---|
| `backend-oidc-pure` | `backend::BackendOidcPureRawConfig::resolve_config()` | ✅ 就绪 |
| `backend-oidc-mediated` | `backend::BackendOidcMediatedRawConfig::resolve_config()` | ✅ 就绪 |

底层 crate API（`apply_shared_defaults()`、各自的 `resolve_config()`）继续保留，供高级场景使用。

## 4. `frontend-oidc` 后端角色

在 `frontend-oidc` 模式下，后端**不**自己运行 OIDC redirect/callback/token-exchange。后端职责：

1. 读取 OIDC provider 配置（从 `[oidc]` 或 `[oidc_client]`）
2. 返回配置规则响应给前端：
   ```json
   {
     "issuer": "https://auth.example.com",
     "client_id": "my-spa",
     "scopes": ["openid", "profile", "email"],
     "redirect_uri": "https://app.example.com/callback"
   }
   ```
3. 前端用此驱动 TS SDK `/oidc` 子路径的 `createOidcClient()`

## 5. `backend-oidc-mediated` — 原 "token-set" 的真正含义

`securitydept-token-set-context` 是统一的后端产品面。通过其 `backend` 模块，它为 `backend-oidc-pure` 和 `backend-oidc-mediated` **两种模式**都提供了入口。Mediated 模式的独特特性：

- **Sealed refresh material**：AEAD 加密的 refresh token 静态保护
- **Metadata redemption**：短期 redemption ID 用于 claim/source 元数据
- **Post-auth redirect 规则**：服务端控制的 redirect URI 解析
- **Token propagation**：下游服务调用的 Authorization header 注入

"token-set"描述的是*数据结构*（一组 token），不是*操作模式*。新模式名 `backend-oidc-mediated` 更好地表达了这个模式的独特性：后端中介所有 provider 交互，前端只通过 redirect fragment 接收处理后的 token。

[English](../en/008-OIDC-MODE-FAMILY.md) | [中文](008-OIDC-MODE-FAMILY.md)
