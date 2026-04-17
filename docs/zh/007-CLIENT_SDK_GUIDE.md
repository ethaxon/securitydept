# Client SDK 开发指南

本文档是 **SecurityDept 客户端 SDK 的权威总纲**。  
它负责回答三类问题：

- 当前有哪些 TypeScript public surface，分别由谁拥有
- 这些 surface 现在是 `stable`、`provisional` 还是 `experimental`
- adopter 应从哪里进入、哪些东西不应被当作 SDK surface

它**不再**承担以下职责：

- auth context / mode 的完整概念设计：见 [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)
- 当前优先级、backlog、延期边界：见 [100-ROADMAP.md](100-ROADMAP.md)
- 0.x 迁移与破坏性变更记录：见 [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)

目标读者：

- 实现 SDK 模块的人类开发者
- 审阅或修改 SDK 代码/文档的 AI agents
- 需要理解 public package / subpath 边界的 adopter

## 目标

客户端 SDK 的目标不是复刻服务端 `auth-runtime`，也不是把所有能力塞进一个单体包。  
它的目标是提供：

- 清晰的 auth-context product surface
- 明确的 framework-neutral foundation
- 薄而可验证的 browser / server / framework adapters
- 能被 reference app 与真实 adopter 一起校准的公开契约

当前产品化优先级：

1. TypeScript SDK
2. Kotlin SDK（后续）
3. Swift SDK（后续）

当前明确结论：

- TypeScript 仍是唯一 active productization track
- Kotlin / Swift 目前仍是方向性承诺，而不是已形成 shared external contract 的同步产品面

## 顶层结论

- 客户端 SDK 与服务端 route orchestration 概念分离
- public 包按 auth context / capability 拆分
- root surface 默认保持 framework-neutral
- framework adapter 通过独立 npm 包暴露
- browser / server helper 通过同包 subpath（如 `./web`、`./server`）暴露
- TypeScript 包为 `ESM only`
- 默认无 import-time side effect
- 默认不内置全局 polyfill

## 术语与命名

不要把共享客户端基础层命名为 `core`。  
当前统一术语如下：

- `client`：用户可直接进入的 foundation 顶层包
- `foundation`：共享基础设施层的概念名，不是主要 public 包名
- `basic-auth-context-client`：Basic Auth zone-aware client family
- `session-context-client`：cookie-session client family
- `token-set-context-client`：token-set / OIDC mode family client family

公共协议命名继续采用 `Trait` 风格，避免与宿主或标准对象混淆，例如：

- `ReadableSignalTrait`
- `WritableSignalTrait`
- `EventStreamTrait`
- `LoggerTrait`
- `CancellationTokenTrait`

完整的 auth context / zone / mode 定义见 [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)。

## 打包风格

当前 TypeScript 包家族按能力和 auth context 拆分，真实结构如下：

- `@securitydept/client`
- `@securitydept/client/web`
- `@securitydept/client/persistence`
- `@securitydept/client/persistence/web`
- `@securitydept/basic-auth-context-client`
- `@securitydept/basic-auth-context-client/web`
- `@securitydept/basic-auth-context-client/server`
- `@securitydept/basic-auth-context-client-react`
- `@securitydept/basic-auth-context-client-angular`
- `@securitydept/session-context-client`
- `@securitydept/session-context-client/web`
- `@securitydept/session-context-client/server`
- `@securitydept/session-context-client-react`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client/backend-oidc-mode`
- `@securitydept/token-set-context-client/backend-oidc-mode/web`
- `@securitydept/token-set-context-client/frontend-oidc-mode`
- `@securitydept/token-set-context-client/orchestration`
- `@securitydept/token-set-context-client/access-token-substrate`
- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-react/react-query`
- `@securitydept/token-set-context-client-angular`
- `@securitydept/client-react`
- `@securitydept/client-react/tanstack-router`
- `@securitydept/client-angular`

规则保持不变：

- framework-neutral root surface 不强制依赖 React / Angular
- framework adapter 使用独立包
- framework peer 放在 `peerDependencies`
- Angular adapter 通过 `ng-packagr` 生成 APF / FESM2022 输出
- framework adapter 独立包是当前正式 product boundary，不应再把同包 subpath 当默认方向

## 推荐仓库布局

客户端 SDK 保持在独立 library workspace 中，而不是让 `apps/webui` 反向主导结构。

当前推荐结构：

```text
sdks/
  ts/
    packages/
      client/
      basic-auth-context-client/
      session-context-client/
      token-set-context-client/
      basic-auth-context-client-react/
      session-context-client-react/
      token-set-context-client-react/
      basic-auth-context-client-angular/
      session-context-client-angular/
      token-set-context-client-angular/
      client-react/
      client-angular/
      test-utils/
```

`apps/webui` 是第一优先级 React reference app，**不是** SDK build topology 的 source of truth。

<a id="typescript-sdk-coding-standards"></a>
## TypeScript SDK 编码规范

以下规则适用于 `sdks/ts/`。

### 枚举类字符串域

对有界字符串值域，优先：

```ts
export const Foo = {
  Bar: "bar",
  Baz: "baz",
} as const;
export type Foo = (typeof Foo)[keyof typeof Foo];
```

避免 TypeScript `enum`。

### 公共契约的命名常量

对公共错误码、trace 事件名、日志 scope 标签等稳定 vocabulary，优先提取命名常量。  
一次性 UI 文案或局部临时文本保持内联。

### API 形状：options object 优先

<a id="ts-sdk-api-shape"></a>

公开 SDK 函数对可选参数集默认使用 **options object**。  
只有在“语义无需命名也自明”且“确有明显人体工程学收益”时，才允许裸 positional 第二参数。

当一个既有 API 被扩宽时，应把整个第二参数转为 options object，即使这是 breaking change。  
`0.x` 不等于可以无纪律 silent break；surface widening 也要服从统一 API 方向。

## Foundation 设计

`@securitydept/client` family 是共享 foundation。它不拥有 auth-context-specific business state machine，只拥有跨 auth-context 复用的基础协议和 runtime primitives。

### 状态原语

方向：snapshot-first、只读视图优先、状态迁移由 client / service 拥有。  
公开形状继续围绕 `ReadableSignalTrait` / `WritableSignalTrait` / `ComputedSignalTrait`。

### 事件原语

方向：最小公共事件协议，而不是绑定某个具体 observable 库。  
公开形状继续围绕 `EventObserver` / `EventSubscriptionTrait` / `EventStreamTrait`。

当前要额外保持两条纪律：

- public 事件层仍刻意保持 thin；`switchMap` / `concatMap` / `exhaustMap` / `debounce` / `throttle` / `withLatestFromSignal` 这类 richer operator 还不是当前已产品化 baseline
- event envelope、timeline source 分类、命令/领域事件分层仍是有效设计方向，但只有已经进入 inventory / evidence 的部分才算当前 public contract

### Transport

foundation 只定义中立 transport 协议，不绑定具体 HTTP client 或 middleware 体系。  
SDK adapter 可以消费 fetch/axios/Angular HttpClient，但 foundation 不直接拥有它们。

### Persistence

`@securitydept/client/persistence` 与 `@securitydept/client/persistence/web` 负责存储协议与浏览器存储适配。  
规则：

- persistence protocol 属于 stable foundation
- browser storage glue 通过 `/web` 子路径进入
- token material / projection cache 的业务策略不应散落到 adopter app

当前 persistence authority 还正式覆盖一次性 callback / redirect 消费契约：

- `RecordStore.take(key)` 是 store 一致性域内正式的 atomic single-consume capability
- 仓库内提供的内存存储与浏览器存储适配器都直接实现了这项能力
- `createEphemeralFlowStore()` / `createKeyedEphemeralFlowStore()` 是 redirect / callback state 的 canonical helper，要求状态只能被消费一次

同时仍应按语义理解 persistence，而不是把它读成万能 KV：

- 长期状态
- 可恢复状态
- 临时流程状态

当前正式结论是：

- TTL / watch 不是 foundation persistence 的基础强制能力
- key 冲突优先通过 keyspace / ownership 解决，而不是通过 hook/middleware 托底
- persistence 与 signal state 仍应保持分层，不应合并成单一 store 抽象

### Auth Coordination

`@securitydept/client/auth-coordination` 承担跨 auth-context 的共享编排原语：

- requirement planner
- planner host
- matched-route-chain orchestration
- candidate selection / effective client-set composition

它是共享能力层，不再由 token-set family 垄断 owner。

### 配置系统

配置系统负责：

- source layering
- config normalization
- config projection
- freshness / precedence 语义

它不负责产品级 route policy 或 business decision。

当前还应明确：

- capability injection 仍优先于全局单例配置
- runtime / foundation config、auth-context config、adapter / host config 继续分层
- 当前没有一个统一的大而全 public config DSL；如果 future 讨论中的统一形状还未进入 inventory / evidence，就不应被写成现状

### 调度与统一输入源

foundation 继续拥有：

- `timer`
- `interval`
- `scheduleAt`
- `fromEventPattern`
- browser 输入源（如 visibility）对应的 thin bridge

它们是共享 scheduler/input primitives，不是单个 auth context 的私有实现。

当前 public baseline 仍刻意保持克制：

- `fromSignal`
- `fromPromise`
- `fromStorageEvent`
- `fromAbortSignal`

这些 richer helper 仍属于讨论中确认过的有效方向，但不是当前已产品化的 foundation 入口。

### 依赖注入

DI 只在 framework adapter 或内部 runtime glue 中作为能力存在。  
不要把 Angular / React 的 DI 语义反向污染 foundation root surface。

当前内部 wiring 纪律也应明确保留：

- 优先显式 capability wiring，而不是正式 DI 容器
- runtime 依赖与业务 config 继续分离
- composition root 保持集中
- 仍不接受反射 / decorator / metadata 驱动的解析器作为当前 foundation 路线

## Context Client 设计

三条 auth-context client family 的职责如下。

### `basic-auth-context-client`

定位：thin、zone-aware、browser/server convenience。  
它的目标不是成长为完整前端 runtime，而是帮助 adopter 正确处理：

- zone-aware `401 -> login`
- logout URL / logout helper
- server-host 下的 redirect instruction
- 带统一 `post_auth_redirect_uri` query 参数的 login URL

### `session-context-client`

定位：cookie-session auth context 的 client family。  
它拥有：

- 登录跳转 convenience
- session user-info probe
- React / Angular provider + hook integration
- server-host helper

它不是 mode family，没有 token-set 式多 mode 内部分裂。

### `token-set-context-client`

定位：token-set auth context 的 product family。  
它继续是当前最完整的 client family，但本文件只保留其 **public surface 结论**；完整 mode / ownership 设计见 [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)。

当前 family 由以下正式 surface 组成：

- `/backend-oidc-mode`
- `/backend-oidc-mode/web`
- `/frontend-oidc-mode`
- `/orchestration`
- `/access-token-substrate`
- `/registry`
- React / Angular adapter 独立包

核心原则：

- mode family 仍归属于 `token-set-context`
- 共享 route / framework glue 已迁回 `@securitydept/client*`
- browser-owned baseline 与 mixed-custody / BFF 边界继续严格区分

## SSR / 服务端宿主支持

SSR / server-host 支持在 TS SDK 语境中指的是：**客户端 SDK 面向服务端宿主代码的 helper / contract**，不是 Rust backend crate 自身的 route runtime。

### `basic-auth-context` / `session-context`

这两条线都已有 dedicated `./server` helper baseline。  
当前推荐做法是：

- `basic-auth-context-client/server`：处理 unauthorized redirect instruction 与 login/logout URL
- `session-context-client/server`：处理 cookie forwarding、user-info 探测、login/logout URL

### `token-set-context`

`token-set-context` 当前**不**把 server-side token ownership 纳入 `0.2.0` baseline。  
浏览器拥有 token material 仍是当前 baseline；mixed-custody、BFF、server-side token-set ownership 继续留到 [100-ROADMAP.md](100-ROADMAP.md) 的后续边界。

## 错误模型

错误模型继续遵循：

- transport / protocol / domain error 分层
- 错误 code 优于只靠字符串消息
- 公共 surface 暴露可解释错误，而不是泄漏宿主内部异常形状

但当前错误模型不应被读薄成“只有一个 Error 类”：

- machine-facing runtime error
- user-facing presentation / recovery hint

这两层仍是当前权威方向。  
稳定 `code` 与 `recovery` 比 message 文本更接近 public contract；reference host 应优先围绕这两者建模，而不是解析 `error.message`。

当前已产品化的 owner boundary 也已明确：

- `@securitydept/client` 拥有共享 dual-layer bridge：`ClientError` 继续作为 machine-facing runtime contract，而 `ErrorPresentationDescriptor`、`ErrorPresentationTone`、`readErrorPresentationDescriptor()` 则构成共享的 host-facing presentation / recovery contract
- `@securitydept/token-set-context-client/frontend-oidc-mode` 通过 `describeFrontendOidcModeCallbackError()` 拥有 family-specific callback presentation mapping，在共享 descriptor contract 之上把稳定 callback code 映射成 host-facing title / description，而不是把这层 wording 下放到每个 app
- `@securitydept/token-set-context-client-react` 现在在 `CallbackResumeErrorDetails.presentation` 中直接暴露这条稳定 presentation descriptor，使 browser-owned callback host 不再需要从 `error.message` 反推宿主展示语义
- reference app 也已在真实 host path 上证明这条分层：frontend callback、frontend popup failure、backend-mode refresh / clear failure 都直接基于共享 descriptor contract 渲染；只有 host-owned link / label 仍由 app 负责

## Cancellation 与资源释放

公开 contract 继续要求：

- long-running browser flow 可取消或重置
- service / controller / provider 在 teardown 时可释放资源
- adopter 不应自己兜底 SDK 内部 watcher / timer / subscription 清理

当前仍未产品化完成、但不应被遗忘的边界包括：

- `CancellationTokenTrait` / `CancellationTokenSourceTrait` 与 `AbortSignal` 的 bridge 语义
- `DisposableTrait` 与 `Symbol.dispose` 的关系
- linked cancellation source 是否进入 future baseline

## Logging、Trace 与测试

规则保持：

- foundation 提供 logger / trace integration points
- reference app 可做 probe / timeline / diagnostics，但这些不自动成为 SDK public surface
- 真实 authority 由 inventory + evidence + release-gate 共同维护

当前还应明确三条工程纪律：

- logger、trace sink、operation tracer 仍应视为不同层次，而不是单一日志接口
- structured trace / state snapshot / redirect instruction 仍优先于文本日志，作为行为验证观察面
- `FakeClock`、`FakeScheduler`、`FakeTransport`、`InMemoryTraceCollector` 这类测试工具思路是当前有效方法论，但只有进入 public surface 的部分才算正式 SDK contract

## 构建、兼容性与 side effects

### 产物与兼容性

当前 TS family 以 ESM 为准。  
adapter 包与 core 包共享这一方向，不再为了历史兼容保留双轨 build story。

### Polyfill

SDK 默认不内置全局 polyfill。  
若 adopter 需要宿主能力补齐，应由 adopter 显式决定。

### sideEffects / tree-shaking

公开包默认应可 tree-shake。  
任何 import-time side effect 都必须被视为严重 contract 污染。

`sideEffects: false` 继续应被视为目标能力，而不是构建产物偶然满足的结果。

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
| `@securitydept/basic-auth-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/session-context-client` | `stable` | `session-context` | `stable-deprecation-first` |
| `@securitydept/session-context-client/web` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/session-context-client/server` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/backend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/backend-oidc-mode/web` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/orchestration` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/access-token-substrate` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/registry` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/test-utils` | `experimental` | `foundation` | `experimental-fast-break` |
| `@securitydept/basic-auth-context-client-angular` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-angular` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react/react-query` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-angular` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/client-react` | `provisional` | `shared-framework` | `provisional-migration-required` |
| `@securitydept/client-react/tanstack-router` | `provisional` | `shared-framework` | `provisional-migration-required` |
| `@securitydept/client-angular` | `provisional` | `shared-framework` | `provisional-migration-required` |

#### token-set-context-client Subpath Family 阅读方式

当前应这样阅读 token-set family：

- `/backend-oidc-mode`：平台中立 client / service / token material entry
- `/backend-oidc-mode/web`：browser glue
- `/frontend-oidc-mode`：frontend-owned OIDC mode
- `/orchestration`：token material lifecycle / propagation 相关 shared layer
- `/access-token-substrate`：access-token propagation 词汇表与基底契约
- `/registry`：multi-client shared lifecycle core

#### Capability Boundary Rules

- framework route glue 属于 `@securitydept/client-react` / `@securitydept/client-angular`
- browser token lifecycle glue 属于 token-set family
- app-local business helper 不属于 SDK public surface
- reference app 是 authority evidence，不是默认 owner

#### token-set-context-client 前端 subpath / abstraction split

前端 adopter 现在应优先从以下三层理解：

1. foundation / shared coordination
2. token-set mode / substrate / registry
3. framework adapter 与 reference-app consumption

不要再把 token-set family 当成“所有前端 glue 的唯一 owner”。

#### Config Projection Source Contract（`frontend-oidc-mode/config-source.ts`）

`frontend-oidc-mode` 仍是 projection-source authority。  
source precedence、freshness、restore / revalidate 语义属于该层；具体宿主如何拿到配置（network / bootstrap script / persisted）则由 mode surface 与 adopter glue 共同完成。

#### reference app 宿主证据（`apps/webui` / `apps/server`）

reference app 现在不再只有一条笼统的 “Token Set” 路径，而是明确证明两种 token-set host mode：

- backend mode：server-owned callback / redirect completion，经由 `/auth/token-set/backend-mode/*`，reference page 位于 `/playground/token-set/backend-mode`
- frontend mode：browser-owned callback，经由 `/auth/token-set/frontend-mode/callback`，config projection 由 `/api/auth/token-set/frontend-mode/config` 提供，宿主页位于 `/playground/token-set/frontend-mode`

这也改变了 React authority 的阅读方式：

- `TokenSetCallbackComponent` 现在只通过 frontend-mode callback route 获得真实宿主验证，而不再借 backend-owned 路线“代证”
- dashboard bearer access 通过同一套 keyed React Query / registry surface 同时覆盖 backend/frontend 两种 token-set mode
- TanStack route security 仍通过 `createSecureBeforeLoad()` + `withTanStackRouteRequirements()` 覆盖两种 token-set mode；reference app 没有证明需要额外的 React-only secure-guard convenience layer

这也改变了 frontend-mode callback correctness 的阅读方式：

- pending redirect state 现在按 OAuth `state` keyed 存储，而不是继续共用一个全局 pending slot
- callback consumption 建立在 foundation `RecordStore.take()` capability 与 keyed ephemeral flow store 之上
- duplicate replay、missing state、stale pending state 与 client mismatch 都属于公开 correctness contract，而不是最佳努力的 app-local glue
- React callback host 应基于结构化 callback failure details（`code`、`recovery`、`kind`、`source`）渲染，而不是解析不稳定的 `Error.message` 文本
- reference app callback route 现在把 `callback.unknown_state`、`callback.pending_stale`、`callback.pending_client_mismatch` 与 `callback.duplicate_state` productize 为稳定、浏览器可见的宿主状态，并由 browser e2e 直接断言这些宿主结果

frontend-mode 的 browser authority 现在还包含同一宿主内的 popup 与 lifecycle 证明：

- popup login 不再只是 SDK helper baseline；reference app 现在拥有真实 popup relay route `/auth/token-set/frontend-mode/popup-callback`，并从 `/playground/token-set/frontend-mode` 触发 popup login，通过 browser e2e 证明成功路径以及宿主可见的 `popup.closed_by_user` failure
- `FrontendOidcModeClient.popupLogin()` 现在会把 `popupCallbackUrl` 作为真实 OAuth `redirect_uri` 使用，并允许可选的 `postAuthRedirectUri`，因此 host-owned popup relay page 不再依赖 redirect-uri 冒充或 app-local workaround
- cross-tab lifecycle authority 也已进入 reference-app 层：一个标签页完成或清除 frontend-mode state 后，另一个标签页会通过浏览器 storage event reconcile 这份 persisted snapshot，browser e2e 直接断言 hydrate 与 clear 两种行为
- 结构化观察面现在也有了最小 SDK-owned product surface：`TraceEvent` 继续作为底层 contract，`@securitydept/client` 中的 `createTraceTimelineStore()` 提供 canonical in-memory observation feed，`FrontendOidcModeTraceEventType` 命名前端模式浏览器 flow 的 trace taxonomy，而 `apps/webui` 直接消费这条共享 trace feed，而不是再拼 app-local string timeline
- testing evidence 也开始从同一条结构化表面出发：focused SDK tests 直接断言 popup 与 callback trace event，browser e2e 则通过由 structured trace timeline 派生的 `data-trace-type` 标记断言 frontend-mode popup / cross-tab 行为，而不再只依赖页面文案

### Framework Router Adapters

framework router adapter 已收口到共享 framework owner：

- `@securitydept/client-react/tanstack-router`
- `@securitydept/client-angular`

当前 canonical contract：

- matched-route-chain
- `inherit / merge / replace`
- root-level runtime policy 与 child-route declarative metadata 分层
- Angular 与 TanStack Router 对齐

token-set family 不再拥有共享 router adapter owner。

### token-set-context-client v1 Scope Baseline

当前 `0.2.0` baseline 继续是：

- browser-owned token-set
- framework adapter + reference app + downstream adopter 校准
- multi-client lifecycle / route orchestration / readiness / callback 基线

当前**不**在 baseline 内的内容：

- mixed-custody
- BFF / server-side token ownership
- 更重的 chooser UI product layer
- TS 之外语言的同步产品化

### Adopter 使用清单

#### 不应被当作 SDK Surface 的内容

以下内容默认不是 SDK public surface：

- `apps/webui/src/api/*` 中的 app-local business helper
- reference page UI / diagnostics glue
- adopter 自己的 route table、page state、toast 文案
- 为单个 app 服务的 data-shaping helper

#### 开始接入前的确认清单

在进入任何 surface 前，先确认：

1. 你需要的是哪个 auth context，而不是哪个 demo 页面
2. 你是在 browser、framework host 还是 server-host 中接入
3. 你需要的是 stable root contract，还是 provisional adapter
4. 你是否已经接受当前 `0.2.0` / `0.3.0` 边界

### Verified Environments / Host Assumptions

当前文档中的“已验证”只表示：仓库中存在 focused evidence / reference app / downstream adopter 证据。  
它不等于“所有主流宿主环境都已广泛验证”。

当前最主要的已验证宿主：

- Node / browser baseline
- React 19 host
- Angular host
- TanStack Router host
- 原生 Web Router baseline
- `apps/webui` 与 `outposts` 两条真实 adopter 线

运行时支持边界应继续按三层表达，而不是粗暴写“支持 / 不支持某 runtime”：

- ECMAScript / built-in requirement
- adapter capability requirement
- verified environments

当前文档不会维护 caniuse 式的大而全 runtime 支持表；若某宿主未进入真实 evidence，就不应被写成“已验证”。

### 最小进入路径

#### 1. Foundation 入口：runtime 仍由宿主显式拥有

当你需要 shared primitive 时，从 `@securitydept/client` family 进入。  
这是 capability entry，不是产品级 auth shell。

#### 2. Browser 入口：`./backend-oidc-mode/web` 负责 browser glue

当你在浏览器里接入 backend-owned OIDC/token-set flow 时，从：

- `@securitydept/token-set-context-client/backend-oidc-mode/web`

进入 browser glue。  
redirect path、callback resume、storage/bootstrap 等 browser-specific concern 由它拥有。

#### 3. React 入口：`@securitydept/session-context-client-react` 从 Provider, hook 开始

React adopter 应优先从独立 React adapter 包进入，而不是回到 core root surface 手搓 provider glue。  
同理：

- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

都应被读成各自 auth-context family 的 React canonical entry。

#### 4. SSR / server-host 入口：dedicated `./server` helpers

server-host adopter 应优先从 dedicated `./server` helper 进入：

- `@securitydept/basic-auth-context-client/server`
- `@securitydept/session-context-client/server`

不要从 `/web` 子路径进入服务端代码。

### Provisional Adapter 维护标准

`./web`、`./server` 以及 framework adapter 包都继续按比 stable root surface 更严格的 `provisional` 标尺维护。

判断标准：

- boundary 职责稳定
- import-time 行为稳定
- ordinary usage 不依赖 reference-app glue
- 有 focused evidence 与真实 dogfooding
- verified environments 说明与真实验证一致

#### Provisional Adapter 晋升前 Checklist

只有当以下条件同时满足，才考虑从 `provisional` 进入 `stable`：

| 条件 | 要求 |
|---|---|
| capability boundary 稳定 | 连续多轮迭代未再发生 owner 重排 |
| minimal entry 清晰 | 可以独立说明，不依赖完整 reference page |
| ordinary usage 成熟 | 不依赖 app-local glue 才能成立 |
| focused evidence 完整 | lifecycle / regression / import contract 有护栏 |
| verified environments 足够清晰 | 不夸大宿主验证范围 |

#### 当前晋升就绪度（快照，非路线图）

| Adapter / Surface | 当前判断 |
|---|---|
| `@securitydept/client/web` | stable foundation-owned browser helper surface |
| `@securitydept/client/auth-coordination` | provisional，但 matched-route-chain / planner-host contract 已成形 |
| `@securitydept/client/web-router` | provisional，raw Web baseline 已建立 |
| `basic-auth-context-client/web` | provisional，thin browser convenience 已成形 |
| `session-context-client/web` | provisional，login redirect convenience 已成形 |
| `basic-auth-context-client/server` / `session-context-client/server` | provisional，SSR/server-host baseline 已建立 |
| `*-react` / `*-angular` adapter family | provisional，已有真实 reference app / downstream adopter 证据，但 host matrix 尚未广泛铺开 |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | provisional，keyed pending-state owner 与 single-consume callback semantics 已正式建立在 foundation persistence contract 之上 |
| `token-set-context-client-react/react-query` | provisional，canonical token-set groups / entries consumer path 的 SDK-owned 读写 authority 已成立 |

## Raw Web Router Baseline（原生 Web 路由基线）

**Subpath**：`@securitydept/client/web-router`

它是非框架宿主的标准答案：

- Navigation API 优先，History API 回退
- 单次提交完整 matched-route chain 给 planner host
- 不在 router 层重新实现 auth logic

它与 Angular / TanStack Router 的共享语义是：

- full-route aggregation
- `inherit / merge / replace`
- unauthenticated policy 由 candidate 自己表达

## Shared Client Lifecycle Contract（共享客户端生命周期契约）

**Subpath**：`@securitydept/token-set-context-client/registry`

它是 token-set family 的 shared multi-client lifecycle core。  
当前统一拥有：

- `primary` / `lazy` initialization priority
- `preload`
- `whenReady`
- `idleWarmup`
- `reset`
- keyed lookup 与 callback/readiness 对齐

React 与 Angular adapter 都应消费这套 shared core，而不是各自重写一份 registry 语义。

## React Query Integration（React Query 集成）

**Subpath**：`@securitydept/token-set-context-client-react/react-query`

它当前的定位必须明确：

- 它是 token-set React consumer surface
- 它不是登录/刷新/runtime authority
- query state 从 registry / auth service 派生，而不是反过来

当前已经成立的 authority：

- groups / entries 读路径
- groups / entries 写路径
- readiness query
- keyed-only canonical hook ergonomics（adopter-facing selector 是 `clientKey`，hook 内部自行解析 client）
- authorization header derivation
- `useTokenSetBackendOidcClient(clientKey)` 作为 React consumer 的 SDK-owned lower-level backend-oidc accessor
- query key namespace
- canonical groups / entries flow 的 post-mutation invalidation
- React consumer hooks 所使用的 token-set management entity / request / response contract

当前 reference-app authority 已证明：

- `apps/webui` dashboard 已直接消费 SDK-owned token-set query + mutation hooks
- `apps/webui` token-set reference page 的 group / entry 创建流程也已切到同一套 SDK-owned mutation path
- `apps/webui` 的 login / dashboard / token-set page 主路径已经不再依赖 app-local `getTokenSetClient()` 或 `service.client as ...` 作为 canonical React consumer path
- app-local canonical wrapper 已不再是 token-set React Query 写语义的 owner 边界

## 示例与参考实现

### 真实参考实现

当前第一优先级 reference app / host：

- `apps/server`
- `apps/webui`

它们的职责是：

- `apps/server`：提供真实 auth / propagation / route composition 语义
- `apps/webui`：提供 React / browser / multi-context auth shell / token-set reference page / dashboard dogfooding authority

### 下游参考案例：Outposts

`~/workspace/outposts` 是高价值下游 adopter，用于验证：

- Angular host
- backend-driven config projection
- route-level orchestration
- 多资格真实接入

但 `outposts` 当前 app-local 历史 glue 不是 SDK API 模板。  
SDK 设计仍应由 `securitydept` 自己的领域语义与 ergonomics 主导。

### 当前 Bundle / Code Split 判断

当前 bundle/code split 已降级为工程优化议题，不再是 public contract blocker。  
优先级继续让位于 contract freeze、authority 对齐与 adopter clarity。

### Demo 与 OIDC Provider

交互式 demo 可以存在，但：

- demo/provider 不是 authority
- OIDC provider 选择不应反向影响 package boundary
- demo 只能帮助解释 contract，不能替代 focused evidence

## 对后续开发者与 AI Agents 的要求

- 不要把客户端 SDK 命名或实现成 `auth-runtime`
- 不要让 framework adapter 反向污染 foundation
- 不要默认引入 import-time side effect 或全局 polyfill
- 不要把 reference app glue 直接 productize 成 SDK API
- 不要把 mixed-custody / BFF 主题偷偷塞回 `0.2.0` baseline
- 修改 public surface、docs、examples、inventory 时必须一起移动

[English](../en/007-CLIENT_SDK_GUIDE.md) | [中文](007-CLIENT_SDK_GUIDE.md)
