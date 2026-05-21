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

- `public-surface-inventory.json` 是 package/subpath stability 与 evidence 的 machine-readable authority。
- 本文是 adopter-readable migration companion。
- 非 experimental breaking changes 必须同时更新 inventory 与本指南。
- Additive changes 如果需要 adopter 主动启用更安全行为，也应记录在这里。

## 当前迁移说明

### 统一 Injector 与唯一 React Context

Packages：

- `@securitydept/client/injection`
- `@securitydept/client-react`
- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

变更：

- `@securitydept/client/injection` 现在拥有 framework-neutral DI authority：`SecuritydeptInjectorTrait` 是读取侧最小 contract，只表达 `get()`；`SecuritydeptInjector` 是 SDK runtime/facade，负责 provider 解析、parent 继承、override 与 `has()` 诊断。
- React 侧现在只有一组 SDK Context：`SecuritydeptContext`、`SecuritydeptProvider`、`useSecuritydeptContext()`，全部位于 `@securitydept/client-react`。
- React domain package 不再导出 `BasicAuthContextProvider`、`SessionContextProvider`、`BackendOidcModeContextProvider`、`TokenSetAuthProvider`、`useBasicAuthContext()`、`useSessionContext()`、`useBackendOidcModeContext()`、`useTokenSetAuthRegistry()` 等 domain-specific Context / Provider / keyed state helper。
- React domain package 改为导出 injection token、provider factory、plain factory 与显式 callback/component bridge。状态读取统一通过 `useReadableSignal(...)` 完成。

迁移：

- 用 `SecuritydeptProvider` 包住 React subtree；可以传入已有 `injector`，也可以通过 `providers` / `parentInjector` 派生 child injector。
- 将 `XxxContextProvider` / `useXxxContext()` 迁移为 `useSecuritydeptContext().get(TOKEN)`。
- 将 `useTokenSetAuthState(key)` / `useTokenSetAccessToken(key)` / `useTokenSetAuthRegistryState()` 迁移为 `const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY)`，再配合 `useReadableSignal(registry.require(key).state)` 或 `useReadableSignal(registry.state)`。
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
- `@securitydept/token-set-context-client/backend-oidc-mode/web`

变更：

- Framework-neutral host capability resolution 现在由 client foundation 通过 typed `ClientEnvironment`、`WebClientEnvironment`、`PageClientEnvironment` 对象拥有。
- 历史 `ClientRuntime` 命名已收口为 `ClientEnvironment`。Core client constructor 依赖属于 environment，不是第二层 runtime。Canonical path 是 `environment.transport`、`environment.sessionStore` 等顶层字段。
- Web host preset 是面向 browser page、browser worker、service worker、browser-extension background 的显式 factory entry，不是 automatic host detection。
- Context 与 adapter public helper 使用同一边界。Backend-OIDC web helper、basic-auth/session redirect helper，以及 framework adapter convenience helper 不得各自重复声明或猜测 transport/store/scheduler/clock/page dependencies。
- Backend-OIDC web helper 按 host boundary 拆分：page-only helper 使用 page-explicit 命名；worker-safe helper 必须使用 host-injected environment/capability 或 restore-only 行为。

迁移：

- 在 host composition root 创建一个 environment，并把 environment object 本身沿 provider/adapter 传递。不要让 adopter 读取 `environment.runtime`；直接使用 `ClientRuntime` / `createRuntime()` / `createWebRuntime()` / `deriveClientRuntime()` 的代码应迁移到 `ClientEnvironment`、`createClientEnvironment()`、`createWebClientEnvironment()` 或 `deriveClientEnvironment()`。
- 即使值是 page-scoped 或异步解析的，public option key 也继续叫 `environment`。不要引入 `pageEnvironment` 作为并行 key；是否需要 page capability 由类型表达。
- Real page/tab/popup callback flow 使用 `createBrowserPageClientEnvironment(options)`。
- Worker-like host 使用 `createBrowserWorkerClientEnvironment(options)`、`createServiceWorkerClientEnvironment(options)` 或 `createBrowserExtensionBackgroundClientEnvironment(options)`；需要 persistence/session store 时必须显式注入。
- 不要在 service worker 或 extension background 中执行 page callback bootstrap。那里只运行 restore/token-state API；callback capture 只在 real page/popup document 中运行，或在测试中显式传入 fake page/callback-fragment capability。
- 将 ambiguous page-global helper 名称迁移到已经改名的 page-explicit 名称，例如 `currentPageLocationAsPostAuthRedirectUri()`、`buildAuthorizeUrlReturningToCurrentPage()`、`bootstrapBackendOidcModePageClient()` 与 `captureBackendOidcModePageCallbackFragment()`。
- 将既有 redirect/popup helper（`loginWithBackendOidcRedirect()`、`loginWithBackendOidcPopup()`、`relayBackendOidcPopupCallback()`）视为 page-only helper，虽然历史名称保持不变；测试或 host wrapper 中应传入显式 page capability（`PageLocationHistoryCapability`）或携带 page capability 的 `environment`。现在 canonical 的共享 token-set OIDC 浏览器 contract 是 `OidcRedirectLoginClient` 上的 `loginWithRedirect({ environment, postAuthRedirectUri })`；通过 `createBackendOidcModeWebClient(...)` materialize 的 backend web client 会暴露这个方法，而 `loginWithBackendOidcRedirect()` 退回为兼容/convenience wrapper。Popup login 还要求显式 callback-fragment capability，browser-state reset 要求显式 `callbackFragmentStore`。
- Frontend-mode browser materialization 应在 host composition root 创建 `createFrontendOidcModeWebClientEnvironment(...)`，再传给 `createFrontendOidcModeBrowserClient({ environment, ... })`；materializer 不再在缺少 `environment` 时创建默认 environment。
- 当 browser/page environment ownership 需要在 framework route 或 command 之间保持稳定时，应创建 provider/injector-scoped `ClientEnvironmentService`，并在 command/event flow 中使用 `await service.resolvePageEnvironment()`，在 Suspense-compatible render path 中使用 `service.readPageEnvironment()`，而不是继续发明 app-local module singleton。
- 将会读取或写入 `window.location` 的 basic-auth/session `/web` redirect helper 视为 page helper；要么留在 real page context，要么注入显式 navigation capability。
- Framework provider/DI registration function 可以持有完整 environment composition；普通 hook、guard、interceptor、service 或 convenience helper 不应各自接受一整套分散 dependency bag。
- 不要通过 `globalThis.location` 推断 page capability；page helper 需要 `window.location` 与 `window.history.replaceState`。

理由：

- 非 client-bound helper 已经开始重复 dependency bag 并隐藏读取 `window.*` default。Typed client environment 在保持 core dependency wiring 显式的同时，为 helper 提供共享、可测试、按 host 划分的 capability boundary。

### Token-Set Event-Driven Auth Flow

Packages：

- `@securitydept/client/events`
- `@securitydept/token-set-context-client/orchestration`
- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-angular`
- `@securitydept/token-set-context-client-react`

变更：

- Token-set client 现在暴露 `authEvents` 与 `ensureAuthForResource(options)`，作为 route/request/resume 的 canonical async barrier。
- `ensureFreshAuthState()` 与 `ensureAuthorizationHeader()` 仍是 compatibility wrapper；新的 adapter 代码应显式传入 `route_guard`、`resume`、`http_interceptor` 或 `authorized_transport` 等 source。
- Authorization-header event 可以包含 opaque temporary token handle descriptor，但不得包含 raw access、refresh 或 ID token value。

迁移：

- Route admission 与 resume recovery 优先使用 `ensureAuthForResource({ source, forceRefreshWhenDue: true })`。
- Protected HTTP request 前优先使用 `ensureAuthForResource({ source, needsAuthorizationHeader: true, forceRefreshWhenDue: true })`。
- 需要 lifecycle telemetry 时订阅 `authEvents`，不要从 redirect、throw error 或 raw token value 反推 auth flow state。

理由：

- 短 access-token lifetime 需要 restore、resume、route、interceptor、generic transport 与 React Query 共享同一个 refresh barrier，而不是继续堆 adapter-local freshness patch。

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

- shared client foundation 拥有 reference apps 和 adapters 使用的 operation correlation primitives 与 error-presentation reader helpers。
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
- `client-react/environment-service` 与 `planner-host` 现在只导出 injection token 与 provider factory：例如 `CLIENT_ENVIRONMENT_SERVICE` + `provideClientEnvironmentService()`，`AUTH_PLANNER_HOST` + `provideAuthPlannerHost()`。
- `basic-auth` / `session` / `token-set` React adapter 不再拥有 domain-specific Provider / Context hook；它们导出 token、plain factory、provider factory，以及显式 callback/component bridge。token-set 多客户端组合现在改为显式 registry/controller wiring，而不是 SDK 预设 runtime bundle。
- Angular `createTokenSetOidcLoginRedirectHandler()` 现在是 route-login helper。它的 public key 仍然只叫 `environment`，但这个值现在表示稳定的 page-environment source；Angular DI 应通过 `@securitydept/client-angular` 的 `providePageClientEnvironment({ environment })` 提供该 source。helper 面向共享的 `OidcRedirectLoginClient` contract，并会在 guard flow 中 await 最终 page capability 后再调用 `loginWithRedirect()`。
- Angular `CallbackResumeService` 与 React `useTokenSetCallbackResume({ getCurrentUrl, describeError })` 现在桥接 `@securitydept/token-set-context-client/registry` 的 shared `TokenSetCallbackResumeController`。Angular `TokenSetCallbackComponent` 仍是该 service 之上的 page-only convenience，并继续使用 injectable current URL 与 host policy tokens。

迁移：

- 在 framework composition root 构建 browser environment，再通过 `SecuritydeptProvider` + provider factory 把这些 dependency 注册到 injector 中。
- 如果 app 依赖旧的 provider/service construction 副作用来探测 session，应显式创建 `SessionContextController`，并在 host-owned lifecycle 中调用 `controller.refresh()`。
- 对 React render path，如需 environment service，应通过 `provideClientEnvironmentService()` 注册，再在 leaf 代码中用 `useSecuritydeptContext().get(CLIENT_ENVIRONMENT_SERVICE)` 读取；需要 page capability 的地方继续显式调用 service 的 `resolvePageEnvironment()` / `readPageEnvironment()` 或直接传入 capability。
- 对 Angular frontend-oidc route redirect，应在 composition root 通过 `providePageClientEnvironment({ environment })` 提供一个稳定的 page-environment source，其中 `environment` 通常是 provider-scoped `ClientEnvironmentService` 或另一个 inject-safe 稳定 resolver。
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
- Registry 现在把 configured 与 materialized observability 显式拆开：`has()` / `registeredKeys()` / `registeredEntriesSnapshot()` / `registeredMetaSnapshot()` 描述已注册 entry，`readyKeys()` / `readyEntriesSnapshot()` 描述已 materialize service。
- React token-set composition root 现在是 `createTokenSetAuthRuntime({ clients })` + `provideTokenSetAuthRuntime(runtime)`；运行期 add/remove/reset flow 应通过注入后的 registry 实例完成，不再依赖 `TokenSetAuthProvider` 或隐藏 lookup hook。Angular `TokenSetAuthRegistry` 现在暴露与 shared core 对齐的 lifecycle verb 和 registered/ready snapshot。

迁移：

- 将历史上表示“移除此 client registration”的 `reset(key)` 调用替换为 `unregister(key)`。
- 将失败后通过重新注册同一个 key 来重试/重建的流程替换为 `resetMaterialization(key)` 后再调用 `whenReady(key)`。
- 对 management UI 或 diagnosis，使用 registered snapshot 作为配置态真值，使用 ready snapshot 表示 live service state；不要再把 ready-only key 当作所有已配置 client 的来源。
- 在 React host 中，不要期待 prop 变化自动 reconcile token-set runtime。运行期 lifecycle 变更应通过 `useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY)` 或持有的 runtime/registry 引用完成。

理由：

- 旧的 `reset(key)` 语义把“移除注册”和“使单个已 materialize service 失效”混在了一起。拆分 verb 后，可以让异步失效流程 race-safe，避免 stale materialization 回填已移除状态，也为 host 提供明确的 registered-vs-ready management surface。

### Token-Set Core Signal State 与 Canonical Rx Bridge

Packages：

- `@securitydept/client/rx`
- `@securitydept/client-angular`
- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

变更：

- `TokenSetAuthRegistry.state`、`getState()` 与 `subscribe()` 现在是 canonical 的 topology/readiness observation surface。各类 snapshot helper 仍保留，但只是 `state.get()` 的同步 convenience。
- `TokenSetAuthService` 现在位于 `@securitydept/token-set-context-client/registry`，成为共享的 per-client auth material owner。它的 `state` 拥有 snapshot、派生 token material、freshness、restore lifecycle 与 disposed state。
- React 与 Angular adapter 不再各自维护 token freshness、access-token derivation 或 auto-restore 的业务状态实现。React hooks 与 Angular bridge 现在都读取 shared core service/registry state。
- `@securitydept/client/rx` 现在是 `ReadableSignalTrait` 与 `EventStreamTrait` 的 canonical RxJS bridge。`signalToObservable` 不再由 `@securitydept/client-angular` 导出；Angular package 只保留 `bridgeToAngularSignal()`。

迁移：

- 通过 `registry.state`、`registry.getState()` 或 `registry.subscribe()` 观察 registry topology 与 readiness；`registeredKeys()` / `readyKeys()` / snapshot helper 只作为同步 convenience 使用。
- 如果宿主代码依赖 adapter-local 的 token-set service 状态机，应迁移到 `@securitydept/token-set-context-client/registry` 的共享 `TokenSetAuthService` contract，并把 React/Angular service wrapper 视为 host bridge。
- 将 `import { signalToObservable } from "@securitydept/client-angular"` 替换为 `import { toRxObservable } from "@securitydept/client/rx"`。
- 在需要 aggregate registry reactivity 的 React host 中，使用 `useReadableSignal(registry.state)`，不要再维护 app-local 的 registered/ready mirror store。

理由：

- 这样可以把 framework-neutral core signal state 固定为单一权威，删除重复的 adapter-local 状态机，并让 RxJS bridge 从 Angular-owned 收口为 framework-neutral 公共能力。

### Token-Set Registry 显式 Service Wiring

Packages：

- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

变更：

- `CreateTokenSetAuthRegistryOptions` 现在变为 explicit-only。`dispose`、`accessTokenOf`、`ensureAccessTokenOf`、`ensureAuthorizationHeaderOf`、`ensureAuthForResourceOf`、`authEventsOf` 与 `idleScheduler` 不再可选，而是必传。
- `createTokenSetOidcAuthRegistry(...)` 不再根据 service 的运行时 shape 自动补齐 wiring。调用方必须显式提供 `materializeService` 以及其它所有 registry capability mapping。
- `TokenSetAuthService` 现在提供与这些 option 同名的静态 helper，作为 canonical OIDC wiring 入口：`materializeService`、`dispose`、`accessTokenOf`、`ensureAccessTokenOf`、`ensureAuthorizationHeaderOf`、`ensureAuthForResourceOf`、`authEventsOf`。

迁移：

- 构造 `createTokenSetAuthRegistry(...)` 时，即使在测试或 single-client host 中，也要传完整 option object。
- 构造 `createTokenSetOidcAuthRegistry(...)` 时，不要再依赖“省略某些 option 让 runtime 根据 service shape 自动推断 capability”的旧行为。
- 对共享 core `TokenSetAuthService`，优先直接使用这些静态 helper：

```ts
const registry = createTokenSetOidcAuthRegistry({
	materializeService: TokenSetAuthService.materializeService,
	dispose: TokenSetAuthService.dispose,
	accessTokenOf: TokenSetAuthService.accessTokenOf,
	ensureAccessTokenOf: TokenSetAuthService.ensureAccessTokenOf,
	ensureAuthorizationHeaderOf:
		TokenSetAuthService.ensureAuthorizationHeaderOf,
	ensureAuthForResourceOf: TokenSetAuthService.ensureAuthForResourceOf,
	authEventsOf: TokenSetAuthService.authEventsOf,
	idleScheduler: (callback) => {
		const handle = setTimeout(callback, 0);
		return () => clearTimeout(handle);
	},
});
```

理由：

- 隐式 shape check 会让 registry 行为取决于 service instance 在 runtime 恰好带了哪些方法。把所有 mapping 改为 upfront 显式传入后，contract 更可审计，也能避免 capability 默默漂移，并让 adapter wiring 在调用点保持直观。

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

同时更新 `sdks/ts/public-surface-inventory.json` 以及证明新 contract 的 focused evidence tests。

---

[English](../en/110-TS_SDK_MIGRATIONS.md) | [中文](110-TS_SDK_MIGRATIONS.md)
