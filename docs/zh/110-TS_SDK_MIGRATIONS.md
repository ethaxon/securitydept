# TypeScript SDK 迁移记录

SecurityDept 尚未到 1.0。只要能移除错误 ownership model、使 capability 显式化或消除 public ambiguity，就会有意引入 breaking change。本文只列出对当前 adopter 仍有迁移价值的事项；已发布历史属于 [CHANGELOG](../../CHANGELOG.md)。

## 被撤销的 Token-Set 会话

刷新操作默认将确认撤销恢复为未认证。依赖刷新 Promise 拒绝的应用应设置 `refreshErrorPolicy: "throw"`；需要保留运行时抛错但允许启动恢复时，设置 `"revokeAsUnauthenticatedOnInit"`。正确处理原有的可空刷新返回值，不应将 `null` 视为已认证。参阅[刷新错误恢复](007-CLIENT_SDK_GUIDE.md#刷新错误恢复)。

## 迁移规则

每个 SDK breaking change 都必须：

1. 同步修改 package export 与 `public-surface-inventory.json`；
2. 更新 focused API contract 和迁移记录；
3. 添加 type-level 与 behavior coverage；
4. 除非 compatibility 有清晰且受限的价值，否则删除 obsolete alias。

## 显式 `FoundationEnvironment`

environment construction 改为 capability based。canonical base transport key 是 `environment.transport`，`externalTransport` 不再是 compatibility alias。`time`、`realmStorage`、`span`、`tracing` 是 required baseline capability；browser-only capability 保持 optional。

composition root 应通过对应 host creator 构造 `FoundationEnvironment` 后传给 client。helper 不得隐式读取 browser global 或 storage。

## Base Transport 和 Authorized Transport

`BaseTransportTrait` 是 neutral HTTP executor。`ExternalTransportTrait` 与 `ManagedTransportTrait` 是从该 base 派生的 role type。environment 持有 neutral `transport`；authorization 从 base transport 加 authorization-header replay signal 派生为 managed transport。

构造 authorized transport 时，将 option field 从 `externalTransport` 改名为 `baseTransport`。不要维护两个 environment transport 概念。

## Reactive Interoperability

`SignalTrait`、`EventStreamTrait`、`CancellationTokenTrait` 已提供 observable interop。public interface 仍是这些 SDK trait；internal implementation 可以直接使用 RxJS operator 和 `@securitydept/client/rx` utility。

如果自定义 Observable wrapper 只转发 subscription，应替换为 direct RxJS interop，例如 `from(client.authSnapshot)`。public trait API 需要 RxJS `NEVER` 或 `EMPTY` 语义时，使用 `createNeverEventStream()` 或 `createEmptyEventStream()`。不得用 raw Observable 替换 public SDK trait。

Basic Auth、Session、Token Set 的 lifecycle event 不再 replay buffered history。依赖 late replay 读取当前状态的代码应改用对应 Resource；需要诊断历史时使用显式 tracing/event-history store。failure event variant 现在携带 `error: ClientError`，不再携带 `errorSummary`；使用 `isClientErrorEvent` 过滤，UI message 使用 `readErrorPresentationDescriptor()`，仅在 logging/trace 序列化边界派生 `ErrorSummary`。

## Span 和 Trace Context

span 是 foundation capability，不是 telemetry 子能力。context propagation 保持显式。在 client 与 operation boundary fork frame，将跨 provider identity 写入 `SpanSharedAttributeName`，provider-only detail 通过 `setAttributes(attributes, { providerId })` 写入。attribute 使用 `getAttributes()` 或 `getRootToNodeAttributes()` 读取；原 `span.attributes` getter 已不再属于 contract。

operation instrumentation 现在接收 `traceAttributes`，不再接收 `fields`。trace-only detail 属于 `TRACING_SPAN_ATTRIBUTE_PROVIDER_ID`；canonical shared operation key 是 `operation.name`，不是 `operationName`。`TracingEvent` 携带 live span，因此 replay/buffering subscriber 必须在接收时同步读取 `span.getRootToNodeAttributes({ providerId: TRACING_SPAN_ATTRIBUTE_PROVIDER_ID })`。attribute value 使用 immutable `SpanAttributeValue` contract；span core 不执行防御性深复制。

`TraceTimelineStore` 不再要求 `mnemonist` peer；如果直接依赖 `mnemonist` 仅用于 timeline subscriber，可以将其删除。store 现在使用 SDK 内部固定容量 ring buffer，同时保持 public behavior：通过 `latestEntry: EventStreamTrait<TraceTimelineEntry | null>` 订阅边沿通知，其中 `null` 表示 timeline 已清空；当前 readonly array snapshot 通过 `entries` getter 按需读取。store 不会为每个新 entry 发布完整数组 signal value。

`ClientError` 现在首次捕获 shared/error-provider span path。`readErrorPresentationDescriptor()` 默认在标题中加入最深层 client identity 与 operation name。需要本地化 context label 的应用应传入 `contextFormatter`；只有明确不要 context prefix 时才传 `null`。shared/error attribute 中不得写入 token、authorization header、敏感 URL 参数或 provider payload。

Error presentation helper 现在只接受 canonical `ClientError` instance，不再识别结构相似的普通对象。TypeScript import 应将 `ErrorPresentation` 改为 `ServerErrorPresentation`、`ErrorCodePresentationDescriptor` 改为 `ErrorCodePresentation`、`ErrorPresentationActionDescriptor` 改为 `ErrorRecoveryActionDescriptor`。最终 `ErrorPresentationDescriptor` 不再重复 `kind`、`source`、`retryable` 这些 machine-only field；policy logic 如需使用，应读取原始 `ClientError`。

删除只为复制 span nesting 的 token-set global outcome/source carrier field，改为在行为边界记录 local trace attribute。

## Token-Set Workflow 和 State Ownership

`BaseOidcModeClient` 是 lifecycle host 和唯一 in-memory snapshot authority。restore、freshness/refresh、clear 使用 closed planner，返回 discriminated final candidate；serialized top-level workflow 提交一次 final determination。

删除 controller-era duplicate snapshot/header state 和 refresh-barrier concept。`start()` 是 initial bootstrap API；`restorePersistedState()` 仅作为 manual persistence re-sync command 保持 public，例如 external storage change 后同步。

workflow source 取代 auth-check trigger terminology。page-resume 与 refresh-timer source 只入队 lifecycle work，不持有 state，也不能绕开 serialization。

## Token-Set Events

auth event 是 direct discriminated union，event `type` 固定 payload shape。不得再使用已废弃的 `TokenSetAuthEventPayloadMap`、`AuthCheck*` event、`TokenSetAuthFlowReason`、`TokenSetAuthFlowOutcome` 或 `authCheckReason` contract。

只有 refresh event 携带 freshness 与 refresh-material fact。auth event payload 不投影 snapshot token material 或 authorization header。failure event 会携带进程内 `ClientError`，不得直接序列化其 cause。聚合 event 的 consumer 必须保留 source contract，或显式建模 aggregation-only envelope，不能静默回填 source field。

## Persistence

persistence 遵循 committed snapshot policy，而不是第二份 snapshot authority。determination 使用 `persistPolicy: "follow_client" | "skip"`；在 follow policy 下 `snapshot === null` 自然代表 clear persisted state。client 会先提交内存 snapshot，再尝试对应的 persistence update。persistence failure 只记录为 trace event，不会回滚或 reject 本来已经成功的 authentication determination。

## Router 和 Callback Composition

router integration 使用 `RouterTrait` 与 URI reference type。token-set factory 负责 callback input resolution，并在 factory construction 中 start。由 registry 拥有的 client 以 registry readiness 为 initial readiness boundary，不再 direct call persisted restore。

`createRouterForAngular(...)` 现在会在内部组合 Angular Router 与 native-web routing。native-web creator field 扁平混入同一个 options object；不要再注册第二个 environment router：

```ts
const router = createRouterForAngular({
  router: angularRouter,
  location: window.location,
  history: window.history,
  window,
});
```

同一组 native-web field 也可以通过 `provideEnvironment({ routerForAngularCreateOptions: ... })` 传入。push/replace 使用 Angular Router，external navigation 则要求 native-web capability，并用它完成 full-document redirect。没有 native-web routing 的 host 仍可执行 internal navigation，但 external request 会以 `client_angular.router.native_web_router_unavailable` 失败。

TanStack Router creator 没有新增 call-site option。adapter 现在把 internal push/replace request 映射到 `to`，把 external request 映射到 `href`；应删除将 absolute authorization URL 改写为 internal `to` value 的 wrapper。

## Framework Composition

| 旧 integration pattern | 当前 contract |
| --- | --- |
| 每个 auth family 各自使用 domain-specific React Provider 或 Context | 通过 `createEnvironmentForReact(...)` 组合 environment，安装单一 `SecuritydeptProvider`，再用 `useSecuritydeptContext()` 解析 dependency。context-family React package 只暴露 focused hook/callback bridge，不再创建竞争的 state context。 |
| client 自行发现 browser global 或 app-local fetch layer | 在 composition root 使用 `createEnvironmentForNativeWeb(...)` 构造显式 Web environment，再将结果 environment 或 injector 传入 client composition。 |
| Angular service 分别持有 router、transport、client state | 使用 `provideEnvironment(...)` 组合 Angular router、`HttpClient`、injector 与 destruction wiring。context adapter 消费这个 foundation environment。 |
| app-local token-set callback parsing | React 中使用 `useTokenSetFrontendCallback()` / `useTokenSetBackendCallback()`；Angular 中在行为符合 host route 时使用 `TokenSetFrontendCallbackComponent` / `TokenSetBackendCallbackComponent`。 |

## Token-Set Registry 和 Route Security

registry 是 keyed lifecycle owner，不是第二个 auth-state model。通过 `provideTokenSetClientRegistry(...)` 注册 entry；通过 `clientResourceFor(key)` 获取 materialized client，需要 asynchronous readiness 时等待 `whenValue()`。`authEvents` 聚合所有 ready client 的事件，`errors` 则合并 client operation error 与 factory/materialization error。`unregister(key)` 会移除 registration、停止转发该 client 的事件，并 dispose 已 materialized 的 client。

将包括已移除 `TokenSetAuthService` 在内的旧 service-wrapper access 迁移为直接使用 mode client。根据 host concern 分别读取其 `authSnapshot`、`isAuthenticated`、`authorizationHeaderValue`、operation signal 与 public event，而不是重建一个 adapter-local combined state machine。

route protection 使用 `secureTokenSetRouteRoot(...)` 与 `secureTokenSetRoute(...)` 声明 requirement。React 的 TanStack Router helper 通过 registry planner 运行；Angular 还提供 `provideTokenSetRequirementPlannerHost()`、`createTokenSetCanActivate()` 和 `createTokenSetCanActivateChild()`。这些 API 只表达 authentication requirement；application redirect policy 与 route UI 仍由 host 拥有。

first boot 时，直接创建的 client 调用 `start()`。不要为了让 registry-owned client ready 而调用 `restorePersistedState()`；它仍是 external persistence change 后的 manual persistence re-sync command。

## 验证清单

迁移完成前：

- 用 `mise` 运行相关 TypeScript typecheck/test；
- 对照 public-surface inventory 验证 export；
- 搜索已删除 vocabulary 和旧 import key；
- 运行 `just lint-ts` 与 `git diff --check`；
- 更新双语文档和 downstream example/wrapper。

---

[English](../en/110-TS_SDK_MIGRATIONS.md) | [中文](110-TS_SDK_MIGRATIONS.md)
