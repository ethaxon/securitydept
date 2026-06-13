# Client SDK 开发指南

本文是当前 TypeScript SDK surface 的 adopter-facing 参考文档，负责说明 package 边界、稳定入口、environment/controller 职责，以及当前 `0.3.x` 范围边界。

它不承载 roadmap 历史或实现流水账。release backlog 与延期事项见 [100-ROADMAP.md](100-ROADMAP.md)，public surface migration 裁决见 [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)，真实下游 adopter 案例见 [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md)。

## 目标

SDK 为 browser、React、Angular 与 server-host adopter 提供显式 auth-context 入口，而不是把参考应用胶水层产品化成 public API。当前 `0.3.x` baseline 是 browser-owned token-set auth，加上 thin basic-auth/session helpers；mixed-custody、BFF、server-side token ownership 继续留在 SDK baseline 之外。

## 当前范围与边界

SDK 拥有的内容：

- `@securitydept/client` 拥有 foundation environment primitives、persistence、cancellation、tracing 与 shared auth coordination。
- `@securitydept/basic-auth-context-client` 与 `@securitydept/session-context-client` 拥有 browser/server host 的 thin auth-context helpers。
- `@securitydept/token-set-context-client` 拥有 browser-owned token-set modes、registry lifecycle、access-token substrate vocabulary 与 OIDC mode entries。
- `@securitydept/client-react` / `@securitydept/client-angular` 拥有 shared framework-router glue；其中 `@securitydept/client-react` 额外拥有唯一 SDK React Context 与 shared signal/event bridge。
- 各 auth-context React / Angular 包桥接各自 family contract；React 包导出 injection token、provider factory、显式 callback/component helper，不再导出 domain-specific React Context / Provider / `useXxxContext()`。

不属于 SDK 的内容：

- `apps/webui/src/api/*`、页面、文案、route table 与 diagnostics UI 是 reference-app glue。
- `~/workspace/outposts` 是下游校准案例，不是 SDK API 模板。
- provider 选择、chooser UI、产品流程语义与 app-local failure copy 仍属于 adopter。

## 顶层结论

- TypeScript 是 `0.3.x` 唯一 active SDK productization track。
- Framework adapter 保持 thin，并消费 shared core owner，不成为 framework-neutral behavior 的首个 owner。
- Public surface 变化必须同步 inventory、聚焦型验证测试、docs anchor 与 migration ledger。
- 当前 `0.3.x` release-prep 主线仍是 packaging、documentation、downstream-adopter correctness 与 release readiness 工作，不新增 auth context。

## 术语与命名

- **auth context**：basic-auth、session、token-set 等面向部署的 family。
- **mode**：auth context 内的具体运行形态，例如 `frontend-oidc` 或 `backend-oidc`。
- **environment**：host composition root 创建并传递的依赖对象。它承载 `BaseTransportTrait`、`TimeTrait`、必需的 root `SpanTrait`、必需的 `TracingTrait`、可选 `IdleCallbackTrait`、`StorageTrait`、`RouterTrait`、`PageLifecycleTrait`、`PopupTrait` 等行为能力。Core client constructor 依赖也属于 environment，不是另一层 runtime object。
- **capability / trait**：helper 需要的最窄行为契约，例如 auth navigation 使用 `RouterTrait`。`window`、`document`、`location`、`history` 等原始 host object 是 adapter 输入，不是 core environment 字段。
- **client**：协议/领域行为对象，执行 auth、session、OIDC、token 或 resource 操作。
- **registry**：多 client 的 registration、ready/lazy lifecycle、keyed lookup、URL/callback discrimination 与 route/resource orchestration owner。
- **controller**：framework-neutral 的状态机/流程编排 owner，拥有 state/signal、in-flight coalescing/dedupe、dispose，以及 `resume()` / `refresh()` / `logout()` 等 command。
- **service**：host/framework facade 或更宽的 application service entry。Service 可以包装 controller，但不能重新定义 controller 的 state-machine 语义。
- **adapter**：framework-specific host integration layer。
- **参考应用**：证据与示例，不是默认 owner。

命名规则：依赖对象使用 `Environment` 或更窄的 `Capability` 后缀；状态/流程 owner 使用 `Controller`；framework facade 使用 `Service`；协议对象使用 `Client`；多 client lifecycle owner 使用 `Registry`。不要再为 dependency bag 或 state owner 引入新的 public `XxxRuntime` 名称。

## 打包风格

Package 应小而明确，并避免 import-time side effect。Root export 尽量承载 stable family contract；`/web`、`/server`、framework 与 router subpath 承载 host-specific glue，在宿主矩阵和验证覆盖进一步扩大前保持 provisional。

## 推荐仓库布局

Adopter 应把 SDK 使用集中在 auth boundary 附近：

```text
src/auth/
  environment.ts
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

Foundation layer 不是 auth product shell。它让各 family package 共享 environment-safe contracts。

### 状态原语

State primitive 保持显式、host-owned、framework-neutral。Framework adapter 可暴露 hook/signal convenience，但共享状态 contract 仍由 foundation 或 family owner 持有。

### 事件原语

Event 应描述 machine-facing lifecycle fact。User-facing presentation 属于 host。

`@securitydept/client` 暴露 foundation event-stream traits 与 operator facade，供 token-set lifecycle telemetry 使用。Family package 对外应暴露 SecurityDept event traits；RxJS 是实现与 interop 细节，不应成为 adapter 必须依赖的主 contract。

### Transport

Transport 按层显式建模。Foundation environment 持有 `BaseTransportTrait`；协议/bootstrap 使用方可以从 base transport 派生 `ExternalTransportTrait`；更高层资源流量可以通过 `createAuthorizedTransportFromBase(...)` 之类的 wrapper 派生 `ManagedTransportTrait`。std fetch adapter 的 canonical 入口是 `createBaseTransportForStdFetch(...)`，host creator 不应再各自创建自己的 fetch transport。

### Persistence

`@securitydept/client` 拥有 `StorageTrait` 语义，包括通过 `take()` 完成 single-consume callback state。`@securitydept/client/persistence/web` 拥有 browser persistence adapters。

### Auth Coordination

`@securitydept/client` 拥有 planner-host 与 requirement orchestration primitive。它们是 headless 的：可以决定 required action，但不拥有 chooser UI、route copy 或产品流程语义。

### 配置系统

配置按三层阅读：

1. foundation environments/capabilities
2. auth-context config
3. adapter/host registration glue

当前 baseline 不提供跨所有 family 的 global config DSL。

### 调度与统一输入源

Scheduling、cancellation、abort interop、storage、page lifecycle、promise/signal helper 位于 foundation 与 web subpath。浏览器 lifecycle 行为通过显式 EventStream source 暴露，并消费 host 提供的 capability；SDK helper 不应隐式发现 `window` 或 `document`。

### 统一依赖注入

`@securitydept/client` 现在是 framework-neutral DI authority。`SecuritydeptInjectorTrait` 是最小读取侧 contract，只表达 `get()`；consumer、React Context、以及其它 injector adapter 都围绕这个 duck type 工作。`SecuritydeptInjector` 是 SDK runtime/facade，负责 `resolveAndCreate()`、`fromParentInjector()`、显式 provider 解析、parent 继承、override 与 side-effect-free `has()` 诊断。

React 侧只允许一组 SDK Context，全部位于 `@securitydept/client-react`：`SecuritydeptContext`、`SecuritydeptProvider`、`useSecuritydeptContext()`。Domain React package 不再创建自己的 public Context/Provider/`useXxxContext()` surface，而是导出 injection token、provider factory、显式 callback/component bridge，以及可配合 `useReadableSignalValue()`、`useReplaySignalValue()`、`useInteropObservable()` 与 `useEventStream()` 的 signal/event bridge。

Angular DI 仍属于 adapter concern；framework-neutral host capability resolution 仍属于 foundation concern。Core client 继续消费 `FoundationEnvironment`；不直接绑定 client 的 helper 继续消费由 host composition root 创建的显式 typed environment object 或更窄 capability view。

Canonical foundation model：

- `FoundationEnvironment` 是扁平的 foundation client dependency environment，直接承载 `transport`、`time`、必需的 root `span`、必需的 `tracing`、必需的 `realmStorage`，以及可选的 `idleCallback`、`persistentStorage`、`sessionStorage`、`router`、`pageLifecycle` 与 `popup`。`realmStorage` 是限定在该 environment 所属 JavaScript realm 内的同步 `SyncStorageTrait`；除非 composition root 显式覆盖，否则每次 `createFoundationEnvironment()` 都会创建一个全新且相互隔离的内存 store。历史 `ClientRuntime` 命名已退役，不是 canonical vocabulary。
- `StorageTrait` 操作可以同步完成或返回 Promise；`SyncStorageTrait` 将所有返回值收窄为同步结果，因此结构上自然满足 `StorageTrait`。Storage adapter 可以通过 `storageEvent` 暴露逻辑 key 的变更事件；`StorageChangeEvent.origin` 用于区分同 context 的 `local` 变更和跨 context 的 `external` 变更，native event 过滤和 key prefix 还原由 host adapter 负责。
- `NativeWebEnvironment` 是 canonical 的浏览器页面 environment，在 foundation 环境之上表达 `router`、`PageLifecycleTrait`、`PopupTrait` 等 host-owned page capability；它不暴露 `window.location` 或 `window.history`，也不再在顶层镜像 router 方法。
- `WebExtCoreEnvironment` 是高于 foundation 层的共享 extension-core environment。`WebExtBackgroundEnvironment` 是 background-script 特化，`WebExtPageEnvironment` 则是 extension-core capability 与 `NativeWebEnvironment` 的组合。
- `ServiceWorkerEnvironment` 是高于 foundation 层的 service-worker 特化。
- Helper 应索取最窄行为 trait，例如 `RouterTrait`、`PopupTrait` 或 `Pick<FoundationEnvironment, "transport" | "sessionStorage">`，而不是默认接受完整 environment。
- `environment.runtime` 以及历史 runtime/derive helper 命名是已退役的历史命名。新的 public API 与文档必须使用 `FoundationEnvironment`、`createFoundationEnvironment()`，或直接传递结构化覆盖关系中的 `FoundationEnvironment` / `NativeWebEnvironment`。
- 承载 environment-like dependency source 的 public option key 应继续叫 `environment`；实际需要的 capability 由类型表达，不引入 `pageEnvironment` 这类并行 key。

概念划分：

| 概念 | 拥有 | 不拥有 | 命名 |
|---|---|---|---|
| Environment | host dependencies 与 capabilities | 业务 lifecycle state machine | `FoundationEnvironment`、`NativeWebEnvironment`、`WebExtCoreEnvironment` |
| Trait | 最小行为依赖视图 | 无关 host dependencies | `RouterTrait`、`StorageTrait`、`PopupTrait` |
| Client | 协议/领域操作 | framework lifecycle 或 DI | `SessionContextClient`、`BackendOidcModeClient` |
| Registry | 多 client registration/readiness/discrimination | UI policy 或 framework state | `TokenSetClientRegistry`、`TokenSetClientRegistryService` |
| Callback handler | client-owned callback input、执行、取消与 Resource 状态 | registry selection 或 framework rendering | `client.callback` |
| Service | framework/host facade over clients | 重复定义 core state semantics | `SessionContextService` |

不要把这些对象设计成 DI container、service locator、provider tree、global singleton 或 business config DSL。`baseUrl`、`sourceKey`、account binding、product route 等 auth-context config 仍属于 family config 或 host code，不进入 foundation environment。

### Foundation Web environment factory

Foundation Web environment factory 是显式 composition helper，不是自动 host detection：

| Factory | 返回 | Page capability | 默认 Web storage | 目标 host |
|---|---|---:|---:|---|
| `createEnvironmentForNativeWeb({ location, history, ...options })` | `NativeWebEnvironment` | 仅 host adapter 内部 | 是 | real browser page、tab 或 popup document |
| `createEnvironmentForWebExtBackgroundScript(options)` | `WebExtBackgroundEnvironment` | 否 | 显式传入 extension storage 时可用 | extension background script |

不要使用字符串驱动的 `createEnvironmentFromPreset(name)`、preset-only wrapper factory 或 global-shape detection 猜测 host。Core client 不读取 `window`、`document`、`location` 或 `history`；只有 `createRouterForNativeWeb()`、`createPageLifecycleForNativeWeb()`、`createPopupForNativeWeb()`、`createEnvironmentForNativeWeb()` 这类显式命名 host adapter 可以在调用者未传入 host object 时读取 native global。`NativeWeb` 表示具备 native navigation/location/history 能力的普通浏览器页面宿主；worker-like host 应使用 `createFoundationEnvironment()` 或更具体的 host factory。

当 host 需要在 routes、commands 或 framework adapter 之间使用 environment capability 时，应在 composition root 创建一个显式 environment，并通过 framework bridge 传递这个对象。React 侧将 `environment.injector` 作为根 `SecuritydeptProvider` 的 `parentInjector` 传入，再用 `useSecuritydeptContext().get(ENVIRONMENT_TOKEN)` 读取；Angular 侧通过 `provideEnvironment({ environment })` 提供同一个对象。SDK 不再暴露单独的分层 environment resolver：`NativeWebEnvironment` 在类型上覆盖 foundation `FoundationEnvironment`，而 `WebExtUIEnvironment` 在结构上组合 WebExt core 与 native-web page capability。

该规则不只适用于 `@securitydept/client`：context package 与 framework adapter 的 public helper 也必须使用同一边界。任何会读取 host globals、执行 page navigation、构造 client，或拥有 transport/store/time wiring 的 helper，都应接收 environment 或窄 capability view。Provider、DI 与顶层 adapter registration API 可以作为 composition root 接收完整 environment；普通 hook、guard、interceptor、service 与 convenience helper 不应各自重复声明完整 dependency bag。

## Context Client 设计

### `basic-auth-context-client`

Basic-auth boundary helpers 的 stable root surface。`/web` 与 `/server` 提供 thin host helpers，React/Angular adapters 保持 host wrappers。

### `session-context-client`

Session login URL、post-auth redirect、user-info、logout 与 browser-shell convenience 的 stable root surface。`SessionContextController` 是 user-info refresh、logout cleanup 与 redirect helpers 的 framework-neutral state owner。Framework adapter 只通过 hook、DI、signal 或 observable 桥接这个 controller，不重复定义 session 语义。

### `token-set-context-client`

Browser-owned OIDC/token material flows 的 provisional token-set family。它拥有 `backend-oidc-mode`、`frontend-oidc-mode`、`orchestration`、`access-token-substrate` 与 `registry` entries。每个 OIDC mode client 自己拥有 callback 状态与 router input 提取能力，registry 只负责解析匹配的 client；framework adapter 应桥接这些 contract，而不是成为 callback state machine。

## SSR / 服务端宿主支持

### `basic-auth-context` / `session-context`

Server-host adopter 应使用 dedicated `/server` helper entry 做 host-neutral request/response coordination。

### `token-set-context`

Server-side token ownership、BFF 与 mixed-custody 仍在当前 `0.3.x` SDK baseline 之外。当前 SDK baseline 是 browser-owned token-set。

## 错误模型

公开异步流程使用 `ClientError` 作为 canonical runtime exception。调用方应以 `kind`、domain-namespaced `code` 与 `recovery` 做控制流；`cause` 仅用于诊断。未知错误在 client operation boundary 通过 `ClientError.fromUnknown(...)` 归一化，已有 `ClientError` 保持原样。

用户文案必须来自显式安全 `presentation`、domain code presentation map 或 foundation generic kind copy。`readErrorPresentationDescriptor()` 不展示 runtime `Error.message`。Events 与 tracing 使用不含 message 的 `ErrorSummary`；Resource snapshot 可以保留原 error object。Host copy 与 UI state 仍由 adopter 拥有。

## Cancellation 与资源释放

`@securitydept/client` 拥有对 WHATWG AbortSignal 对齐的 event bridge 与 foundation-to-AbortSignal bridge，而 `@securitydept/client/web` 仅保留 native-web 的 `AbortSignal -> CancellationTokenTrait` convenience bridge。长生命周期 host 应显式接入 cancellation 与 disposal。

## Logging、Trace 与测试

`@securitydept/client` 拥有 SDK flows 使用的最小 tracing runtime、event 与 subscriber primitives。`@securitydept/test-utils` 保持 experimental，且不是当前 beta 的 npm publish target。

Span correlation 与 operation lifecycle 使用不同 contract：

- `SpanTrait` 只是一层显式 correlation/context node，负责 identity、parent linkage、只读 attributes 与 `fork()`；它不是 tracing backend，也不暴露 public `end()` contract。
- `TracingTrait` 是 canonical 的 tracing runtime contract，负责 `record(event)` 与 hot、non-replay 的 `events` stream，供下游 subscriber 消费。
- `OperationSpanTrait extends SpanTrait`，它才是 canonical 的 operation lifecycle primitive。`runOperation(...)` 会 fork 一个 child span，把这个 operation span 传给 `execute(span)`，并用同一个 span 关联整个 lifecycle。
- `TracingEvent` 只承载 `name`、`at`、`span`、`level`、`target` 与可选 `fields`。SDK lifecycle 事件统一通过 `event.span.id` / `event.span.parent?.id` 关联，不再在 event shape 上平铺 `operationId`、`spanId`、`parentSpanId`。
- `TracingSubscriberTrait` 是纯 sink，只暴露 `record(event)`。console/timeline/test collector 都属于这一层，可通过 `createTracing({ subscribers })` 挂接到 tracing runtime。
- `runOperation({ environment, span, name, target, fields, execute })` 是 canonical 的结构化 lifecycle helper，负责 `operation.started` / `operation.error` / `operation.ended` 发射。它把 `time`、`tracing` 与显式 parent span 收到同一个显式调用对象里，但它本身不是 foundation host capability。
- `defineInstrumentMethodDecorator(...)` 是基于同一 helper 的 stage-3 class method decorator ergonomics，不额外引入第二套 tracing 语义，也不要求 adopter 必须启用 decorators。
- span 传播走显式对象持有模型：environment 持有 root span，registry/client/method 根据需要继续 fork；SDK 不依赖 ambient current span、ambient current operation，或 `runWithSpan()` 式隐式上下文。

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

下表是当前 TS SDK public-surface 快照。它必须与 `public-surface-inventory.json` 保持一致。

| Surface | Stability | Owner | Change discipline |
|---|---|---|---|
| `@securitydept/client` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/persistence/web` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/web` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/basic-auth-context-client` | `stable` | `basic-auth-context` | `stable-deprecation-first` |
| `@securitydept/basic-auth-context-client-react` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/session-context-client` | `stable` | `session-context` | `stable-deprecation-first` |
| `@securitydept/session-context-client-react` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/backend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/orchestration` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/access-token-substrate` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/registry` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/test-utils` | `experimental` | `foundation` | `experimental-fast-break` |
| `@securitydept/basic-auth-context-client-angular` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-angular` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react/tanstack-router` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-angular` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/client-react` | `provisional` | `shared-framework` | `provisional-migration-required` |
| `@securitydept/client-react/tanstack-router` | `provisional` | `shared-framework` | `provisional-migration-required` |
| `@securitydept/client-angular` | `provisional` | `shared-framework` | `provisional-migration-required` |

#### token-set-context-client Subpath Family 阅读方式

- `/backend-oidc-mode`：platform-neutral client/service/token-material entry，以及 browser login 与 popup callback relay helper。
- `/frontend-oidc-mode`：frontend OIDC client mode 与基于 environment 的 config projection resolution。
- `/orchestration`：protocol-agnostic token lifecycle 与 route requirement primitives。
- `/access-token-substrate`：access-token propagation vocabulary 与 substrate contract。
- `/registry`：shared multi-client lifecycle core。

#### Capability Boundary Rules

- Framework router glue 属于 shared framework adapters。
- Browser token-lifecycle glue 属于 token-set family。
- App-local business API wrapper 不是 SDK public surface。
- Reference app 证明真实使用形态，但不单独定义 package ownership。

#### token-set-context-client 前端 subpath / abstraction split

Frontend adopter 应按层理解：foundation coordination、token-set mode/substrate/registry，然后才是 framework adapter。Token-set family 不是所有 frontend helper 的唯一 owner。

#### Config Projection Source Contract（`frontend-oidc-mode/config-source.ts`）

`frontend-oidc-mode` 负责按顺序从 inline、realm、persisted 和 network source 解析 config projection。`resolveFrontendOidcModeConfigProjection()` 接受 root `FoundationEnvironment`，让所有 source 经过同一 projection schema，并从该 environment 使用 transport、storage 与 time capability，最终返回 projection 和 client config。Realm 注入通过 `injectConfigProjectionIntoRealm()` 显式完成；不再存在 browser materializer 或 mode-specific web environment。Host 只负责其唯一 environment、source descriptor、endpoint URL、redirect URI 与 client 构造。

Frontend OIDC flow state 会在流程入口显式确定 storage scope。Redirect authorization、自动 callback restore 与 public `handleCallback()` 使用可选 `sessionStorage`；popup authorization 及其 relay callback 使用必需且按 environment 隔离的 `realmStorage`。Pending record 与 consumed-state record 始终使用同一组选定 store。Client 不会在 realm/session storage 之间探测或回落，因此损坏的 session store 不会影响 popup login，损坏的 realm override 也不会静默切换到 session storage。

#### 参考应用基线（`apps/webui` / `apps/server`）

`apps/webui` 与 `apps/server` 定义当前仓库内基线：backend-mode 与 frontend-mode host split、keyed callback/readiness、React Query token-set management flows、route security、dashboard bearer access、浏览器 E2E 覆盖，以及 shared error/diagnosis consumption。

参考应用应直接证明 canonical SDK 用法。`apps/webui` 现在通过 `useSecuritydeptContext().get(TOKEN)`、`useReadableSignalValue(...)` 与 feature-local 的显式 assertion/helper 读取 SDK 依赖，而不是再用一个共享的 app-local facade 把这些读取隐藏起来。

### Framework Router Adapters

Framework router adapter 由以下 package 拥有：

- `@securitydept/client-react/tanstack-router`
- `@securitydept/client-angular`

Canonical semantics：完整 matched-route chain aggregation、`inherit` / `merge` / `replace`、child-route serializable metadata、root-level runtime policy，且 SDK 不内建产品 chooser UI。

对 Angular，`@securitydept/client-angular` 拥有基于 `RequirementPlannerHost` / `RouteCompositionRequirementPlanner` 的 token-set 无关基础层：用 `secureRoute()` 声明 child requirement，用 `secureRouteRoot()` 装配 root（其会挂上 `createAngularCanActivate` / `createAngularCanActivateChild`），用 `projectAngularRouteSegments()` 投影路由元信息，并通过 `provideRequirementPlannerHost()` 将 planner host 装配到 `REQUIREMENT_PLANNER_HOST` DI token。`@securitydept/token-set-context-client-angular` 在其上叠加基于 registry 的特化层：`provideTokenSetRequirementPlannerHost()` 绑定 token-set behaviour，`createTokenSetCanActivate()` / `createTokenSetCanActivateChild()` 包装基础 guard，`secureTokenSetRoute()` / `secureTokenSetRouteRoot()` 提供显式命名的 token-set route builders，再委托基础构造器。

Angular token-set 路由安全通过 `secureTokenSetRouteRoot()` 与 registry requirement 配合使用；客户端选择写在 requirement 的 `attributes.query` 中（例如 `{ clientKey: "main" }` 或 `{ requirementKind: "frontend_oidc" }`）。guard 拒绝导航时，registry behaviour 的默认 `onUnauthenticated` 会对第一个未认证 client 启动 OIDC redirect login，并将 `planContext.routeState.url` 记录为 `postAuthRedirectUri`。仅在需要时通过 `secureTokenSetRouteRoot({ onClientUnauthenticated: ... })` 或 `provideTokenSetRequirementPlannerHost({ onClientUnauthenticated: ... })` 覆盖 redirect 策略。共享 contract 是 `BaseOidcModeClient.loginWithRedirect(options)` 与 `@securitydept/token-set-context-client/registry` 中的 `TokenSetOidcRedirectLoginOptions`。不要在 guard handler 内读取 Angular `Router.url` 作为回跳目标，因为 attempted navigation 尚未提交。已经启动整页外部 redirect 的 handler 不应再 resolve 为 `false`；registry 默认 handler 会在启动 redirect 后返回永不 settle 的 guard result，避免 Angular 在页面离开前完成 in-app navigation cancel。

TanStack Router 使用 `secureRoute()` 写入可序列化 `staticData`，用 `secureRouteRoot()` 组合 root `beforeLoad`。运行时 behaviour 通过核心 `RequirementPlannerHost` / `REQUIREMENT_PLANNER_HOST` 提供；route context 包含 `planContext.routeState.url`，发起整页 auth redirect 时应把它作为 attempted navigation URL。不要从 `window.location` 推断目标页；beforeLoad 执行时当前 document URL 也可能仍是旧路由。

### token-set-context-client v1 Scope Baseline

当前 `0.3.x` baseline 是 browser-owned token-set，包含 framework adapters、registry lifecycle、route orchestration、readiness、callback handling、仓库内 proof 与下游校准。

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
4. 在依赖 token-set behavior 前，先接受当前 `0.3.x` 边界。

### Verified Environments / Host Assumptions

Verified 表示已有聚焦型验证、仓库内 proof 或下游校准；不代表覆盖所有 host。

当前验证覆盖 Node/browser foundation behavior、React 19、Angular、TanStack Router、raw Web Router、`apps/webui` 与 `outposts`。Host support 应通过 ECMAScript requirements、adapter capabilities 与直接验证三层表达。

### 最小进入路径

#### 1. Foundation 入口：environment 仍由宿主显式拥有

使用 `@securitydept/client` 获取 shared primitives。它不是产品级 auth shell。

#### 2. Browser 入口：backend OIDC client

使用 `@securitydept/token-set-context-client/backend-oidc-mode` 导出的 `BackendOidcModeClient`、`relayTokenSetPopupCallbackFromEnvironment` 和 `TokenSetPopupRelayErrorCode`，并传入 host-owned `FoundationEnvironment` 或 `NativeWebEnvironment`。

该 subpath 是 browser-host glue，不表示所有 Web-like runtime 都具备 page navigation。选择 helper 前应先明确 foundation environment 边界：

- Browser client construction 应使用 `new BackendOidcModeClient(config, environment)`；`environment` 由 host 通过 `createFoundationEnvironment(...)`、`createEnvironmentForNativeWeb(...)` 或其它显式 host creator 创建。不要把 transport、time、persistent store、session store 分散传给每个 helper。
- Worker-like host、service worker 与 extension background 可以创建/restore client，并运行 token-state API，但默认不得执行 page callback capture。
- Page-only helper 只能通过 `NativeWebEnvironment` 读取 `window.location` / `window.history`；return URL 构造应留在应用边界显式完成，例如 `client.authorizeUrl(environment.router.currentUrl()?.toString())` 或 `client.loginWithRedirect({ postAuthRedirectUri })`。Callback page 应先调用 mode-owned `takeFrontendOidcCallbackInputFromRouter(router)` 或 `takeBackendOidcCallbackInputFromRouter(router)`，再把返回值传给 `client.handleCallback(...)`。两个 helper 都通过 `RouterTrait` 完成 callback cleanup；frontend helper 保留非 OIDC query，backend helper 保留既有 hash-router block。对 token-set OIDC login 而言，共享的浏览器入口是 `BaseOidcModeClient` 上的 `loginWithRedirect({ postAuthRedirectUri })` 和 `loginWithPopup({ popupCallbackUrl })`；`FrontendOidcModeClient.loginWithRedirect()` 还接受 per-request `redirectUri`，该 URI 必须包含在配置给 callback resolver 的候选集合中。Client 自身必须通过 environment 持有 page router / popup capability。`FrontendOidcModeClient` 和 `BackendOidcModeClient` 都直接实现这些方法。`relayTokenSetPopupCallbackFromEnvironment()` 仍是 page-only helper，并要求显式传入 `environment`。
- Backend OIDC 不维护隐藏的 callback fragment store。重试或延迟处理 callback 是应用层策略；应用必须在从 router 消费 callback input 前自行保留它。缺少必要 capability 时必须 fail-fast，而不是落到 `window is not defined` 或 stale URL parsing。

推荐 host environment：

| Host | Environment | Callback capture | Restore/token state | Storage defaults |
|---|---|---:|---:|---|
| browser page/tab/popup | `NativeWebEnvironment` | 是 | 是 | 可使用 page storage |
| browser worker | `FoundationEnvironment` | 默认否 | 是 | 只能显式注入 store |
| service worker | `ServiceWorkerEnvironment` | 默认否 | 是 | 只能显式注入 store |
| extension background | `WebExtBackgroundEnvironment` | 默认否 | 是 | 只能显式注入 store |

不要通过检查 `globalThis.location` 决定是否允许 callback bootstrap。Service worker 或 extension background 可能暴露 location-like object，但没有 page history semantics。Page detection 必须验证 `window.location` 与 `window.history.replaceState` 等 page/document capability。

同一 page-boundary 规则也适用于 basic-auth 与 session `/web` redirect helper：会读取或写入 `window.location` 的 redirect helper 是 page helper。Worker-like host 必须传入显式 URL/navigation capability，或把 redirect initiation 保留在 real page context 中。

#### 3. React 入口：唯一 SDK Context + injector factory

使用：

- `@securitydept/client-react`
- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

React composition 仍服从三层模型：auth-context config、injector provider/factory、host registration glue。

- `@securitydept/client-react` 拥有唯一 SDK React Context：`SecuritydeptContext`、`SecuritydeptProvider`、`useSecuritydeptContext()`。它同时提供 context-free signal/event bridge：`useReadableSignalValue()`、`useReplaySignalValue()`、`useInteropObservable()` 与 `useEventStream()`。
- React 使用 environment 自己的 injector 作为根 `SecuritydeptProvider.parentInjector`；具体 router adapter（如 `@securitydept/client-react/tanstack-router`）负责 route-scoped auth coordination。
- `@securitydept/basic-auth-context-client-react` 导出 `BASIC_AUTH_CONTEXT_CLIENT`、`BASIC_AUTH_CONTEXT_CLIENT_CONFIG`、`BasicAuthContextService`、`provideBasicAuthContext({ config })`。React 代码通过 `useSecuritydeptContext().get(BASIC_AUTH_CONTEXT_CLIENT)` 读取 client。
- `@securitydept/session-context-client-react` 导出 `SESSION_CONTEXT_CLIENT`、`SESSION_CONTEXT_CLIENT_CONFIG`、`SessionContextService`、`provideSessionContext({ config })`。React 代码通过 `useSecuritydeptContext().get(SESSION_CONTEXT_CLIENT)` 读取 client，并通过 `useReplaySignalValue(client.sessionInfo)` 等 signal hook 读取状态。
- `@securitydept/token-set-context-client-react` 导出 `provideTokenSetClientRegistry()`、`TOKEN_SET_CLIENT_REGISTRY`、`TokenSetClientRegistryService` 和无样式 callback hooks。读取 keyed auth state 的 canonical 方式是 `const registry = useSecuritydeptContext().get(TOKEN_SET_CLIENT_REGISTRY)`，然后 `useReplaySignalValue(registry.clientSignalFor("main"))`，再读取返回 client 的 `authSnapshot`、`isAuthenticated` 等 replay channels。
- Frontend 与 backend callback 分别使用 `useTokenSetFrontendCallback({ clientQuery })` 和 `useTokenSetBackendCallback({ clientQuery })`。可选的同步 `clientQuery({ callbackUrl })` 负责生成 registry query，或返回 `null` 表示 callback 不适用；它不会消费 callback input。Hook 在 SSR 与 hydration 首次渲染期间保持 callback state 为 idle，并在客户端 commit 后初始化选中的 record，再将 registry readiness 与 client 自己的 `callback` Resource 展平。Callback input 仍由 client 在 `start()` 中、persistence restore 之前解析和清理。默认 resolver 支持异步 `callbackInputPredicate`，它在 canonical `take...FromRouter()` 清理前执行；返回 `false` 时 URL 保持不变。Backend registry selection 默认使用 compat fragment 的 `callback_routing_key`，`createBackendOidcModeClientFactory()` 默认以 `meta.clientKey` 作为 client routing key。Frontend selection 默认匹配 entry metadata 的 `callbackUrl` 候选，未显式提供 resolver 时 factory 也使用这些候选。Registry query 与 input predicate 是彼此独立的扩展点。Registry factory 接收 `{ environment, meta, cancellationToken }`；framework adapter 不直接调用 `client.start()`。Callback determination 成功后，内存 auth/callback Resource 的提交不依赖 best-effort persistence 同步；storage 写入失败只记录 trace，不会把本次登录改判为失败。

#### 4. Angular 入口：thin DI wrapper 保持 canonical owner 边界

使用：

- `@securitydept/basic-auth-context-client-angular`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client-angular`

Layering rules：

- `provideBasicAuthContext({ config })`：仅 auth-context config。
- `provideEnvironment({ environment })`：canonical Angular DI bridge，用于注入 environment capability。Context-client Angular providers 会读取这个 token，而不是自己接收 `environment` option。
- `provideSessionContext({ config })`：`SessionContextClient` 之上的 adapter leaf。需要 service construction 后立即启动 client 时使用 `config.autoStart`。
- `SessionContextService`：controller 之上的 signal / observable facade。低层 auth-context behavior 仍在 `SessionContextService.client`。
- `provideTokenSetClientRegistry({ clients })`：基于核心 `TokenSetClientRegistryEntry<BaseOidcModeClient>` 的 Angular host registration；每个 client entry 仍拥有 auth-context config 与 environment composition。
- `TokenSetFrontendCallbackComponent` 与 `TokenSetBackendCallbackComponent` 将 registry/client callback Resource 桥接为 Angular signal。它们在服务端渲染期间保持 idle，并在 Angular 仅浏览器执行的 `afterNextRender()` 阶段初始化选中的 record，因此生成 SSR 输出时不会消费 callback input。它们不解析 callback input，也不拥有第二套 callback state machine。
- `provideTokenSetClientRegistryAuthorizationInterceptor(options?)` / `createTokenSetClientRegistryAuthorizationInterceptor(options?)`：使用 SDK options-object API 形式的 request authorization。functional interceptor 默认注入 `TokenSetClientRegistryService`；`authorizationForRequest` 可以显式传入，也可以通过 `TOKEN_SET_CLIENT_REGISTRY_AUTHORIZATION_FOR_REQUEST` 提供。默认 `authorizationForRequest(registry, request)` 会按 request URL 选择已注册 client、初始化该 client，并等待其 `authorizationHeaderValue` replay signal 后注入 `Authorization`。它不触发 refresh 或 auth check；client `start()`、refresh timer、page-resume auth-check trigger 或显式 `authCheck()` 负责维护。request URL 不匹配任何已注册 client 时，不会注入 `Authorization` header。

Freshness 由 token-set core 拥有，而不是由某个 framework adapter 单独修补。Consumer code 读取 replay channels：首屏 readiness 使用 `authDetermined`，稳定 UI 使用 `authSnapshot`，route guard 使用 `isAuthenticated`，transport/interceptor 使用 `authorizationHeaderValue`。`authCheck(options?)` 是唯一显式 maintenance command，只应留给有意触发一次串行检查的高级调用者。Event payload 不得包含 raw access、refresh 或 ID token value。Header availability 不再拥有独立 event/status lifecycle：可用 bearer projection 归属于 authenticated snapshot，缺失 bearer material 则表现为 unauthenticated 或 undefined header projection。Mode client 不再暴露同步 bearer convenience API，registry token sugar 也不属于公开模型。使用 `registry.whenReady(key?)` 或 `registry.clientSignalFor(key?)` 获取已 start 的 client，然后消费该 client 的 replay signals。

Browser-owned frontend/backend OIDC factory 通过 client runtime option `authCheck.triggerSources.pageResume` 配置 page-resume auth-check。bundled source 只消费 host-owned `PageLifecycleTrait.resume` event stream；token-set orchestration 不再接收或探测原始 `document` / `window` target。Angular registry entry 不再在 materialization 阶段 patch client 安装 page-resume trigger：Angular host 应根据 `clientFactory({ environment, meta, cancellationToken })` 构造 client 时传入所需的 `authCheck.triggerSources` 配置。浏览器从 hidden 回到 visible、`pageshow`、`focus` 或 `online` 时，page source 只发出纯 EventStream auth-check trigger。client-owned dispatcher 负责将 trigger event 提交给串行 auth-check runner；restore 与显式 `authCheck()` 因为需要 promise-returning 语义而使用 command gateway，refresh timer 则是从 `authSnapshot` 派生的另一个 trigger source。完成的检查会通过强类型的终态 auth event（`auth.authenticated` / `auth.unauthenticated`）投影其结果；触发原因（例如 page resume）记录在局部 orchestration trace attributes 中，而不是 auth event 的 payload 字段上。这是恢复 barrier，不是交互式 login trigger：refresh 失败会沿 token-set client 的正常路径清理或保留状态，是否启动登录仍由 route/request handler 决定。

短 access-token lifetime 应由持续运行的 client state machine 处理：persisted restore 执行初始 auth check，refresh timer 调度后续检查，browser resume 在 hidden tab、系统 sleep、bfcache 返回后发出 auth-check trigger。Angular route aggregation 等待 pending initial auth determination，然后读取 `isAuthenticated`；protected request 等待 `authorizationHeaderValue`。当 `frontend-oidc-mode` 或其它 token-set mode 能记录 `accessTokenIssuedAt` 时，token freshness 会按 token lifetime 动态收窄 refresh window 与 clock skew，而不是对所有 token 生硬套用固定窗口。这样短生命周期 token 在刚签发时仍保持 `fresh`，但又会足够早地进入 `refresh_due`，以支撑 restore、resume 与 scheduled maintenance。TanStack Router host 应使用 `@securitydept/token-set-context-client-react/tanstack-router` 的 `createTokenSetSecureBeforeLoad()`；非框架 browser host 应将 shared guarded-router primitives 与选中 token-set client 的 `isAuthenticated` replay signal 组合，在 redirect/block fallback 前完成认证判断。

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

#### 5. SSR / server-host 入口：environment host adapters

使用 `@securitydept/client` 提供的 foundation host adapter，然后把生成的 environment 传入具体 context client。

- `@securitydept/client/server`
- 具体 host/framework adapter 拥有的 `createEnvironmentFor{Host}` helpers

Context packages 不再拥有专用 `/web` 或 `/server` subpath。Host capability resolution 属于 client foundation package 与 framework adapter。

### Provisional Adapter 维护标准

`./web`、`./server` 与 framework packages 按更严格的 provisional bar 维护：boundary 稳定、import-time behavior 安全、ordinary usage 不依赖 reference-app glue、聚焦型验证完整、真实 dogfooding、verified-environment claim 准确。

#### Provisional Adapter 晋升前 Checklist

| 条件 | 要求 |
|---|---|
| capability boundary 稳定 | 在持续 release window 内无 owner reshuffle |
| minimal entry 清晰 | 不依赖完整 reference page 也能解释 |
| ordinary usage 成熟 | 不依赖 app-local glue |
| 聚焦型验证完整 | lifecycle、regression、import-contract guardrail 存在 |
| verified environments 明确 | 不夸大 host validation |

#### 当前晋升就绪度（快照，非路线图）

| Adapter / Surface | 当前判断 |
|---|---|
| `@securitydept/client/web` | stable foundation-owned browser helper surface |
| `@securitydept/client/web` / `@securitydept/client/server` | foundation-owned host environment adapter 已成立 |
| `*-react` / `*-angular` adapter family | provisional；已有真实 reference-app/downstream proof，但没有 broad host matrix |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | provisional；keyed pending-state 与 single-consume callback semantics 已正式化 |

## Shared Client Lifecycle Contract（共享客户端生命周期契约）

**Subpath**：`@securitydept/token-set-context-client/registry`

Registry 拥有 `register(entry)`、`unregister(key)`、`resetMaterialization(key)`、`dispose()`、`primary` / `lazy` initialization priority、`preload`、`whenReady`、`idleWarmup`、与 callback/readiness behavior 对齐的 keyed lookup，以及共享的通用 callback failure presenter `describeTokenSetCallbackError()`。React 与 Angular adapter 消费这套 shared core；`describeFrontendOidcModeCallbackError()` 这类 mode-specific copy 仍属于 mode owner，并需要显式注入。

这套 contract 现在把 `registered` 与 `ready` 视为两个不同的 observability surface。查看已配置 client 时使用 `has()`、`registeredKeys()`、`registeredEntriesSnapshot()` 与 `registeredMetaSnapshot()`；查看已经完成 materialization 与 `start()` lifecycle 的 client 时使用 `readyKeys()`。移除注册与重建 materialization 应直接使用 canonical verb：`unregister(key)` 与 `resetMaterialization(key)`。

核心 client registry 是 reactive topology/readiness authority。应通过 `entries: ReadableSignalTrait<readonly TokenSetClientRecordView<TClient>[]>` 观察它，并使用 `clientRecordFor*` / `clientSignalFor*` 进行 keyed 或 query-based acquisition。`clientSignalFor(key, { initialize })` 与 `clientSignalForQuery(query, { initialize })` 是 canonical reactive client acquisition API，默认会触发 lazy materialization。`initialize(key)` 是解析为 `TokenSetClientReadyRecordView<TClient>` 的动作完成句柄，而不是状态观察主路径。

每个 client 的 token-set auth material 由 mode client 自己拥有。所有 registry-managed OIDC mode client 都暴露独立 auth channel：`authDetermined` 表示首次判定完成，`authSnapshot` 表示 last determined snapshot 或 `null`，`isAuthenticated` 面向 guard truth，`authorizationHeaderValue` 面向 bearer projection，这四者是 replay signal；`lastAuthError` 表示最近一次判定/操作错误 register，`authOperations.*Pending` 表示局部操作锁，这两类是 plain signal。`authSnapshot` 是权威 auth-material replay source；`authDetermined`、`isAuthenticated` 与 `authorizationHeaderValue` 是 derived replay projection，而不是手动同步的独立状态。直接创建的 client 默认只有调用 `start()` 后才运行；只有 direct creation path 需要立即运行时才显式传 `autoStart: true`。Registry-managed client 不使用 entry-level `autoStart` 或 `autoRestore`；registry readiness 表示 client 已 materialize 且 `start()` 已完成。默认 `createTokenSetOidcAuthRegistry()` 现在 materialize client 本身，因此 React Query readiness 与 Angular registry lookup 返回 client，而不是 per-client service wrapper。`authEvents` 仍只表达 auth domain telemetry；registry topology 与 readiness 变化应通过 registry `state` 观察。

Canonical RxJS bridge 现在位于 `@securitydept/client/rx`。对 `EventStreamTrait` 或 `ReadableSignalTrait` 都使用 `toRxObservable(source)`，反向桥接使用 `fromRxObservable(observable)`。Angular adapter 如果需要 Angular-native signal，应使用 `@securitydept/client-angular` 的 `toNgSignal(source)`。

## 示例与参考实现

### 真实参考实现

- `apps/server`：auth、propagation、route composition、server error/diagnosis proof。
- `apps/webui`：React/browser/multi-context auth shell、token-set reference page、dashboard、浏览器 E2E 覆盖与 SDK dogfooding 覆盖。

### 下游参考案例：Outposts

`~/workspace/outposts` 验证真实 Angular adopter 路径。它使用 `provideTokenSetClientRegistry(...)` 加 `provideTokenSetClientRegistryAuthorizationInterceptor()`，证明了面向 downstream `confluence` backend 的 URL-prefix bounded authorization injection。这个路径也用于校准 stale-token handling：SDK 必须在首个 protected Confluence request 前 refresh 或清理状态，而不是发送会被后端正确以 `ExpiredSignature` 拒绝的 expired bearer。其 app-local auth service 仍是 adopter glue，不是 SDK API 模板。

下游验证应使用 pnpm 本地 `link:` dependency 链接 SecurityDept SDK packages，不使用 package-manager override。普通 TS package 可以 link 到 package root；Angular package 应在重建后 link 到对应 `dist/` 输出，并在浏览器验证前清理 downstream Angular/Vite cache。

### 当前 Bundle / Code Split 判断

Bundle/code-splitting 是工程优化议题，不是当前 `0.3.x` line 的 public-contract blocker。

### Demo 与 OIDC Provider

Demo 用于解释 contract。Provider 选择与 demo 页面不定义 package boundary，也不能替代聚焦型验证。

## 对后续开发者与 AI Agents 的要求

- 不要把客户端 SDK 命名或实现成 `auth-runtime`。
- 不要让 framework adapter 反向污染 foundation package。
- 不要引入 import-time side effect 或默认 global polyfill。
- 不要把 reference-app 或 adopter glue 产品化为 SDK API。
- 不要把 mixed-custody / BFF / server-side token ownership 移入当前 SDK baseline。
- 修改 public surface、docs、examples、inventory 与 migration notes 时必须一起移动。

[English](../en/007-CLIENT_SDK_GUIDE.md) | [中文](007-CLIENT_SDK_GUIDE.md)
