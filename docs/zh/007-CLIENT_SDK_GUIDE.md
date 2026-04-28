# Client SDK 开发指南

本文是当前 TypeScript SDK surface 的 adopter-facing 权威文档，负责说明 package 边界、稳定入口、runtime 职责，以及 `0.2.0` / `0.3.0` 的范围分割。

它不承载 roadmap 历史或实现流水账。release backlog 与延期事项见 [100-ROADMAP.md](100-ROADMAP.md)，public surface migration 裁决见 [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)，真实下游 adopter 案例见 [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md)。

## 目标

SDK 为 browser、React、Angular 与 server-host adopter 提供显式 auth-context 入口，而不是把 reference app glue 产品化成 public API。当前 baseline 是 browser-owned token-set auth，加上 thin basic-auth/session helpers；mixed-custody、BFF、server-side token ownership 继续留在 `0.2.0` 范围之外。

## 当前范围与边界

当前 authority：

- `@securitydept/client` 拥有 foundation runtime primitives、persistence、cancellation、tracing 与 shared auth coordination。
- `@securitydept/basic-auth-context-client` 与 `@securitydept/session-context-client` 拥有 browser/server host 的 thin auth-context helpers。
- `@securitydept/token-set-context-client` 拥有 browser-owned token-set modes、registry lifecycle、access-token substrate vocabulary 与 OIDC mode entries。
- `@securitydept/client-react` / `@securitydept/client-angular` 拥有 shared framework-router glue。
- 各 auth-context React / Angular 包拥有本 family 的 provider、hook、DI 与 signal 集成。

非 authority：

- `apps/webui/src/api/*`、页面、文案、route table 与 diagnostics UI 是 reference-app glue。
- `~/workspace/outposts` 是 downstream calibration evidence，不是 SDK API 模板。
- provider 选择、chooser UI、产品流程语义与 app-local failure copy 仍属于 adopter。

## 顶层结论

- TypeScript 是 `0.2.x` 唯一 active SDK productization track。
- Framework adapter 保持 thin，并消费 shared core owner，不成为 framework-neutral behavior 的首个 owner。
- Public surface 变化必须同步 inventory、evidence、docs anchor 与 migration ledger。
- `0.2.0-beta.3` release prep 是 packaging、documentation、downstream-adopter router correctness 与 release readiness 工作，不新增 auth context。

## 术语与命名

- **auth context**：basic-auth、session、token-set 等面向部署的 family。
- **mode**：auth context 内的具体运行形态，例如 `frontend-oidc` 或 `backend-oidc`。
- **runtime capability**：host 提供的 transport、storage、clock、scheduler、trace sink、router 等依赖。
- **adapter**：framework-specific host integration layer。
- **reference app**：证据与示例，不是默认 owner。

## 打包风格

Package 应小而明确，并避免 import-time side effect。Root export 尽量承载 stable family contract；`/web`、`/server`、framework 与 router subpath 承载 host-specific glue，在更多证据出现前保持 provisional。

## 推荐仓库布局

Adopter 应把 SDK 使用集中在 auth boundary 附近：

```text
src/auth/
  runtime.ts
  tokenSet.ts
  routes.ts
  api.ts
```

不要把 `apps/webui` 目录结构复制成产品模板；只提取适合当前 host 的 SDK entry shape。

## TypeScript SDK 编码规范

### 枚举类字符串域

公共 string domain 使用 `export const Foo = { ... } as const` 加 `export type Foo = (typeof Foo)[keyof typeof Foo]`。

### 公共契约的命名常量

跨包复用的 telemetry、storage、route 或 error vocabulary 必须有命名常量。

### API 形状：options object 优先

公共函数的可选参数使用 `options` object。只有当第二个位置参数非常自明且不太可能扩展时，才保留 positional second argument。只要 public API 需要扩展，就把第二参数整体转成 options，即使这是 breaking change。

## Foundation 设计

Foundation layer 不是 auth product shell。它让各 family package 共享 runtime-safe contracts。

### 状态原语

State primitive 保持显式、host-owned、framework-neutral。Framework adapter 可暴露 hook/signal convenience，但共享状态 contract 仍由 foundation 或 family owner 持有。

### 事件原语

Event 应描述 machine-facing lifecycle fact。User-facing presentation 属于 host。

`@securitydept/client/events` 暴露 foundation event-stream traits 与 operator facade，供 token-set lifecycle telemetry 使用。Family package 对外应暴露 SecurityDept event traits；RxJS 是实现与 interop 细节，不应成为 adapter 必须依赖的主 contract。

### Transport

Transport 总是由 host 注入或选择。SDK package 不应假定全局 fetch 策略，除非是已文档化的 browser/server entry。

### Persistence

`@securitydept/client/persistence` 拥有 `RecordStore` 语义，包括通过 `take()` 完成 single-consume callback state。`@securitydept/client/persistence/web` 拥有 browser persistence adapters。

### Auth Coordination

`@securitydept/client/auth-coordination` 拥有 planner-host 与 requirement orchestration primitive。它是 headless 的：可以决定 required action，但不拥有 chooser UI、route copy 或产品流程语义。

### 配置系统

配置按三层阅读：

1. runtime/foundation capabilities
2. auth-context config
3. adapter/host registration glue

当前 baseline 不提供跨所有 family 的 global config DSL。

### 调度与统一输入源

Scheduling、cancellation、abort interop、visibility、storage、promise/signal helper 位于 foundation 与 web subpath。它们是共享 primitive，不是 stream DSL。

### 依赖注入

DI 属于 adapter concern。Core package 暴露显式 constructor/function；Angular DI 与 React Context 位于 adapter packages。

## Context Client 设计

### `basic-auth-context-client`

Basic-auth boundary helpers 的 stable root surface。`/web` 与 `/server` 提供 thin host helpers，React/Angular adapters 保持 host wrappers。

### `session-context-client`

Session login URL、post-auth redirect、user-info、logout 与 browser-shell convenience 的 stable root surface。Framework adapters 消费该 owner，不重复定义 session 语义。

### `token-set-context-client`

Browser-owned OIDC/token material flows 的 provisional token-set family。它拥有 `backend-oidc-mode`、`frontend-oidc-mode`、`orchestration`、`access-token-substrate` 与 `registry` entries。

## SSR / 服务端宿主支持

### `basic-auth-context` / `session-context`

Server-host adopter 应使用 dedicated `/server` helper entry 做 host-neutral request/response coordination。

### `token-set-context`

Server-side token ownership、BFF 与 mixed-custody 延期到 `0.3.0`。当前 SDK baseline 是 browser-owned token-set。

## 错误模型

SDK error 在需要时暴露 machine-facing code 与 host-facing recovery hint。Host copy 与 UI state 仍由 adopter 拥有。不要用不稳定的 `Error.message` 字符串做控制流。

## Cancellation 与资源释放

`@securitydept/client/web` 拥有 browser cancellation interop，包括 AbortSignal bridges。长生命周期 host 应显式接入 cancellation 与 disposal。

## Logging、Trace 与测试

`@securitydept/client` 拥有 SDK flows 使用的最小 trace event 与 operation-correlation primitives。`@securitydept/test-utils` 保持 experimental，且不是当前 beta 的 npm publish target。

## 构建、兼容性与 side effects

### 产物与兼容性

Package 面向现代 ESM host 与 TypeScript project references。Angular 包用 `ng-packagr` 构建；非 Angular SDK 包用 `tsdown` 构建。

### Polyfill

SDK package 不应静默安装 global polyfill。Runtime polyfill 决策属于 adopter。

### sideEffects / tree-shaking

Package 应保持 import-safe 与 side-effect-light。Registration side effect 属于显式 provider/adapter function。

## API 稳定性

### 当前 0.x 阶段的冻结语义

当前 canonical 语义如下：

| Stability | 含义 | Change discipline |
|---|---|---|
| `stable` | 已冻结的 adopter-facing surface | `stable-deprecation-first` |
| `provisional` | 已公开、可用，但仍允许在 migration discipline 下演进 | `provisional-migration-required` |
| `experimental` | 可快速迭代，不承诺稳定 | `experimental-fast-break` |

### 当前 Contract 快照

下表是当前 TS SDK public-surface authority snapshot。它必须与 `public-surface-inventory.json` 保持一致。

| Surface | Stability | Owner | Change discipline |
|---|---|---|---|
| `@securitydept/client` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/persistence` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/persistence/web` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/web` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/auth-coordination` | `provisional` | `foundation` | `provisional-migration-required` |
| `@securitydept/client/web-router` | `provisional` | `foundation` | `provisional-migration-required` |
| `@securitydept/basic-auth-context-client` | `stable` | `basic-auth-context` | `stable-deprecation-first` |
| `@securitydept/basic-auth-context-client/web` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/basic-auth-context-client/server` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/basic-auth-context-client-react` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/session-context-client` | `stable` | `session-context` | `stable-deprecation-first` |
| `@securitydept/session-context-client/web` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/session-context-client/server` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-react` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/client/events` | `provisional` | `foundation` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/backend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/backend-oidc-mode/web` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/orchestration` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/access-token-substrate` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/registry` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/web-router` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/test-utils` | `experimental` | `foundation` | `experimental-fast-break` |
| `@securitydept/basic-auth-context-client-angular` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-angular` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react/react-query` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react/tanstack-router` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-angular` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/client-react` | `provisional` | `shared-framework` | `provisional-migration-required` |
| `@securitydept/client-react/tanstack-router` | `provisional` | `shared-framework` | `provisional-migration-required` |
| `@securitydept/client-angular` | `provisional` | `shared-framework` | `provisional-migration-required` |

#### token-set-context-client Subpath Family 阅读方式

- `/backend-oidc-mode`：platform-neutral client/service/token-material entry。
- `/backend-oidc-mode/web`：browser redirect、callback、storage 与 bootstrap glue。
- `/frontend-oidc-mode`：browser-owned OIDC client mode 与 config projection materialization。
- `/orchestration`：protocol-agnostic token lifecycle 与 route requirement primitives。
- `/access-token-substrate`：access-token propagation vocabulary 与 substrate contract。
- `/registry`：shared multi-client lifecycle core。
- `/web-router`：token-set-specific raw Web Router helper，会在 redirect/block fallback 前调用 canonical auth barrier。

#### Capability Boundary Rules

- Framework router glue 属于 shared framework adapters。
- Browser token-lifecycle glue 属于 token-set family。
- App-local business API wrapper 不是 SDK public surface。
- Reference app 提供证据，但不单独定义 package ownership。

#### token-set-context-client 前端 subpath / abstraction split

Frontend adopter 应按层理解：foundation coordination、token-set mode/substrate/registry，然后才是 framework adapter。Token-set family 不是所有 frontend helper 的唯一 owner。

#### Config Projection Source Contract（`frontend-oidc-mode/config-source.ts`）

`frontend-oidc-mode` 拥有 projection-source precedence、validation、freshness、restore 与 revalidation。`createFrontendOidcModeBrowserClient()` 拥有 browser materialization；host 拥有 config endpoint wiring 与 page routes。

#### reference app 宿主证据（`apps/webui` / `apps/server`）

`apps/webui` 与 `apps/server` 证明当前 reference-app baseline：backend-mode 与 frontend-mode host split、keyed callback/readiness、React Query token-set management flows、route security、dashboard bearer access、browser harness report，以及 shared error/diagnosis consumption。

### Framework Router Adapters

Framework router adapter 由以下 package 拥有：

- `@securitydept/client-react/tanstack-router`
- `@securitydept/client-angular`

Canonical semantics：完整 matched-route chain aggregation、`inherit` / `merge` / `replace`、child-route serializable metadata、root-level runtime policy，且 SDK 不内建产品 chooser UI。

Angular token-set route handler 会收到包含 `attemptedUrl` 的 route unauthenticated context。启动 `frontend-oidc` 登录时，应使用这个值，或直接使用 `createFrontendOidcLoginRedirectHandler()`，确保被拦截的目标导航被记录为 `postAuthRedirectUri`。不要在 guard handler 内读取 Angular `Router.url` 作为回跳目标，因为此时 attempted navigation 尚未提交。已经启动整页外部 redirect 的 handler 不应再 resolve 为 `false`；SDK helper 会在启动 redirect 后返回永不 settle 的 guard result，避免 Angular 在页面离开前完成一次 in-app navigation cancel。

TanStack Router 的 `createSecureBeforeLoad()` 同样会向 unauthenticated handler 传入包含 `attemptedUrl` 的 context。对会发起整页外部 auth redirect 的 React/TanStack adopter，应使用 `createExternalRedirectBeforeLoadHandler()`，在 callback 中调用自己的 login client，并用 `context.attemptedUrl` 作为 `postAuthRedirectUri`。不要从 `window.location` 推断目标页；beforeLoad 执行时当前 document URL 也可能仍是旧路由。

### token-set-context-client v1 Scope Baseline

当前 `0.2.0` baseline 是 browser-owned token-set，包含 framework adapters、registry lifecycle、route orchestration、readiness、callback handling、reference-app proof 与 downstream adopter calibration。

baseline 之外：mixed-custody、BFF、server-side token ownership、更重的 chooser UI、非 TS SDK 产品化。

### Adopter 使用清单

#### 不应被当作 SDK Surface 的内容

- reference-app page component 与 UI copy
- `apps/webui/src/api/*` business wrappers
- adopter route table 与 page state
- 只服务单个 app 的 data shaping

#### 开始接入前的确认清单

1. 先选择 auth context。
2. 再选择 browser、framework 或 server-host entry。
3. 确认入口是 stable、provisional 还是 experimental。
4. 在依赖 token-set behavior 前，先接受当前 `0.2.0` / `0.3.0` 边界。

### Verified Environments / Host Assumptions

Verified 表示已有 focused evidence、reference-app proof 或 downstream-adopter proof；不代表覆盖所有 host。

当前证据覆盖 Node/browser foundation behavior、React 19、Angular、TanStack Router、raw Web Router、`apps/webui` 与 `outposts`。Host support 应通过 ECMAScript requirements、adapter capabilities 与真实 evidence 三层表达。

### 最小进入路径

#### 1. Foundation 入口：runtime 仍由宿主显式拥有

使用 `@securitydept/client` 获取 shared primitives。它不是产品级 auth shell。

#### 2. Browser 入口：`./backend-oidc-mode/web` 负责 browser glue

使用 `@securitydept/token-set-context-client/backend-oidc-mode/web` 接入 backend-owned OIDC/token-set browser flows。

#### 3. React 入口：独立 adapter 包拥有 Provider 与 hook wiring

使用：

- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

Provider config 服从三层模型：auth-context config、必要的 runtime capabilities、host registration glue。

#### 4. Angular 入口：thin DI wrapper 保持 canonical owner 边界

使用：

- `@securitydept/basic-auth-context-client-angular`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client-angular`

Layering rules：

- `provideBasicAuthContext({ config })`：仅 auth-context config。
- `SessionContextService.client`：auth-context behavior；Angular DI 拥有 host registration 与 transport injection。
- `provideTokenSetAuth({ clients, idleWarmup })`：Angular host registration；每个 client entry 仍拥有 auth-context config 与 runtime composition。
- `provideTokenSetBearerInterceptor(options?)` / `createTokenSetBearerInterceptor(registry, options?)`：具备 freshness-aware 语义的 bearer-header injection，使用 SDK options-object API 形式。注入 `Authorization` 前，interceptor 会调用 shared refresh barrier。带 refresh material 的 expired token 会先刷新再放行 protected request；没有可用 refresh material 的 expired token 不会被当作 stale bearer 注入，并且 auth state 会被清理。`BearerInterceptorOptions.strictUrlMatch` 控制 unmatched URL behavior：
  - 默认 `strictUrlMatch: false`：保留 single-client convenience fallback，会对 unmatched URL 注入 `registry.accessToken()`；仅当 host 只调用一个 registered backend 时使用。
  - `strictUrlMatch: true`：unmatched URL 不会收到 `Authorization` header。
  - multi-backend、multi-audience 或存在 third-party traffic 的 Angular adopter 必须使用 `strictUrlMatch: true`。
  - `TOKEN_SET_BEARER_INTERCEPTOR_OPTIONS` 已导出，可用于高级 DI/test override。

Freshness 由 token-set core 拥有，而不是由某个 framework adapter 单独修补。`ensureAuthForResource(options)` 是 route entry、resume reconciliation、authorized transport、interceptor 与 React Query request 的 canonical async barrier。它会发出 domain auth events、共享 coalesced refresh barrier，并可返回 `Authorization` header 与 opaque temporary token handle。Event payload 不得包含 raw access、refresh 或 ID token value；token handle 只是 descriptor，只能由 owning in-memory store 在有效期内反查。`authorizationHeader()` 仍是同步 fresh-or-null projection；`ensureAuthorizationHeader()` 是 canonical resource barrier 的兼容 wrapper。`AuthMaterialController` 没有协议层 refresh 能力，因此它的 `authorizationHeader` 与 `createTransport()` 使用 fresh-or-null projection：expired 或 invalid-expiry material 会返回 `null`，并在 `requireAuthorization: true` 时抛出 unauthenticated，而不是发送 stale bearer。`registry.accessToken()` 仍是同步 convenience，并会对 expired material 返回 `null`；需要让 request 等待 refresh 时，请使用 `registry.ensureAuthForResource({ key, needsAuthorizationHeader: true })`、`registry.ensureAccessToken(key)` 或 `registry.ensureAuthorizationHeader(key)`。不带 key 调用 async registry helper 只适用于当前恰好只有一个匹配/ready client 的场景，具体取决于 helper。

Browser-owned frontend/backend OIDC factory 现在默认挂载 page-resume reconciliation。Angular `provideTokenSetAuth(...)` 也会为 registry-managed browser client 默认安装同一层保护，包括那些在 `clientFactory` 中直接返回 `createFrontendOidcModeClient(...)` 的接法。浏览器从 hidden 回到 visible、`pageshow`、`focus` 或 `online` 时，client 会调用 `ensureAuthForResource({ source: "resume", forceRefreshWhenDue: true })`，并发出 resume requested/skipped/completed/failed events。这是恢复 barrier，不是交互式 login trigger：refresh 失败会沿 token-set client 的正常路径清理或保留状态，是否启动登录仍由 route/request handler 决定。只有 host 已经安装等价 lifecycle hook 时才对单个 client 设置 `resumeReconciliation: false`；测试或特殊 host 可以通过 `resumeReconciliationOptions` 传入自定义 browser target 或 throttle。

短 access-token lifetime 应通过 SDK-owned barriers 处理：persisted restore 会对已经进入 refresh window 的 material 强制 refresh；browser resume 会在 hidden tab、系统 sleep、bfcache 返回后 reconcile；Angular route aggregation 会先等待 `restorePromise` 和 `ensureAuthForResource({ source: "route_guard", forceRefreshWhenDue: true })`，再调用 unauthenticated handler；protected request 走 `ensureAuthForResource({ source: "http_interceptor" | "authorized_transport", needsAuthorizationHeader: true, forceRefreshWhenDue: true })`。TanStack Router host 应使用 `@securitydept/token-set-context-client-react/tanstack-router` 的 `createTokenSetSecureBeforeLoad()`；raw web host 应使用 `@securitydept/token-set-context-client/web-router` 的 `createTokenSetWebRouteAuthCandidate()`。两个 helper 都会在 redirect/block fallback 前调用 `ensureAuthForResource({ source: "tanstack_before_load" | "raw_web_router", forceRefreshWhenDue: true })`。

如果 downstream resource server 返回 `ExpiredSignature`，正确归因是后端拒绝正常：前端确实发送了过期 JWT，SDK/adopter 不应注入这个 bearer。先用下面片段诊断浏览器里是否有 refresh material，再判断是 IdP 未下发 refresh token，还是 refresh barrier 没有生效：

```ts
Object.entries(localStorage)
  .filter(([k]) => k.includes("outposts.web.auth"))
  .map(([key, raw]) => {
    try {
      const parsed = JSON.parse(raw);
      const tokens = parsed.value?.tokens ?? parsed.tokens;
      return {
        key,
        accessTokenExpiresAt: tokens?.accessTokenExpiresAt,
        hasRefreshMaterial: Boolean(tokens?.refreshMaterial),
      };
    } catch {
      return { key, parseError: true };
    }
  });
```

`hasRefreshMaterial=false` 时需要检查 IdP、requested scopes 与 refresh-token policy；即便如此，SDK 仍不得发送 expired access token。对 Authentik deployment，通常要确认已请求/允许 `offline_access`，并且 refresh-token rotation/lifetime 配置允许 browser client 持有可用 refresh material。`hasRefreshMaterial=true` 时，SDK 应在 route admission、page-resume recovery 或首个 protected request 前完成 refresh，或者把 client 推入 unauthenticated state；因此通过 SDK bearer interceptor 或 authorized transport 发送的请求不应再出现 `ExpiredSignature`。

#### 5. SSR / server-host 入口：dedicated `./server` helpers

使用：

- `@securitydept/basic-auth-context-client/server`
- `@securitydept/session-context-client/server`

不要在 server-hosted code 中导入 `/web` subpath。

### Provisional Adapter 维护标准

`./web`、`./server` 与 framework packages 按更严格的 provisional bar 维护：boundary 稳定、import-time behavior 安全、ordinary usage 不依赖 reference-app glue、focused evidence、真实 dogfooding、verified-environment claim 准确。

#### Provisional Adapter 晋升前 Checklist

| 条件 | 要求 |
|---|---|
| capability boundary 稳定 | 在持续 release window 内无 owner reshuffle |
| minimal entry 清晰 | 不依赖完整 reference page 也能解释 |
| ordinary usage 成熟 | 不依赖 app-local glue |
| focused evidence 完整 | lifecycle、regression、import-contract guardrail 存在 |
| verified environments 明确 | 不夸大 host validation |

#### 当前晋升就绪度（快照，非路线图）

| Adapter / Surface | 当前判断 |
|---|---|
| `@securitydept/client/web` | stable foundation-owned browser helper surface |
| `@securitydept/client/auth-coordination` | provisional；planner-host 与 matched-route-chain contract 已成立 |
| `@securitydept/client/web-router` | provisional；raw Web baseline 已成立 |
| `basic-auth-context-client/web` | provisional；thin browser convenience 已成立 |
| `session-context-client/web` | provisional；login redirect convenience 已成立 |
| `basic-auth-context-client/server` / `session-context-client/server` | provisional；SSR/server-host baseline 已成立 |
| `*-react` / `*-angular` adapter family | provisional；已有真实 reference-app/downstream proof，但没有 broad host matrix |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | provisional；keyed pending-state 与 single-consume callback semantics 已正式化 |
| `token-set-context-client-react/react-query` | provisional；canonical token-set groups/entries consumer path 已成立 |

## Raw Web Router Baseline（原生 Web 路由基线）

**Subpath**：`@securitydept/client/web-router`

Raw Web Router baseline 面向非 framework host。它优先使用 Navigation API，回退到 History API，并对完整 matched-route chain 只提交一次 planner-host evaluation。

## Shared Client Lifecycle Contract（共享客户端生命周期契约）

**Subpath**：`@securitydept/token-set-context-client/registry`

Registry 拥有 `primary` / `lazy` initialization priority、`preload`、`whenReady`、`idleWarmup`、`reset`，以及与 callback/readiness behavior 对齐的 keyed lookup。React 与 Angular adapter 消费这套 shared core。

## React Query Integration（React Query 集成）

**Subpath**：`@securitydept/token-set-context-client-react/react-query`

这是 token-set React consumer surface。它拥有 groups/entries read/write hooks、readiness queries、keyed hook ergonomics、freshness-aware authorization-header derivation、query-key namespace，以及 token-set management flows 的 canonical invalidation。它不是 login、refresh 或 runtime authority；request-time bearer injection 仍委托 token-set core refresh barrier。

## 示例与参考实现

### 真实参考实现

- `apps/server`：auth、propagation、route composition、server error/diagnosis proof。
- `apps/webui`：React/browser/multi-context auth shell、token-set reference page、dashboard、browser harness report 与 SDK dogfooding proof。

### 下游参考案例：Outposts

`~/workspace/outposts` 验证真实 Angular adopter 路径。它使用 `provideTokenSetAuth(...)` 加 `provideTokenSetBearerInterceptor({ strictUrlMatch: true })`，证明了面向 downstream `confluence` backend 的 strict URL-prefix bounded bearer injection。这个路径也用于校准 stale-token handling：SDK 必须在首个 protected Confluence request 前 refresh 或清理状态，而不是发送会被后端正确以 `ExpiredSignature` 拒绝的 expired bearer。其 app-local auth service 仍是 adopter glue，不是 SDK API 模板。

### 当前 Bundle / Code Split 判断

Bundle/code-splitting 是工程优化议题，不是当前 `0.2.0-beta.3` line 的 public-contract blocker。

### Demo 与 OIDC Provider

Demo 用于解释 contract。Provider 选择与 demo 页面不定义 package boundary，也不能替代 focused evidence。

## 对后续开发者与 AI Agents 的要求

- 不要把客户端 SDK 命名或实现成 `auth-runtime`。
- 不要让 framework adapter 反向污染 foundation package。
- 不要引入 import-time side effect 或默认 global polyfill。
- 不要把 reference-app 或 adopter glue 产品化为 SDK API。
- 不要把 mixed-custody / BFF / server-side token ownership 移入 `0.2.0` baseline。
- 修改 public surface、docs、examples、inventory 与 migration notes 时必须一起移动。

[English](../en/007-CLIENT_SDK_GUIDE.md) | [中文](007-CLIENT_SDK_GUIDE.md)
