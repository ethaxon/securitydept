# TypeScript SDK 迁移记录

SecurityDept 尚未到 1.0。只要能移除错误 ownership model、使 capability 显式化或消除 public ambiguity，就会有意引入 breaking change。本文只列出对当前 adopter 仍有迁移价值的事项；已发布历史属于 [CHANGELOG](../../CHANGELOG.md)。

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

## Span 和 Trace Context

span 是 foundation capability，不是 telemetry 子能力。在 top-level workflow boundary fork child span，在其下运行/记录 local work。trace/event consumer 可以依赖 span context，但 public API 不能假定 host 一定提供 automatic propagation。

删除只为复制 span nesting 的 token-set global outcome/source carrier field，改为在行为边界记录 local trace attribute。

## Token-Set Workflow 和 State Ownership

`BaseOidcModeClient` 是 lifecycle host 和唯一 in-memory snapshot authority。restore、freshness/refresh、clear 使用 closed planner，返回 discriminated final candidate；serialized top-level workflow 提交一次 final determination。

删除 controller-era duplicate snapshot/header state 和 refresh-barrier concept。`start()` 是 initial bootstrap API；`restorePersistedState()` 仅作为 manual persistence re-sync command 保持 public，例如 external storage change 后同步。

workflow source 取代 auth-check trigger terminology。page-resume 与 refresh-timer source 只入队 lifecycle work，不持有 state，也不能绕开 serialization。

## Token-Set Events

auth event 是 direct discriminated union，event `type` 固定 payload shape。不得再使用已废弃的 `TokenSetAuthEventPayloadMap`、`AuthCheck*` event、`TokenSetAuthFlowReason`、`TokenSetAuthFlowOutcome` 或 `authCheckReason` contract。

只有 refresh event 携带 freshness 与 refresh-material fact。auth event payload 绝不暴露 raw token material 或 authorization header。聚合 event 的 consumer 必须保留 source contract，或显式建模 aggregation-only envelope，不能静默回填 source field。

## Persistence

persistence 遵循 committed snapshot policy，而不是第二份 snapshot authority。determination 使用 `persistPolicy: "follow_client" | "skip"`；在 follow policy 下 `snapshot === null` 自然代表 clear persisted state。当前 client 在 determination path 中执行同步，并将 sync failure 记录为 trace event。独立的 best-effort persistence workflow/event surface 是计划工作，不是当前 public behavior。

## Router 和 Callback Composition

router integration 使用 `RouterTrait` 与 URI reference type。token-set factory 负责 callback input resolution，并在 factory construction 中 start。由 registry 拥有的 client 以 registry readiness 为 initial readiness boundary，不再 direct call persisted restore。

## Framework Composition

| 旧 integration pattern | 当前 contract |
| --- | --- |
| 每个 auth family 各自使用 domain-specific React Provider 或 Context | 通过 `createEnvironmentForReact(...)` 组合 environment，安装单一 `SecuritydeptProvider`，再用 `useSecuritydeptContext()` 解析 dependency。context-family React package 只暴露 focused hook/callback bridge，不再创建竞争的 state context。 |
| client 自行发现 browser global 或 app-local fetch layer | 在 composition root 使用 `createEnvironmentForNativeWeb(...)` 构造显式 Web environment，再将结果 environment 或 injector 传入 client composition。 |
| Angular service 分别持有 router、transport、client state | 使用 `provideEnvironment(...)` 组合 Angular router、`HttpClient`、injector 与 destruction wiring。context adapter 消费这个 foundation environment。 |
| app-local token-set callback parsing | React 中使用 `useTokenSetFrontendCallback()` / `useTokenSetBackendCallback()`；Angular 中在行为符合 host route 时使用 `TokenSetFrontendCallbackComponent` / `TokenSetBackendCallbackComponent`。 |

## Token-Set Registry 和 Route Security

registry 是 keyed lifecycle owner，不是第二个 auth-state model。通过 `provideTokenSetClientRegistry(...)` 注册 entry；通过 `clientResourceFor(key)` 获取 materialized client，需要 asynchronous readiness 时等待 `whenValue()`。`unregister(key)` 会移除 registration，并 dispose 已 materialized 的 client。

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
