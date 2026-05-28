# TypeScript SDK 迁移指南

本文是 `sdks/ts/public-surface-inventory.json` 的人类可读伴随文档。它记录当前迁移规则和仍然对 adopter 有意义的迁移说明，不再以实现时间线作为稳定文档结构。

## 0.x 合约变更策略

SDK 仍处于 `0.x`，但 public-surface changes 必须保持有纪律。

| Stability | Change Discipline | 含义 |
| --- | --- | --- |
| `stable` | `stable-deprecation-first` | Breaking change 必须先经过 deprecation 周期。已废弃 API 至少在一个 minor release 中保持可用，并在本文记录迁移说明。 |
| `provisional` | `provisional-migration-required` | 允许 breaking change，但必须记录迁移路径和理由。 |
| `experimental` | `experimental-fast-break` | 预期会有 breaking change。简短记录有价值，但不是 release gate。 |

规则：

- `public-surface-inventory.json` 是 package/subpath stability 与证据记录的 machine-readable authority。
- 本文是 adopter-readable migration companion。
- 非 experimental breaking changes 必须同时更新 inventory 与本指南。
- Additive changes 如果需要 adopter 主动启用更安全行为，也应记录在这里。

## 当前迁移说明

### Token-set Auth Event Payload Map

涉及包：

- `@securitydept/token-set-context-client/orchestration`

变更：

- 松散的 `TokenSetAuthEventPayload` 字段包被替换为按事件类型索引的 `TokenSetAuthEventPayloadMap`。`TokenSetAuthEvent<TType>` 现在是 `RuntimeEventEnvelope<TType, TokenSetAuthEventPayloadMap[TType]>`，`createTokenSetAuthEvent()` 改为泛型工厂，其 `payload` 由事件 `type` 约束。
- `freshness` 与 `hasRefreshMaterial` 只存在于 refresh 专属 payload（`AuthRefreshRequired` / `AuthRefreshStarted` / `AuthRefreshSucceeded` / `AuthRefreshFailed`）。终态事件（`AuthAuthenticated` / `AuthUnauthenticated` / `AuthMaterialCleared`）只携带最小的身份 payload。
- client 标识只通过可选的 `id` 字段表达，不再保留通用弱约束字段包。
- 删除 `AuthCheck*` 事件族以及 `TokenSetAuthFlowOutcome` / `TokenSetAuthFlowReason` / `authCheckReason` 词表。结果由事件类型本身表达，触发原因等上下文记录在局部 orchestration trace attributes 中，而不是事件 payload 字段。

迁移：

- 把对 `event.payload.outcome` / `event.payload.reason` / `event.payload.authCheckReason` 的读取改为基于 `event.type` 判断（例如 `event.type === TokenSetAuthEventType.AuthAuthenticated`）。
- 只有在收窄到 refresh 事件类型后才读取 `freshness` / `hasRefreshMaterial`。
- 把 `event.payload.clientKey` / `event.payload.logicalClientId` 改为 `event.payload.id`。

### 统一 Injector 与唯一 React Context

Packages：

- `@securitydept/client`
- `@securitydept/client-react`
- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

变更：

- `@securitydept/client` 现在拥有 framework-neutral DI authority：`SecuritydeptInjectorTrait` 是读取侧最小 contract，只表达 `get()`；`SecuritydeptInjector` 是 SDK runtime/facade，负责 provider 解析、parent 继承、override 与 `has()` 诊断。
- React 侧现在只有一组 SDK Context：`SecuritydeptContext`、`SecuritydeptProvider`、`useSecuritydeptContext()`，全部位于 `@securitydept/client-react`。
- React domain package 不再导出 `BasicAuthContextProvider`、`SessionContextProvider`、`BackendOidcModeContextProvider`、`TokenSetAuthProvider`、`useBasicAuthContext()`、`useSessionContext()`、`useBackendOidcModeContext()`、`useTokenSetAuthRegistry()` 等 domain-specific Context / Provider / keyed state helper。
- React domain package 改为导出 injection token、provider factory、plain factory 与显式 callback/component bridge。状态读取统一通过 `useReadableSignal(...)` 完成。

迁移：

- 用 `SecuritydeptProvider` 包住 React subtree；可以传入已有 `injector`，也可以通过 `providers` / `parentInjector` 派生 child injector。
- 将 `XxxContextProvider` / `useXxxContext()` 迁移为 `useSecuritydeptContext().get(TOKEN)`。
- 将 `useTokenSetAuthState(key)` / `useTokenSetAccessToken(key)` / `useTokenSetAuthRegistryState()` 迁移为 `const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY)`，再配合 `useReadableSignal(registry.clientSignalFor(key))` 读取返回 client 的 replay channels。需要观察 registry topology 时使用 `useReadableSignal(registry.state)`。
- 将 basic-auth / session 的 provider-first 组合迁移为 `create*()` + `provide*()`；token-set 多客户端 React 组合改为注册 `provideTokenSetAuthRegistry({ clients })`，只有在 host 明确需要 callback resume wiring 时才额外组合 `provideTokenSetCallbackResumeController(registry)`。

### Token-Set React Registry Composition

Package：

- `@securitydept/token-set-context-client-react`

变更：

- `createTokenSetAuthRuntime()` 与 `provideTokenSetAuthRuntime()` 已移除。
- React token-set adapter 不再默认推崇一个把 registry ownership、callback resume controller ownership、idle warmup 与 disposal 绑在一起的固定 runtime bundle。

迁移：

- 普通 React host 直接注册 `provideTokenSetAuthRegistry({ clients })`。
- 如果 host 需要 callback resume，则在自行决定 registry ownership 之后，显式组合 `provideTokenSetCallbackResumeController(registry)`。
- 如果 host 需要手动 readiness、手动 disposal 或自定义 warmup 策略，应直接创建并持有 registry/controller，而不是继续依赖 SDK 预设的 runtime object。

### Client Environment 与 Backend-OIDC Web Host 边界

Packages：

- `@securitydept/client`
- `@securitydept/client/web`

变更：

- Framework-neutral host capability resolution 现在由 client foundation 通过 typed `FoundationEnvironment`、`NativeWebEnvironment`、`WebExtCoreEnvironment` 以及相关 host 特化对象拥有。
- 历史 `ClientRuntime` 命名已收口为 environment terminology。Core client constructor 依赖属于 environment，不是第二层 runtime。Canonical path 是 `environment.transport`、`environment.sessionStorage` 等顶层字段。
- Web host environment factory 是显式 composition entry，不是 automatic host detection，也不再暴露仅用于 preset 区分的 worker/service-worker/extension-background wrapper。
- Context 与 adapter public helper 使用同一边界。Backend-OIDC web helper、basic-auth/session redirect helper，以及 framework adapter convenience helper 不得各自重复声明或猜测 transport/store/time/page dependencies。
- Backend-OIDC web helper 按 host boundary 拆分：page-only helper 使用 page-explicit 命名；worker-safe startup 使用 host-injected environment/capability，并通过 `client.start()`、`autoStart`、registry orchestration 和 auth signals 完成。

迁移：

- 在 host composition root 创建一个 environment，并把 environment object 本身沿 provider/adapter 传递。不要让 adopter 读取 `environment.runtime`；直接使用历史 runtime/derive helper 的代码应迁移到 `FoundationEnvironment`、`createFoundationEnvironment()`、`createEnvironmentForNativeWeb()` 或直接传递结构化 environment。
- 即使值是 page-scoped 或异步解析的，public option key 也继续叫 `environment`。不要引入 `pageEnvironment` 作为并行 key；是否需要 page capability 由类型表达。
- Real page/tab/popup callback flow 使用 `createEnvironmentForNativeWeb({ location, history, ...options })`；page capability 作为顶层 host input 显式传入，且必须来自 host composition root。
- Worker-like host 不使用 `createEnvironmentForNativeWeb()`；应使用 `createFoundationEnvironment()` 或更具体的 host factory，并显式注入 persistence/session store。
- 不要在 service worker 或 extension background 中消费 callback fragment。那里只运行 restore/token-state API；callback fragment 只应在 real page/popup document 中消费，或在测试中显式传入 fake `RouterTrait`。
- 将 ambiguous page-global helper usage 迁移到显式 page 形式：用 `client.authorizeUrl(environment.router.currentUrl()?.toString())` 或 `client.loginWithRedirect({ postAuthRedirectUri })` 构造 return URL；Backend OIDC callback page 使用 `takeCompatFragmentFromRouter(router)` 后接 `client.handleCallback(fragment)`。Backend OIDC fragment redirect 使用 securitydept compat fragment 协议，并保留既有 hash-router fragment。
- 将 `relayTokenSetPopupCallbackFromEnvironment()` 等 popup callback relay helper 视为 page-only helper；测试或 host wrapper 中应传入携带 page capability 的 `environment`。从 `@securitydept/token-set-context-client/backend-oidc-mode` 或 `@securitydept/token-set-context-client/frontend-oidc-mode` 导入；已删除的 `@securitydept/token-set-context-client/backend-oidc-mode/web` 子路径只是转发层。现在 canonical 的共享 token-set OIDC 浏览器 login contract 是 `BaseOidcModeClient.loginWithRedirect({ postAuthRedirectUri })` 和 `BaseOidcModeClient.loginWithPopup({ popupCallbackUrl })`；client 通过 environment 持有 page navigation 和 popup capability。Backend / frontend mode client 都直接暴露这些方法。Backend OIDC 不再持有隐藏的 callback-fragment flow state；重试或延迟 callback handling 必须由应用代码显式实现。
- Frontend-mode browser materialization 应在 host composition root 创建 `createFrontendOidcModeWebClientEnvironment(...)`，再传给 `createFrontendOidcModeBrowserClient({ environment, ... })`；materializer 不再在缺少 `environment` 时创建默认 environment。
- 当 browser/page environment ownership 需要在 framework route 或 command 之间保持稳定时，应在 composition root 创建一个 host-owned `NativeWebEnvironment` object 并注入该对象。不要继续发明 app-local module singleton 或 SDK-local lazy environment resolver。
- 将 basic-auth/session `/web` redirect helper 视为 page navigation helper；要么留在 real page context，要么注入显式 `RouterTrait`。
- Framework provider/DI registration function 可以持有完整 environment composition；普通 hook、guard、interceptor、service 或 convenience helper 不应各自接受一整套分散 dependency bag。
- 不要通过 `globalThis.location` 推断 page capability；core helper 消费行为 trait。原始 `window.location` 与 `window.history` 只出现在显式 native-web adapter 输入中。

理由：

- 非 client-bound helper 已经开始重复 dependency bag 并隐藏读取 `window.*` default。Typed client environment 在保持 core dependency wiring 显式的同时，为 helper 提供共享、可测试、按 host 划分的 capability boundary。

### TimeTrait 与 EventStream 时间源

Package：

- `@securitydept/client`

变更：

- `FoundationEnvironment` 现在承载单一 `time: TimeTrait` capability，不再拆成 `clock` 与 `scheduler` 字段。Idle work 是独立的可选 `idleCallback: IdleCallbackTrait` capability。
- `createDefaultTimeConfig()` 取代 `createDefaultClock()` 与 `createDefaultScheduler()`。
- `createDefaultIdleScheduler()` 与 registry `idleScheduler` wiring 已移除。Registry idle warmup 只有在 host 显式提供 `environment.idleCallback` 时才会运行。
- `timer()`、`interval()`、`scheduleAt()`、`fromTimeout()`、`fromInterval()`、`fromScheduleAt()`、`fromEventPattern()`、`fromSignal()` 与 `fromPromise()` 已从 `@securitydept/client` 移除。
- SDK 仍然对外暴露 `EventStreamTrait` / `EventSubjectTrait` 作为公共响应式原语，但通用 source 构造改为直接使用 RxJS；当需要由 host-owned `TimeTrait` 驱动调度时，使用 `@securitydept/client/rx` 中的 `createAsyncSchedulerWithTimestampProvider(...)`。

迁移：

- 将 `{ clock, scheduler }` environment wiring 改为 `{ time }`；只有当 host 明确启用 registry idle warmup 时才传入带 `environment.idleCallback` 的 host-owned `{ environment }`。工具级 idle revalidation helper 仍消费显式窄 capability。
- Registry 管理的 token-set entry 现在会通过 `clientFactory(environment)` 接收同一个 registry-owned environment。Client 构造应从该参数取能力，不应读取 module global 或继续传递分散的子 capability。
- 将直接 callback timer handle 改为 `timer(delayMs, createAsyncSchedulerWithTimestampProvider(time)).subscribe(...)`。
- 将重复 callback 调度改为 `interval(periodMs, createAsyncSchedulerWithTimestampProvider(time)).subscribe(...)`。
- 原先依赖 `fromEventPattern({ ..., callback })` 风格 SDK helper 的场景，改为直接使用 `rxjs` 的 `fromEventPattern(...)`、`from(Promise.resolve(...))` 或 `new Observable(...)`；只有在跨越 SecurityDept trait 边界时才再桥接回 `EventStreamTrait`。
- 测试中需要 deterministic `now()`、timer queue、flush 与 pending-count 断言时使用 `FakeTimeConfig`。

理由：

- 旧 scheduler abstraction 只是 host timer wrapper，没有表达 priority、execution context、queue 或 RxJS-style scheduling。将 timer 表达成 EventStream source，可以让 refresh timer、page-resume trigger 与其它 input source 收敛到同一个 subscription model。

### Token-Set Event-Driven Auth Flow

Packages：

- `@securitydept/client`
- `@securitydept/token-set-context-client/orchestration`
- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-angular`
- `@securitydept/token-set-context-client-react`

变更：

- Token-set client 现在以 replay channels 作为 canonical consumer API：`authDetermined`、`authSnapshot`、`isAuthenticated` 与 `authorizationHeaderValue`。
- 旧命令式 helper `ensureAuthForResource()`、`ensureFreshAuthState()`、`ensureAuthorizationHeader()`，以及 registry-level `ensureAccessToken()` / `ensureAuthorizationHeader()` / `ensureAuthForResource()` 已移除。
- `authCheck(options?)` 保留为唯一高级维护入口，只服务少数显式触发一次串行 auth check 的场景；它不是 route guard、transport、interceptor 或 UI 的读取路径。
- Auth lifecycle event 不暴露 raw access、refresh 或 ID token value。Authorization-header availability 由 authenticated snapshot 与 header projection 表达，不再使用独立 header terminal event。

迁移：

- 首屏 readiness 使用 `authDetermined.whenValue()`。
- 稳定 UI 读取 `authSnapshot`；route guard 与 router adapter 等待 `isAuthenticated.whenValue()`。
- HTTP transport 与 interceptor 等待 `authorizationHeaderValue.whenValue()`，再根据 `requireAuthorization` / fallback 策略处理 `undefined`。
- 使用 `registry.whenReady(key?)` 或 `registry.clientSignalFor(key?)` 获取已 start 的 client；不要在 host code 中重新添加 registry-level token sugar。
- 需要 lifecycle telemetry 时订阅 `authEvents`，不要从 redirect、throw error 或 raw token value 反推 auth flow state。

理由：

- 将 consumer read 与显式 maintenance 拆开，避免 route/interceptor 读取产生副作用，让 lazy registry lifecycle 更明确，也避免所有 UI 切面被迫通过一个复合命令式状态机。

### Angular Token-Set Bearer Interceptor：`strictUrlMatch`

Package：`@securitydept/token-set-context-client-angular`

变更：

- `provideTokenSetBearerInterceptor()` 接受 `options?: BearerInterceptorOptions`。
- `createTokenSetBearerInterceptor(registry, options?)` 接受同一 options object。
- `BearerInterceptorOptions.strictUrlMatch` 控制未匹配 URL 是否获得 single-client fallback token。

迁移：

```ts
provideTokenSetBearerInterceptor({ strictUrlMatch: true });
```

Angular host 如果存在 multiple backends、multiple audiences，或任何第三方 HTTP traffic，应启用 `strictUrlMatch: true`。这样当 request URL 不匹配任何已注册 token-set client `urlPatterns` 时，不会注入 bearer。

单 backend host 如果有意依赖 convenience fallback，可以继续使用无参形式。

### Shared Authenticated Principal

Packages：

- `@securitydept/client`
- `@securitydept/session-context-client`
- `@securitydept/token-set-context-client`

变更：

- `@securitydept/client` 拥有共享 `AuthenticatedPrincipal` contract。
- Session 与 token-set user-info projection 对齐到同一个 principal shape。
- Resource-token facts 保持独立，不是 authenticated human-principal data 的别名。

迁移：

- 对 incoming principal data 优先使用 `normalizeAuthenticatedPrincipal()` 或 `normalizeAuthenticatedPrincipalWire()`。
- 对 host-facing current-user display data 优先使用 `projectAuthenticatedPrincipal()`。
- 确保 session principal data 包含稳定 `subject`。
- 不要把 resource-token facts 当作 human-principal substitute。

### Operation Tracing And Error Presentation

Package：`@securitydept/client`

变更：

- shared client foundation 拥有参考应用和 adapters 使用的 operation correlation primitives 与 error-presentation reader helpers。
- Host UI 应消费稳定 `code` / `recovery` data，而不是解析 raw message text。

迁移：

- 使用 SDK helpers 读取 `ErrorPresentation`-compatible response data。
- 基于 `UserRecovery` values 分支 product recovery UI。
- App-local copy、toast 与 routing decisions 留在 host app。

### Token-Set React Query

Package：`@securitydept/token-set-context-client-react/react-query`

变更：

- React Query integration 是 React package 的 subpath，不是独立 package。
- SDK-owned surface 只保留 readiness query、token-set-aware query-key namespace 与 invalidation glue。
- 资源 domain model 与 groups/entries CRUD hooks 保留在 app-local 或 adopter-local 代码中。

迁移：

- 从 `./react-query` subpath 导入 React Query helpers。
- 在 host app 内构建 app-specific resource hooks，而不是期待 SDK 提供 token-set CRUD surface。
- 只有导入该 subpath 的 host 需要安装 TanStack Query optional peer dependency。
- 使用 SDK 的 query-key prefix 与 readiness helper 组合 host-owned query tree，并在 token-set lifecycle 变化时统一失效。

### Framework Adapter Environment Boundaries

Packages：

- `@securitydept/client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

变更：

- `@securitydept/client-react` 现在拥有 canonical React injector bridge：`SecuritydeptContext`、`SecuritydeptProvider`、`useSecuritydeptContext()`，以及 context-free `useReadableSignal()` / `useEventStream()`。
- `client-react` environment 与 `planner-host` helper 现在只导出 injection token 与 provider factory：例如 `CLIENT_ENVIRONMENT` + `provideClientEnvironment(environment)`，`AUTH_PLANNER_HOST` + `provideAuthPlannerHost()`。
- `basic-auth` / `session` / `token-set` React adapter 不再拥有 domain-specific Provider / Context hook；它们导出 token、plain factory、provider factory，以及显式 callback/component bridge。token-set 多客户端组合现在改为显式 registry/controller wiring，而不是 SDK 预设 runtime bundle。
- Angular `createTokenSetOidcLoginRedirectHandler()` 现在是 route-login helper。它的 public key 仍然只叫 `environment`，但这个值现在表示稳定的 native-web-environment source；Angular DI 应通过 `@securitydept/client-angular` 的 `provideNativeWebEnvironment({ environment })` 提供该 source。helper 面向 `BaseOidcModeClient.loginWithRedirect()`，并会在 guard flow 中 await 最终 capability 后再调用它。
- Angular `CallbackResumeService` 与 React `useTokenSetCallbackResume({ getCurrentUrl, describeError })` 现在桥接 `@securitydept/token-set-context-client/registry` 的 shared `TokenSetCallbackResumeController`。Angular `TokenSetCallbackComponent` 仍是该 service 之上的 page-only convenience，并继续使用 injectable current URL 与 host policy tokens。

迁移：

- 在 framework composition root 构建 browser environment，再通过 `SecuritydeptProvider` + provider factory 把这些 dependency 注册到 injector 中。
- 如果 app 依赖旧的 provider/service construction 副作用来探测 session，应显式创建 `SessionContextController`，并在 host-owned lifecycle 中调用 `controller.refresh()`。
- 对 React 代码，如需 page environment capability，应通过 `provideClientEnvironment(environment)` 注册 host-owned object，再在 leaf 代码中用 `useSecuritydeptContext().get(CLIENT_ENVIRONMENT)` 读取。
- 对 Angular frontend-oidc route redirect，应在 composition root 通过 `provideNativeWebEnvironment({ environment })` 提供 host-owned native web environment object。
- 对 Angular callback route，在 SSR-like test 或 custom shell 中 override `TOKEN_SET_CALLBACK_CURRENT_URL`，当 host 需要非默认 fallback navigation 或集中错误记录时，再 override `TOKEN_SET_CALLBACK_COMPONENT_OPTIONS`。
- 对 custom callback orchestration，调用 `CallbackResumeService.resume(url)` 或带显式 `controller` / `injector` / `getCurrentUrl` / `describeError` 的 React hook，而不是在普通 helper 里重新引入 page-global fallback 逻辑或 mode-specific copy。`CallbackResumeService.handleCallback(url)` 仅作为 compatibility wrapper 保留。

### Route Security And Matched Route Chains

Packages：

- `@securitydept/client`
- `@securitydept/client-react`
- `@securitydept/client-angular`

变更：

- Route requirements 从 matched route chains 计算。
- Child routes 继承 parent requirements，除非 adapter contract 明确 replace 或 merge。
- Framework adapters 应保持 provider-neutral，只表达 auth requirements，不表达 provider SDK 细节。

迁移：

- 将 protected routes 建模为 route-chain requirements，而不是 flat per-leaf checks。
- 避免跳过 parent requirements 的 app-local route guards。
- Product routing 与 chooser UI 留在 host app。

### Token-Set Callback And Readiness

Packages：

- `@securitydept/token-set-context-client`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

变更：

- Callback handling 是 keyed 且 readiness-aware 的。
- Duplicate、stale、missing、client-mismatch callback states 都是正式 callback outcomes。
- Hosts 应展示 typed callback failures，而不是解析 raw text。

迁移：

- 在 callback route 消费 state 前注册 token-set clients。
- 优先使用 framework callback components / guards。
- Failure UI 通过 structured code 与 recovery data 路由。

### Token-Set Registry Dynamic Lifecycle Semantics

Packages：

- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

变更：

- Canonical registry lifecycle verb 现在是 `register(entry)`、`unregister(key)`、`resetMaterialization(key)` 与 `dispose()`。
- Registry 现在把 configured 与 ready observability 显式拆开：`has()` / `registeredKeys()` / `registeredEntriesSnapshot()` / `registeredMetaSnapshot()` 描述已注册 entry，`readyKeys()` 描述已经完成 materialization 与 `start()` lifecycle 的 client。
- React token-set composition 现在改为 registry-first：在 composition root 注册 `provideTokenSetAuthRegistry(...)`，只有确实需要 callback resume handling 时才额外注册 `provideTokenSetCallbackResumeController(...)`，运行期 add/remove/reset flow 通过注入后的 registry 实例完成，不再依赖 `TokenSetAuthProvider` 或隐藏 lookup hook。Angular `TokenSetAuthRegistry` 现在暴露与 shared core 对齐的 lifecycle verb、registered snapshots、ready keys 与 `clientSignalFor()` 获取能力。

迁移：

- 将历史上表示“移除此 client registration”的 `reset(key)` 调用替换为 `unregister(key)`。
- 将失败后通过重新注册同一个 key 来重试/重建的流程替换为 `resetMaterialization(key)` 后再调用 `whenReady(key)`。
- 对 management UI 或 diagnosis，使用 registered snapshot 作为配置态真值，使用 `readyKeys()` 表示已启动 client membership，并通过 `clientSignalFor(key)` / `whenReady(key)` 访问 live client；不要再把 ready-only key 当作所有已配置 client 的来源。
- 在 React host 中，不要期待 prop 变化自动 reconcile token-set registration。运行期 lifecycle 变更应通过 `useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY)` 或其它持有的 registry 引用完成。

理由：

- 旧的 `reset(key)` 语义把“移除注册”和“使单个已 materialize service 失效”混在了一起。拆分 verb 后，可以让异步失效流程 race-safe，避免 stale materialization 回填已移除状态，也为 host 提供明确的 registered-vs-ready management surface。

### Token-Set Client Replay State 与 Registry Client Materialization

Packages：

- `@securitydept/client`
- `@securitydept/client/rx`
- `@securitydept/client-angular`
- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

变更：

- `TokenSetAuthRegistry.state`、`getState()` 与 `subscribe()` 现在是 canonical 的 topology/readiness observation surface。各类 snapshot helper 仍保留，但只是 `state.get()` 的同步 convenience。
- `@securitydept/client` 新增 replay signal primitives：`createReplaySignal()`、`createComputedReplaySignal()`、`createAndThenComputedReplaySignal()`、`readonlyReplaySignal()`、`isReplaySignalTrait()` 与 `ReplaySignalSlot<T>`。
- `ReadableReplaySignalTrait` 使用 `get()` 做类型安全的同步 slot 读取，并使用 `whenValue({ cancellationToken })` 做可取消的异步 value 等待。旧的同步 `value()` / `requireValue()` convenience method 不进入 public replay signal contract，因为它们无法区分 empty 与 `value(undefined)`。
- Registry-managed OIDC mode client 现在暴露 canonical per-client auth channels：`authDetermined`、`authSnapshot`、`isAuthenticated`、`authorizationHeaderValue` 是 replay channels；`lastAuthError` 与 `authOperations.*Pending` 是 plain signals。
- `TokenSetAuthService` 已从 token-set registry、React 与 Angular public surface 中移除。默认 `createTokenSetOidcAuthRegistry()` materialize mode client 本身，因此 `registry.whenReady()`、`registry.clientSignalFor()`、React Query readiness 与 Angular registry lookup 都返回 client。
- Registry-managed client 现在是显式启动的长期运行状态机。直接创建 client 默认不启动；只有 direct creation path 需要立即运行时才传 `autoStart: true`。Registry entry 不接受 `autoStart` 或 `autoRestore`；registry 负责 materialize client，并通过 start hook 调用 `client.start()`。
- `registry.whenReady()` 与 `registry.clientSignalFor()` 只有在恰好注册了一个 client 时才允许省略 key。省略 key 的调用会等待 lazy materialization 与 `start()` 完成，而不是只检查已经 ready 的 client。
- React 与 Angular adapter 不再各自维护 token freshness、access-token derivation 或 auto-restore 的业务状态实现。它们读取 mode client replay channels，只做 host integration。
- `@securitydept/client/rx` 现在是 `ReadableSignalTrait` 与 `EventStreamTrait` 的 canonical RxJS bridge。`signalToObservable` 不再由 `@securitydept/client-angular` 导出；Angular package 只保留 `bridgeToAngularSignal()`。

迁移：

- 通过 `registry.state`、`registry.getState()` 或 `registry.subscribe()` 观察 registry topology 与 readiness；`registeredKeys()` / `readyKeys()` / registered snapshot helper 只作为同步 convenience 使用。
- 如果宿主代码依赖 adapter-local token-set service 状态机或 `TokenSetAuthService`，请直接迁移到 mode client channels：首屏 readiness 使用 `authDetermined`，稳定 UI 使用 `authSnapshot`，route guard 使用 `isAuthenticated`，HTTP 使用 `authorizationHeaderValue`，按钮锁定使用 `authOperations.*Pending`。
- 将 `registry.require(key).client` 这类同步 service-wrapper access 替换为 async setup 中的 `await registry.whenReady(key)`，或 reactive host 中的 `useReadableSignal(registry.clientSignalFor(key))`。
- Multi-client host 应向 `whenReady(key)` 与 `clientSignalFor(key)` 传入显式 registry key。只有真实 single-client host 才继续使用省略 key 的写法。
- 将 `import { signalToObservable } from "@securitydept/client-angular"` 替换为 `import { toRxObservable } from "@securitydept/client/rx"`。
- Angular host 如需 RxJS auth state，应调用 `toRxObservable(client.authSnapshot)` 或其它 client replay signal。Replay signal observable 在首值前不会发出值，并会向 late subscriber replay 最后一个值。
- 在需要 aggregate registry reactivity 的 React host 中，使用 `useReadableSignal(registry.state)`，不要再维护 app-local 的 registered/ready mirror store。Per-client auth 应读取 client replay signals，而不是创建 service hook。

理由：

- 这样可以让 mode client 成为 per-client auth 的单一权威，删除重复的 adapter-local/service 状态机，避免把不相关 UI 状态压成单一 phase enum，并让 RxJS bridge 从 Angular-owned 收口为 framework-neutral 公共能力。

## 当前非目标

这些不是当前 SDK baseline 的迁移目标：

- mixed-custody token ownership
- full BFF / server-side token-set ownership
- SDK 内建 chooser UI
- app-specific business API wrappers
- product copy、toast policy 或 route table ownership
- 非 TypeScript SDK productization

## 添加新迁移说明

未来非 experimental breaking changes 使用以下结构：

```markdown
### Package Or Subpath: Short Description

Package: `@securitydept/example`

变更：

- What changed.

迁移：

- What adopters must do.

理由：

- Why the break is necessary.
```

同时更新 `sdks/ts/public-surface-inventory.json` 以及证明新 contract 的聚焦型验证测试。

---

[English](../en/110-TS_SDK_MIGRATIONS.md) | [中文](110-TS_SDK_MIGRATIONS.md)
