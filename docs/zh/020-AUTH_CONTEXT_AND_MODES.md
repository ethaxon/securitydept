# 认证上下文与模式设计

> 本文档统一定义 securitydept 认证栈中的 `auth context`、`zone`、`mode`、以及相关产品面与权威边界。  
> 它替代原先分散的认证上下文、basic-auth zone、OIDC mode family 三份文档。

## 1. 核心分层

securitydept 认证栈需要分成两层来理解：

- **底层能力层**
  - `securitydept-creds`
  - `securitydept-creds-manage`
  - `securitydept-oidc-client`
  - `securitydept-oauth-resource-server`
  - `securitydept-oauth-provider`
- **应用集成层**
  - `basic-auth-context`
  - `session-context`
  - `token-set-context`

底层能力层解决的是：

- 如何获取 credential / token
- 如何校验 bearer
- 如何刷新 metadata / JWKS
- 如何表达 redirect、transport、pending OAuth state 等协议原语

应用集成层解决的是：

- 当前认证用户是谁
- 认证状态存放在哪里
- 前端/后端分别承担什么 runtime 和 authority
- 应用如何登录、恢复、刷新、登出、传播 bearer

## 2. 术语定义

### 2.1 `auth context`

`auth context` 是面向应用的顶层认证集成面。  
它定义：

- 认证状态的 ownership model
- 前后端的职责分工
- redirect / persistence / transport / principal 的高层 contract

当前正式的 auth context 只有三个：

- `basic-auth-context`
- `session-context`
- `token-set-context`

### 2.2 `zone`

`zone` 不是独立 auth context，也不是 mode。  
`zone` 只属于 `basic-auth-context`，用于描述：

- 哪些路由/区域属于同一 Basic Auth challenge boundary
- 该区域的 login / logout / post-auth redirect 规则
- 可选的 `real_ip_access` 限制

### 2.3 `mode`

`mode` 也不是独立 auth context。  
`mode` 只属于 `token-set-context`，用于描述该 context 内部的 OIDC integration shape。

当前 `token-set-context` 只有两个正式 mode：

- `frontend-oidc`
- `backend-oidc`

其中 `backend-oidc-pure` 与 `backend-oidc-mediated` 不再被读成与 `frontend-oidc` 并列的一级 mode；它们是 `backend-oidc` 内部的 preset / profile。

### 2.4 Public Surface 与 ownership boundary

在本项目中还要区分两类结构：

- **public surface**：外部 adopter 直接接入的 crate / package / subpath / module
- **ownership boundary**：哪个模块或逻辑层负责生成或解释某类 config / contract / runtime policy

对 `token-set-context` 尤其重要：

- TS public surface：`token-set-context-client` 及其 mode-aligned / shared subpath family
- Rust public surface：canonical target 应收口到 `securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_mode, access_token_substrate, orchestration, models}`；当前代码仍处于 `backend_oidc_pure_mode` / `backend_oidc_mediated_mode` 过渡拆分期
- Rust ownership boundary：内部仍可区分 mode-specific contract authority 与 shared runtime substrate ownership，但这不应继续主导一级 public path

## 3. Auth Context 总览

| Auth Context | 适用场景 | 状态 ownership | 内部细分 | 主要产品面 |
|---|---|---|---|---|
| `basic-auth-context` | 浏览器原生 Basic Auth 可接受、OIDC 过重的场景 | 浏览器凭证缓存 + challenge route | `zone` | Rust: `securitydept-basic-auth-context`；TS: `basic-auth-context-client` |
| `session-context` | 集中式服务、BFF、弱前端能力 | 后端 session store + HTTP-only cookie | 无 mode family | Rust: `securitydept-session-context`（route helper 已通过 `service` feature 直接展露）；TS: `session-context-client` |
| `token-set-context` | 强前端能力、分布式 SPA、前后端共同参与 OIDC | 由具体 mode 决定 | `frontend-oidc` / `backend-oidc`（presets: `pure`, `mediated`） | Rust: `securitydept-token-set-context`；TS: `token-set-context-client` |

这里的关键层级必须保持稳定：

- `zone` 归属于 `basic-auth-context`
- `mode` 归属于 `token-set-context`
- `session-context` 本身不是 mode family

## 4. `basic-auth-context`

### 4.1 角色

`basic-auth-context` 是最小的 auth context。  
它不依赖 OIDC，也不参与 token-set mode family。

它主要组合：

- `securitydept-creds`
- `securitydept-creds-manage`
- 可选的 `securitydept-realip`
- 可选的 server route helper
- 可选的 `basic-auth-context-client`

### 4.2 Zone 模型

`basic-auth-context` 的内部结构应理解为：

- 全局 basic-auth context 设置
- 一个或多个 `zone`
- 每个 zone 自己的 challenge / login / logout / post-auth redirect 规则
- 每个 zone 可选的 `real_ip_access`

因此，`basic auth zone` 应始终被读成：

- `basic-auth-context` 的内部划分方式

而不是：

- 单独的 auth context
- 独立于 `basic-auth-context` 的文档主题

### 4.3 推荐 UX 模式

现代 SPA 不应让普通 API 请求意外弹出浏览器的 Basic Auth 对话框。  
推荐行为是：

- 普通 JSON API 返回 `401`，但**不带** `WWW-Authenticate`
- 专门的 challenge route 返回 `401`，并带 `WWW-Authenticate: Basic`
- challenge 成功后重定向回应用

这样浏览器原生对话框就是显式进入，而不是被任意 API 响应意外触发。

### 4.4 Logout 限制

浏览器没有标准 JavaScript API 用于清除缓存的 Basic Auth 凭证。  
因此 `basic-auth-context` 需要接受这一现实：

- logout 往往仍要依赖经典的 credential poisoning 技巧
- 向专门 logout route 发送故意无效的 Basic Auth 凭证
- 返回 `401` 且不带 `WWW-Authenticate`
- 让浏览器静默替换缓存凭证

### 4.5 客户端 helper 范围

`basic-auth-context-client` 应保持轻量。  
它只需要帮助处理：

- zone-aware 的 `401 -> login` 重定向
- logout URL / logout helper

它不应演化成新的大前端 runtime。

## 5. `session-context`

### 5.1 角色

`session-context` 是有状态、cookie-based 的 auth context。  
它适用于：

- 集中式服务
- BFF
- 弱前端能力

### 5.2 Ownership 模型

在 `session-context` 下：

- OIDC login / callback 由后端处理
- 后端存储或管理认证上下文
- 浏览器主要携带 HTTP-only session cookie
- `me` endpoint 返回规范化 principal

这里没有 `mode family` 概念。  
它是一个独立的 auth context，而不是 `token-set-context` 的某个 mode。

### 5.3 主要组合

`session-context` 主要组合：

- `securitydept-oidc-client`
- `securitydept-session-context`
- `service` feature：`SessionAuthServiceTrait`、`OidcSessionAuthService`、`DevSessionAuthService`（已直接归属于此 crate）
- 可选的 `tower-sessions-*` store
- 可选的 TS login redirect helper

### 5.4 Redirect 目标约束

`post-auth redirect` 不应直接接受未经限制的原始重定向字符串。  
它应继续沿用共享的 redirect-target restriction model。

长期方向是：

- route-facing session service 已直接回到 `securitydept-session-context`(`service` feature）
- `securitydept-auth-runtime` 不再作为 `session-context` 的正式产品面出现在 adopter 文档里

## 6. `token-set-context`

### 6.1 角色

`token-set-context` 是同时覆盖前端 token runtime、后端 OIDC runtime、以及跨边界 transport contract 的 auth context。

它不是旧“token-set flow”的别名。  
更准确地说：

- `token-set-context` 是顶层 auth context
- 它内部承载 OIDC mode family

### 6.2 Public Surface 与 ownership boundary

`token-set-context` 当前应读成两层：

| 面 | 入口 | 职责 | 当前状态 |
|---|---|---|---|
| TS 前端 runtime 面 | `token-set-context-client` | 统一前端 mode-aligned subpath / adapter / runtime surface | 已存在；当前实现仍拆成 `/backend-oidc-pure-mode` 与 `/backend-oidc-mediated-mode`，canonical target 是 `/backend-oidc-mode` |
| Rust crate public surface | `securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_mode, access_token_substrate, orchestration, models}` | 顶层 `*_mode` + shared modules 的 adopter-facing 结构 | canonical target 已明确；当前代码仍以 `backend_oidc_pure_mode` / `backend_oidc_mediated_mode` 过渡拆分 |
| Rust ownership boundary | mode-specific config / contract ownership + shared runtime substrate ownership | 解释“谁负责什么”的内部逻辑边界 | 真实存在，但不应继续充当一级 public namespace |

这里最重要的判断是：

- `securitydept-token-set-context` 不能再被读成“只有 backend 的后端 crate”
- Rust public API 更适合直接暴露顶层 `*_mode` 与 shared modules，而不是先让 adopter 理解 `frontend` / `backend` 一级分叉
- “后端不运行某个前端 flow”不等于“Rust crate 不需要对应的 mode module 与 contract authority”

当前的结构是：

- `backend-oidc` 才是长期的 backend OIDC mode；当前代码仍以 `backend-oidc-pure` / `backend-oidc-mediated` 两个 preset-specific module 暂时承载它
- OIDC 协议级流程（authorize / callback / refresh / exchange）由 `OidcClient` 统一提供；两个 backend mode 共享的 identity extraction（principal / issuer）已下沉到 `securitydept-oidc-client::auth_state`
- backend-oidc runtime 层负责 capability-specific post-processing（sealed refresh vs plain、metadata redemption、redirect policy 等）
- `backend-oidc` 应提供显式 `user_info` exchange contract：请求体提交 `id_token`，请求头提交 bearer `access_token`
- 但这条 `user_info` 的协议组合能力更适合下沉到 `securitydept-oidc-client`：解析 `id_token` claims（server-side 路径可跳过 `nonce` 校验）、调用 userinfo、运行 `check_claims`
- mode 层自己只保留 endpoint owner、request/response contract，以及 route / auth / policy 归属
- `frontend-oidc` 没有 backend runtime，但已拥有正式的 mode-qualified config projection 与 integration contract

### 6.3 Canonical mode 与 preset/profile

`token-set-context` 内部当前应只使用这两个正式 mode：

| Mode | 谁运行 OIDC flow | TS canonical subpath | Rust authority / runtime |
|---|---|---|---|
| `frontend-oidc` | 前端（浏览器） | `/frontend-oidc-mode` | `securitydept-token-set-context::frontend_oidc_mode` |
| `backend-oidc` | 后端 | `/backend-oidc-mode` | `securitydept-token-set-context::backend_oidc_mode` |

当前代码仍保留以下过渡实现形状：

- `/backend-oidc-pure-mode`
- `/backend-oidc-mediated-mode`
- `securitydept-token-set-context::backend_oidc_pure_mode`
- `securitydept-token-set-context::backend_oidc_mediated_mode`

但它们应被理解为：

- `backend-oidc` 的 preset-specific 过渡入口
- 而不是长期并列的一级 mode

不再接受这些旧 public naming 作为 canonical shape：

- `/token-set`
- `/oidc`
- `/oidc-mediated`

#### 6.3.1 `backend-oidc` 的 preset/profile

`backend-oidc` 当前至少需要稳定承接两组 preset：

| Preset / Profile | 语义 | 默认能力组合 |
|---|---|---|
| `pure` | 最小后端 OIDC baseline | `refresh_material_protection = passthrough`、`metadata_delivery = none`、`post_auth_redirect_policy = caller_validated` |
| `mediated` | 带 custody / policy augmentation 的后端 OIDC | `refresh_material_protection = sealed`、`metadata_delivery = redemption`、`post_auth_redirect_policy = resolved` |

这些 preset 是推荐能力组合，不是额外一级 mode 名。

#### 6.3.2 `backend-oidc` 的能力轴

`backend-oidc` 不应再被做成“两套 mode + 两套 API 形状”，而应收口为单一 capability framework。当前最重要的能力轴是：

- `refresh_material_protection`
  - `passthrough`
  - `sealed`
- `metadata_delivery`
  - `none`
  - `redemption`
- `post_auth_redirect_policy`
  - `caller_validated`
  - `resolved`
- `token_propagation`
  - `enabled`
  - `disabled`
- `user_info_support`
  - `enabled`

其中需要明确：

- `metadata_redemption` 与 `user_info` 不是互斥替代关系，而是正交能力
- `backend-oidc-pure` / `backend-oidc-mediated` 只是上述能力轴上的两组推荐 preset
- 允许渐进增强，但不允许无约束的任意拼装；最终 canonical config 应提供 capability validation

### 6.3.1 路由层 service 归属方向

参考服务器现已直接通过各 owning crate 使用这些 route helper：

- `BackendOidcMediatedModeAuthService`（原 `TokenSetAuthService`）→ `securitydept-token-set-context::backend_oidc_mediated_mode`
- `AccessTokenSubstrateResourceService`（原 `TokenSetResourceService`）→ `securitydept-token-set-context::access_token_substrate`
- `SessionAuthServiceTrait` / `OidcSessionAuthService` / `DevSessionAuthService` → `securitydept-session-context`（`service` feature）

`securitydept-auth-runtime` 聚合层已解散并从工作区移除。

### 6.4 共享 OIDC 配置权威

`OidcSharedConfig` 应被读成整个 `token-set-context` Rust public surface 的共享 OIDC config authority，而不是 backend-only helper。

它同时服务于：

- backend runtime/config resolve
- frontend config projection

在单一 OIDC provider 同时服务多个角色的部署中，应继续允许通过 `[oidc]` alias block 共享 provider connectivity 配置，例如：

```toml
[oidc]
well_known_url = "https://auth.example.com/.well-known/openid-configuration"

[oidc_client]
client_id = "my-app"
client_secret = "secret"
redirect_url = "/auth/callback"

[oauth_resource_server]
audiences = ["api://my-app"]
required_scopes = ["entries.read"]
```

共享的核心字段仍应包括：

- `well_known_url`
- `issuer_url`
- `jwks_uri`
- metadata / jwks refresh interval

而 `scopes`、`audiences`、`redirect_url` 这类语义明显依赖具体角色的字段，不应被混成统一共享默认值。

### 6.4.1 `backend-oidc` 配置面的统一方向

当前代码仍保留：

- `BackendOidcPureConfig` / `ResolvedBackendOidcPureConfig` / `BackendOidcPureConfigSource`
- `BackendOidcMediatedConfig` / `ResolvedBackendOidcMediatedConfig` / `BackendOidcMediatedConfigSource`

但 canonical 方向不应继续维持两套并列 config-source 入口。更合理的长期形状是：

- `BackendOidcModeConfig`
- `ResolvedBackendOidcModeConfig`
- `BackendOidcModeConfigSource`

其中 `BackendOidcModeConfigSource` 应允许 adopter 自行组合，而不是只暴露一个“整包 resolve”入口。至少应保留：

- `resolve_oidc_client`
- `resolve_oauth_resource_server`
- `resolve_user_info`
- `resolve_refresh_material_protection`
- `resolve_metadata_delivery`
- `resolve_post_auth_redirect_policy`
- `resolve_token_propagation`
- `resolve_all`

也就是说，配置面的统一目标是：

- 一套 backend-oidc capability config-source
- 多个可验证的 preset/profile
- 单一核心实现，而不是 pure / mediated 两份并行 config 体系

### 6.5 `frontend-oidc`

在 `frontend-oidc` mode 下：

- 浏览器通过 `oauth4webapi` 运行 authorize / callback / token-exchange
- Rust 后端不运行该 flow runtime
- 但 Rust 仍必须通过 `securitydept-token-set-context::frontend_oidc_mode` 投影前端可消费配置，以及 frontend-oidc 与 `access_token_substrate` 对接所需的 mode-specific integration contract

因此正确口径是：

- `frontend-oidc` 没有 backend runtime
- 但它**有**正式的 Rust mode module
- 这个 module 不再只是 config producer；当 `frontend-oidc` 也要接入 resource-server / propagation / forwarder 语义时，它必须同时定义 frontend-oidc 与 `access_token_substrate` 对接的 mode-qualified integration contract
- 这些 contract 应表达“前端获得的 token / auth-state material 如何被后端与 shared substrate 正式消费”，而不是把 `access_token_substrate` 本体重新挂到 mode module 下面

### 6.6 `backend-oidc`

`backend-oidc` 应被读成单一的后端 OIDC capability framework，而不是两套长期并列 mode：

- 后端运行标准 OIDC client + resource-server verifier
- OIDC 协议级流程（authorize / callback / refresh / exchange）由 `OidcClient` 提供
- 跨 preset 共享的 identity extraction（principal / issuer）下沉到 `securitydept-oidc-client::auth_state`
- mode runtime 层只负责 capability-specific augmentation（refresh material protection、metadata delivery、redirect policy 等）
- browser-facing callback / refresh canonical public contract 统一采用 fragment family
- `user_info` 是 `backend-oidc` 的正式能力面：请求体提交 `id_token`，请求头提交 bearer `access_token`
- `user_info` 背后的协议组合能力更适合下沉到 `securitydept-oidc-client`，由 `backend-oidc` 自己保留 endpoint owner、mode-qualified request/response contract，以及 route/auth/policy ownership

更准确地说，`backend-oidc` 应统一承载：

- code authorize
- callback
- refresh
- token exchange
- user-info / claims normalization integration
- 与 `access_token_substrate` 的边界

而 `pure` / `mediated` 只是对这些基础能力加上不同 capability bundle 的 preset。

#### 6.6.1 `backend-oidc` 与 preset 的边界

`backend-oidc` 的 canonical public surface 应收口到：

- TS：`/backend-oidc-mode`
- Rust：`securitydept-token-set-context::backend_oidc_mode`

当前代码仍暴露的：

- `/backend-oidc-pure-mode`
- `/backend-oidc-mediated-mode`
- `backend_oidc_pure_mode`
- `backend_oidc_mediated_mode`

都应被视为：

- preset-specific 过渡入口
- 为本轮统一核心实现服务的迁移形状

而不是长期稳定的一等 mode family。

#### 6.6.2 典型 preset

`backend-oidc` 目前至少有两组典型 preset：

- `pure`
  - `refresh_material_protection = passthrough`
  - `metadata_delivery = none`
  - `post_auth_redirect_policy = caller_validated`
- `mediated`
  - `refresh_material_protection = sealed`
  - `metadata_delivery = redemption`
  - `post_auth_redirect_policy = resolved`

它们的关系更准确地说是：

- `mediated` 是在 `backend-oidc` baseline 上增加 custody / policy augmentation
- 而不是另起一套长期并列 mode

### 6.7 当前实现过渡状态

当前实现仍保留 pure / mediated 两套 module 与 TS subpath，主要是为了渐进迁移：

- Rust：`backend_oidc_pure_mode` / `backend_oidc_mediated_mode`
- TS：`/backend-oidc-pure-mode` / `/backend-oidc-mediated-mode`

但下一步工作不应继续围绕“两边 API 形状保持同步”长期修补，而应直接收口为：

- 一套 `backend-oidc` 核心实现
- 一套 capability schema / validation
- 一套 frontend-facing canonical subpath
- pure / mediated 作为 preset/profile 或能力预配置继续存在

### 6.8 当前 root 级别的归类错误

`packages/token-set-context/src/` 下当前仍有一批材料被扁平放在 crate root，但概念上它们已经不属于 root generic capability：

| 当前材料 | 正确归属 |
|---|---|
| `runtime.rs`、`metadata_redemption/*`、`refresh_material.rs` | `backend-oidc` 的 preset-specific runtime domain（当前主要是 mediated preset） |
| `propagation/*`、`forwarder/*`、resource-server-facing access-token / downstream forwarding policy | `token-set-context` 内跨 mode 的 access-token substrate |
| `redirect.rs` 中 mediated-specific runtime / policy | `backend-oidc` 的 preset-specific runtime domain（当前主要是 mediated preset） |
| `transport.rs` 中的 query / payload / fragment / redemption request/response | `securitydept-token-set-context::backend_oidc_mode` cross-boundary contract |

因此：

- `metadata_redemption` 不是 root generic capability
- `BackendOidcMediatedModeRuntime` 也不应继续被读成长期一等 public mode runtime；它更准确地说是 `backend-oidc` 某个 preset 的 runtime augmentation
- `propagation` / `forwarder` 也不应再被绑死在 `backend-oidc-mediated`
- `transport.rs` 也不应长期留在“无归属 root contract”状态

### 6.9 Access-token substrate：resource-server、propagation、forwarder

在 `token-set-context` 内，存在一组不应再按具体 OIDC mode 归类的下游 access-token substrate：

- resource-server-facing access-token contract
- bearer propagation
- forwarding / same-resource proxy glue

这些能力的共同点是：

- 它们只关心 access token 是否存在、是否可验证、以及 `X-SecurityDept-Propagation`
- 它们不关心 access token 最初来自 `frontend-oidc`、`backend-oidc-pure` 还是 `backend-oidc-mediated`
- 它们可以被 `backend-oidc-mediated` 复用，但不属于该 mode 独占的 runtime 身份

因此当前合理边界是：

- propagation policy 由服务端配置拥有
- auth-state metadata 不再承载 propagation policy
- resource-token facts 不应混进前端 auth-state metadata
- resource-server / forwarder / propagation 的公共 contract 应在 `token-set-context` 内被提升为跨 mode substrate，而不是继续停留在 mediated-specific 目录语义下

运行时上应继续区分：

- `AuthenticatedPrincipal`
- `ResourceTokenPrincipal`
- `PropagatedBearer`
- `TokenPropagator`

`TokenPropagator` 负责：

- destination allowlist
- issuer / audience / scope / `azp` 校验
- `PropagatedBearer` 附加与验证

`TokenPropagator` 与上层 forwarder 都不是完整反向代理。  
未来推荐的 forwarder 应构建在这层 substrate 之上，而不是让它直接吸收 `Forwarded` / `X-Forwarded-*` 的完整代理职责。

同时，这层 substrate 也应与顶层 mode modules 正确对接：

- `securitydept-token-set-context::access_token_substrate` 负责 runtime policy、resource verification、forwarding policy 与 header attachment
- `securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_mode}` 分别负责各 mode 的 config / requirement / transport / integration contract
- `securitydept-token-set-context::orchestration` 与 `::models` 只承载 truly shared abstraction，不冒充具体 mode
- TS 前端产品面只消费其确实需要的 contract，不再把 mode-agnostic access-token substrate 误读成 mediated-only 能力

这里需要特别强调：

- 不应为了形式对称先造一个空的 shadow namespace 去镜像 `access_token_substrate`
- 也不应继续把 `frontend` / `backend` 当作一级 public namespace 来组织 adopter-facing 结构
- 当 `frontend-oidc` 要把获得的 access token 接到 resource-server / propagation / forwarder 语义上时，`securitydept-token-set-context::frontend_oidc_mode` 必须提供正式、mode-qualified 的 integration contract，去对接 `securitydept-token-set-context::access_token_substrate`

## 7. 共享抽象方向

未来跨 auth context 复用时，最值得保持清晰的抽象包括：

- `AuthenticatedPrincipal`
- `AuthenticationSource`
- `AuthTokenSnapshot`
- `AuthTokenDelta`
- `AuthStateMetadataSnapshot`
- `AuthStateMetadataDelta`
- `AuthStateSnapshot`
- `AuthStateDelta`
- `PendingAuthStateMetadataRedemption`

但这些抽象不应反向模糊层级：

- `zone` 仍只属于 `basic-auth-context`
- `mode` 仍只属于 `token-set-context`

## 8. 当前总体判断

当前认证设计最需要守住的不是更多术语，而是层级稳定：

- `auth context` 是顶层应用集成面
- `basic-auth-context` 内部才有 `zone`
- `token-set-context` 内部才有 `mode`；当前 formal mode 是 `frontend-oidc` 与 `backend-oidc`，pure / mediated 是 backend-oidc 的 preset
- `session-context` 是独立 auth context，不应被塞进 mode family

因此，后续文档、crate、TS subpath、public symbol 都应围绕这套层级收口，而不是继续让 `context`、`zone`、`mode` 在同一层级混用。

---

[English](../en/020-AUTH_CONTEXT_AND_MODES.md) | [中文](020-AUTH_CONTEXT_AND_MODES.md)
