# Client SDK 指南

本文定义 TypeScript SDK contract，是 package boundary 与 host-integration rule 的权威来源。`apps/webui` 下的 application-specific code 是参考实现，不是 public API。

## Package Families

| Package | 职责 |
| --- | --- |
| `@securitydept/client` | Foundation traits：environment、transport、state/resource、event、cancellation、span、tracing、injection、protocol 和 URL helper。 |
| `@securitydept/client-react` / `@securitydept/client-angular` | foundation trait 的 framework bridge。 |
| `@securitydept/basic-auth-context-client*` | Basic-Auth boundary observation、login navigation 与本地投影清理。 |
| `@securitydept/session-context-client*` | cookie-session refresh、user-info、login 和 logout integration。 |
| `@securitydept/token-set-context-client*` | token-set OIDC mode、lifecycle orchestration、registry、access-token substrate 和 framework adapter。 |

`*` 表示 core package 加上可选的 React 或 Angular package。workspace 中标为 `private` 的 package 是 tooling、test 或 reference-app dependency，不是受支持的 npm product。

## Public Imports

只能使用声明的 package export。已发布的 `@securitydept/client` subpath 为 `./web`、`./webext`、`./server`、`./rx`、`./test`。token-set 的 focused subpath 为：

- `./orchestration`
- `./frontend-oidc-mode`
- `./backend-oidc-mode`
- `./access-token-substrate`
- `./registry`

`sdks/ts/public-surface-inventory.json` 与每个 package 的 `exports` 字段是可执行的 source of truth。不得 import source file、reference-app glue 或未记录的 internal path。

## 稳定性和变更纪律

public-surface inventory 为每个已发布 package 和 subpath 指定稳定性等级。`0.x` 不意味着所有 public surface 都可以随意破坏。

| 稳定性 | 变更纪律 |
| --- | --- |
| stable | 先弃用。移除前至少保留一个 minor release，并提供 migration note。 |
| provisional | breaking change 必须有 migration note 和 review 可见的理由。 |
| experimental | 可以立即 breaking；在对 adopter 有帮助时记录简短 migration note。 |

当前的总体划分是：`@securitydept/client` 与 core context-client root 为 stable；framework adapter、host-specific subpath 和 token-set focused subpath 通常为 provisional；`@securitydept/client/test` 是 experimental。单个 export 的等级以 inventory 为准。

## 受支持的 Host Entrypoint

| Entrypoint | 适用场景 | 边界 |
| --- | --- | --- |
| `@securitydept/client/web` | native browser page。 | 从显式 Web input 创建 router、page lifecycle、popup 与 browser storage trait。 |
| `@securitydept/client/webext` | browser-extension UI、background 或 shared extension code。 | 适配 extension routing/storage API，不把 extension global 暴露给 core client。 |
| `@securitydept/client/server` | request-scoped server 或 SSR integration。 | 构造 request-scoped environment 和 transport，不假定 browser global 存在。 |
| `@securitydept/client/rx` | 内部 SDK 或 host-side RxJS composition。 | 提供 RxJS-backed SDK implementation 与 command/resource utility；public trait 自身提供 observable interop。 |
| `@securitydept/client/test` | SDK test 和 example。 | experimental test-only helper，不是 adopter runtime dependency。 |

在 composition root 使用 `createEnvironmentForNativeWeb`、对应的 WebExtension creator 或 `createEnvironmentForServer`。这些 helper 都不会为 client 做隐式 host detection。

## 显式 Environment

client 在 construction 时接收 `FoundationEnvironment`。必需基线为：

```ts
interface FoundationEnvironment {
  injector: SecuritydeptInjector;
  transport: BaseTransportTrait;
  time: TimeTrait;
  realmStorage: SyncStorageTrait;
  span: SpanTrait;
  tracing: TracingTrait;
}
```

`persistentStorage`、`sessionStorage`、`router`、`pageLifecycle`、`popup`、`idleCallback` 是 optional capability。client/helper 不得静默获取缺失的 host capability。应使用 `@securitydept/client/web`、`webext`、`server` 中的 host-specific environment creator，或在 composition root 显式提供 capability。

`transport` 是 neutral base transport。authenticated transport 从 base transport 加 replaying authorization-header signal 派生；它不是第二个 environment field，也不让 environment 持有 auth state。

## Public API 设计规则

- public function 接受 optional input 时使用 options object；不要增加含义不明确的 positional second parameter。
- enum-like string domain 定义为具名 `const` object 及其派生 type。public contract 和重复 telemetry vocabulary 使用具名 constant，不要散落 raw string。
- 如果一个 short、single-use helper 只增加跳转，则保持 inline；只有复用、建立稳定边界或能显著澄清复杂逻辑时才提取。
- required host capability 必须显式传入。helper 可以用 `null` 或 `undefined` 表示 optional capability unavailable，但不得静默获取 browser、storage 或 environment fallback。
- 所有已发布 package 都声明 `sideEffects: false`。不得依赖 import-time global patch 或 implicit polyfill；在 composition root 显式配置 host polyfill 和 global integration。

## State、Event 和 Cancellation

公开 reactive contract 是 SDK trait：

- `ReadableSignalTrait<T>` 提供同步 current state 和 observable interop。
- `ResourceTrait<T>` 提供 typed loading/value/error lifecycle。
- `EventStreamTrait<T>` 是 read-only event sequence；`EventSubjectTrait<T>` 只用于 producer side。
- `CancellationTokenTrait` 是具有 observable interop 的 cooperative cancellation。

consumer 接收 read-only signal 与 event stream。实现可直接使用 RxJS：这些 trait 已提供 observable interop，`@securitydept/client/rx` 提供 RxJS-backed implementation 与 command/resource utility。不要为了内部“纯度”再套一层只转发 subscription 的 wrapper，也不要把 RxJS `Observable` 作为 SDK public contract 暴露。

当 public trait API 需要 RxJS `NEVER` 或 `EMPTY` 语义时，使用 `createNeverEventStream()` 与 `createEmptyEventStream()`。

## Span 和 Tracing

`SpanTrait` 是独立 foundation capability，不属于 telemetry 或 event 的子能力。调用方在 top-level workflow boundary fork child span，再在它下方记录当前操作。它同时支持可自动传播 context 的 host 和使用显式 propagation 的 host。

trace 只描述当前动作。不要为了重建 span tree 已有的 nesting 再维护全局 source/outcome enum。freshness 是 refresh boundary fact，不是所有 auth event/trace 的默认字段。

## Auth Context Clients

### Basic Auth

`BasicAuthContextClient` 建模 zone-aware challenge boundary。它不管理或撤销 browser credential cache。client 暴露 boundary snapshot、operation 和 event；login navigation 仍是显式的 host/router action。其 `logout()` 只清除当前内存 boundary projection，不发起网络请求。

### Session

`SessionContextClient` 建模 server-owned cookie session。它读取 session user-info、暴露 resource state，并发起 login/logout navigation；不暴露 server 的 OIDC credential 或 session-storage implementation。

### Token Set

token-set client 只有一个 in-memory snapshot authority。其 lifecycle 有四个稳定角色：

1. workflow source 提供 startup、page resume、refresh timing 等输入。
2. closed planner 将 restore、freshness、refresh outcome 求值为 discriminated final candidate。
3. base client 串行化 top-level workflow，并提交恰好一个 determination。
4. mode client 实现 protocol-specific OIDC work；registry 组合 client 并路由 callback。

`start()` 是 canonical initial lifecycle entry。`restorePersistedState()` 仍保留为 explicit manual persistence re-sync command，例如 cross-tab 或 host-driven synchronization；它不是通用 readiness API。由 registry 构造的 client 应使用 registry readiness API。

auth event 是 direct discriminated public union，event `type` 决定 payload shape。consumer 不得再依赖已废弃的 `AuthCheck*`、`TokenSetAuthFlowReason`、`TokenSetAuthFlowOutcome` 或 payload-map contract。只有 refresh event 携带 freshness 和 refresh-material fact。任何 auth event 不得包含 raw access token、refresh material 或 authorization header。

## Framework Adapters

React 与 Angular package 将 canonical client ownership 适配到框架的 context/injection/lifecycle，不得创建竞争的 auth-state authority。router adapter 把 framework router 适配到 `RouterTrait`，不定义 product route 或 UI。

- React 中，在 Fiber 之外调用 `createEnvironmentForReact(...)`，通过 `SecuritydeptProvider` 安装其 injector，再以 `useSecuritydeptContext()` 读取 SDK dependency。`@securitydept/client-react/tanstack-router` 负责 TanStack Router adaptation。
- Angular 中，使用 `provideEnvironment(...)` 组合 Angular router、`HttpClient`、injector 和 destruction lifecycle。`@securitydept/client-angular` 负责相应的 router/transport adapter。
- token-set host 用 `provideTokenSetClientRegistry(...)` 注册 keyed client。React 通过 `useTokenSetClientRegistry()` 与 callback hook 读取；Angular 提供同一个 core registry，并可使用 callback component、route-root helper 与 guard factory。
- route helper 只表达 requirement，并将求值交给 registry/client lifecycle。application 仍拥有 route tree、redirect、UI 和 user-facing copy。

## Lifecycle 和 Error 规则

- 在 client 与 required host capability 完成 composition 后调用一次 `start()`。
- 消费 public read-only state/event surface；在 owning framework/container destroy 时调用 `dispose()`。
- 向可取消 operation 传递 cancellation token；cancellation 是 cooperative 的，必须在 async boundary 检查。
- public failure 使用 `ClientError`-compatible 的 safe code/source/recovery metadata 规范化。不得在 UI error 或 event 中暴露 secret-bearing transport、token、provider payload。

## 兼容性

任何 public change 都必须更新 package export、inventory、focused documentation、test 和 [TS SDK 迁移记录](110-TS_SDK_MIGRATIONS.md)，并遵守上述稳定性纪律。只要不会保留误导或不安全的模型，优先选择 additive migration path。不要仅为了掩盖 ownership correction 而添加 alias。

---

[English](../en/007-CLIENT_SDK_GUIDE.md) | [中文](007-CLIENT_SDK_GUIDE.md)
