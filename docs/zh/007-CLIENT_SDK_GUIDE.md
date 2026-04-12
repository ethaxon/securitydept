# Client SDK 开发指南

本文档定义 SecurityDept 客户端 SDK 的正式设计方向，优先覆盖 TypeScript，并为未来的 Kotlin 与 Swift 版本提供统一约束。

目标读者：

- 实现 SDK 模块的人类开发者
- 对这些 SDK 进行代码或文档修改的 AI agents

## 目标

客户端 SDK 应服务于 SecurityDept 的认证上下文能力，而不是复用服务端 `auth-runtime` 的概念，也不是把所有行为塞进单体包。

当前优先级：

1. TypeScript SDK
2. Kotlin SDK
3. Swift SDK

## 顶层结论

- 客户端 SDK 与服务端路由编排概念分离
- public 包按 auth-context / capability 拆分
- 默认导出保持框架无关
- 框架适配通过独立 package 暴露
- TypeScript 包采用 `ESM only`
- 默认不内置全局 polyfill
- 默认无副作用，任何副作用都需要用户显式挂载或初始化

## 术语与命名

不要把客户端共享基础层命名为 `core`。

原因：

- `securitydept-core` 在 Rust 侧已经表示 re-export 聚合 crate
- 如果客户端再使用 `client-core` 表示共享基础层，会在同一 workspace 中产生冲突语义

当前术语：

- `client`：面向使用者的顶层聚合入口
- `foundation`：客户端共享基础设施层，通常更适合作为内部层，而不是主要 public 包名
- `basic-auth-context-client`：Basic Auth zone-aware 客户端辅助包
- `session-context-client`：session 模式客户端包
- `token-set-context-client`：token-set 模式客户端包

基础协议命名当前统一采用 `Trait` 风格，以避免与未来可能的全局名称或标准对象混淆。

示例：

- `ReadableSignalTrait`
- `WritableSignalTrait`
- `ComputedSignalTrait`
- `EventStreamTrait`
- `EventSubscriptionTrait`
- `LoggerTrait`
- `CancellationTokenTrait`
- `CancellationTokenSourceTrait`

## 打包风格

SecurityDept 客户端 SDK 采用按能力 / auth-context 拆分的打包策略：

- public 包按能力或 auth-context 拆分
- 默认导出面保持框架无关
- 框架适配（React、Angular）通过**独立 npm 包**交付，而不是同包 subpath
- 框架无关的 browser / server helper 通过同包 subpath（`./web`、`./server`）暴露

TypeScript 包家族（当前真实结构）：

- `@securitydept/client`
- `@securitydept/client/web`
- `@securitydept/client/persistence`
- `@securitydept/client/persistence/web`
- `@securitydept/basic-auth-context-client`
- `@securitydept/basic-auth-context-client/web`
- `@securitydept/basic-auth-context-client/server`
- `@securitydept/basic-auth-context-client-react`（独立 React adapter 包）
- `@securitydept/basic-auth-context-client-angular`（独立 Angular adapter 包）
- `@securitydept/session-context-client`
- `@securitydept/session-context-client/web`
- `@securitydept/session-context-client/server`
- `@securitydept/session-context-client-react`（独立 React adapter 包）
- `@securitydept/session-context-client-angular`（独立 Angular adapter 包）
- `@securitydept/token-set-context-client/frontend-oidc-mode`
- `@securitydept/token-set-context-client/backend-oidc-mode`
- `@securitydept/token-set-context-client/backend-oidc-mode/web`
- `@securitydept/token-set-context-client/orchestration`
- `@securitydept/token-set-context-client/access-token-substrate`
- `@securitydept/token-set-context-client-react`（独立 React adapter 包）
- `@securitydept/token-set-context-client-angular`（独立 Angular adapter 包）

对于框架 adapter 独立包：

- 把框架依赖（`react`、`@angular/core` 等）放在 `peerDependencies`
- 核心包（`basic-auth-context-client`、`session-context-client` 等）本身不强制依赖任何框架
- Angular adapter 包使用 `ng-packagr` 生成 APF / FESM2022 输出，支持完整 `@Injectable()` decorator

## 推荐仓库布局

客户端 SDK 应放在独立于 `webui` 的 library workspace 中。

当前推荐结构：

```text
sdks/
  ts/
    tsconfig.json
    packages/
      client/
      basic-auth-context-client/
      session-context-client/
      token-set-context-client/
      test-utils/
  kotlin/
    ...
  swift/
    ...
```

当前 TypeScript 构建方向：

- `pnpm workspace`
- `tsconfig references`
- `tsc -b`
- `tsdown`

`apps/webui` 应继续使用 Vite，但不应作为 SDK 包的主构建链路。

<a id="typescript-sdk-coding-standards"></a>
## TypeScript SDK 编码规范

以下规则适用于 `sdks/ts/` 下的所有 TypeScript 包。`AGENTS.md` 中有精简摘要；本节提供完整 rationale，供参考和 review 使用。

### 枚举类字符串域

对有界字符串值域的常量，优先使用：

```ts
export const Foo = {
  Bar: "bar",
  Baz: "baz",
} as const;
export type Foo = (typeof Foo)[keyof typeof Foo];
```

这样运行时输出简单（普通对象，无 class），与 JS 消费者和字符串协议（JSON、discriminant）保持最大兼容性，同时保留 TypeScript 完整补全和穷举检查能力。

避免使用 TypeScript `enum`——它会生成运行时 IIFE，与 `isolatedModules` 兼容性差，且会干扰 `as const` 窄化。

### 公共契约的命名常量

对于公共契约、高频 discriminant、具有稳定含义的重复 telemetry 词汇，应提取命名常量，而不是散落原始字符串。例如：错误 `code` 字符串、trace 事件名、日志 scope 标签。

在能提升一致性和可发现性时使用。**不要**机械套用——一次性 UI 文案或局部临时文本保持内联。

### API 形状：options object 优先

<a id="ts-sdk-api-shape"></a>

公开 SDK 函数对任何可选参数集默认使用 **`options` object**。

裸 positional 第二参数仅在同时满足以下**两个**条件时才可接受：

1. 参数语义无需命名即可自明（如简单的字符串 key 或必选主值）。
2. 它是唯一的高频参数，在调用点能带来明确的人体工程学收益。

来自更宽 options bucket 的单个可选字段，**不能**仅因为历史上曾是唯一参数就保留为 positional overload。

**当现有 API 扩宽**，新 options 无法以 positional 方式表达时，应将整个第二参数转为 options object——即使是 breaking change。这是 SDK surface 的有意方向。

**Rationale——在第 76 轮确立：**  
`resetBackendOidcModeBrowserState` 原签名为 `(client, callbackFragmentStore?)`。加入 `callbackFragmentKey` 和 `sessionStore` 时，第二参数整体转为 `(client, options?)`。`callbackFragmentStore` 是 `EphemeralFlowStore<string>`——属于 options bucket 中的一个字段，不满足 positional 例外条件。由此产生的 breaking change 被接受为有意的 API 风格统一。

## Foundation 设计

`foundation` 是设计层和共享基础层，优先作为内部层存在。它不应承载 auth-context 专属状态机。

它应负责：

- 状态原语
- 事件原语
- transport 抽象
- 持久化抽象
- 配置层次
- 调度与时钟抽象
- 错误模型
- cancellation / disposal
- logging / trace
- schema 接入点

### 状态原语

状态层语义应优先靠近 TC39 `signals`，但 public API 使用 SDK 自己的薄协议层。

当前最小方向：

```ts
interface ReadableSignalTrait<T> {
  get(): T
  subscribe(listener: () => void): () => void
}

interface WritableSignalTrait<T> extends ReadableSignalTrait<T> {
  set(value: T): void
}

interface ComputedSignalTrait<T> extends ReadableSignalTrait<T> {}
```

原则：

- snapshot-first
- 不可变快照
- 默认只读视图
- 状态迁移由 client / service 受控执行

### 事件原语

事件层语义优先靠近 `observable`，但不直接暴露某个具体库类型。

当前最小方向：

```ts
interface EventSubscriptionTrait {
  unsubscribe(): void
}

interface EventObserver<T> {
  next?(value: T): void
  error?(error: unknown): void
  complete?(): void
}

interface EventStreamTrait<T> {
  subscribe(observer: EventObserver<T>): EventSubscriptionTrait
}
```

应保留：

- 最小公共事件协议
- 最小 operator 集
- 结构化事件 envelope

### Transport

不要把 API 拦截器设计成某个特定 HTTP client 的 middleware 机制。  
foundation 只定义中立 transport 协议。

当前方向：

```ts
interface HttpRequest {
  url: string
  method: string
  headers: Record<stringstring>
  body?: unknown
}

interface HttpResponse {
  status: number
  headers: Record<stringstring>
  body?: unknown
}

interface HttpTransport {
  execute(request: HttpRequest): Promise<HttpResponse>
}
```

`401`、redirect、reauthentication 等处理属于 auth runtime policy，而不是 transport 本身。

### 持久化

持久化不应只是万能 KV。应区分：

- 长期状态
- 可恢复状态
- 临时流程状态

当前方向：

```ts
interface RecordStore {
  get(key: string): Promise<string | null>
  set(key: stringvalue: string): Promise<void>
  remove(key: string): Promise<void>
}

interface Codec<T> {
  encode(value: T): string
  decode(raw: string): T
}

interface PersistentAuthStore<T> {
  load(): Promise<T | null>
  save(value: T): Promise<void>
  clear(): Promise<void>
}

interface RecoverableStateStore<T> {
  load(): Promise<T | null>
  save(value: T): Promise<void>
  clear(): Promise<void>
}

interface EphemeralFlowStore<T> {
  load(): Promise<T | null>
  save(value: T): Promise<void>
  consume(): Promise<T | null>
  clear(): Promise<void>
}
```

配套导出建议：

- `@securitydept/client/persistence`
- `@securitydept/client/persistence/web`

### Auth Coordination

`@securitydept/client/auth-coordination` 是共享的、与协议无关的需求编排原语的 canonical owner。

提供的能力：

- `RequirementPlanner` — 无头多需求顺序调度器（session、OIDC、custom 等）。需求由 `id` + `kind` 标识，其中 `kind` 是 opaque `string`。各 auth-context 或 adopter 可自行定义 kind 命名常量。
- `RouteRequirementOrchestrator` — 路由级别的胶水层，将匹配的路由链（`RouteMatchNode[]`）映射到 `RequirementPlanner` 实例，并在路由切换时保留共享前缀的解析结果。
- `PlannerHost` / `createPlannerHost()` — 多需求 auth guard 的宿主层协调合约。评估一组 `AuthGuardClientOption` 候选项，并选出下一个待处理的候选项。支持可插拔的候选选择策略（默认：顺序选第一个未认证的；自定义：如弹窗选择器 UI）。
- `RequirementsClientSet` / `ScopedRequirementsClientSet` — 可组合的需求集合，支持 `inherit` / `merge` / `replace` 组合语义，用于父子作用域层级。
- `resolveEffectiveClientSet()` — 解析父子组合后的有效集合。
- 共享类型：`AuthRequirement`、`AuthGuardClientOption`、`CandidateSelector`、`RouteMatchNode`、`PlanSnapshot`、`PlanStatus`、`ResolutionStatus`、`RequirementPlannerError`、`ChooserDecision`、`RouteOrchestrationSnapshot`、`PlannerHostResult`。

**框架特定的 planner host 集成：**

- **Angular** (`@securitydept/client-angular`)：`AUTH_PLANNER_HOST` 注入令牌、`provideAuthPlannerHost()`、`injectPlannerHost()`、路由元数据助手（`withRouteRequirements()`、`extractFullRouteRequirements()`、`ROUTE_REQUIREMENTS_DATA_KEY`、`ROUTE_REQUIREMENTS_COMPOSITION_DATA_KEY`、`resolveEffectiveRequirements()`）、signal/Observable 桥接工具（`bridgeToAngularSignal()`、`signalToObservable()`）。`AUTH_REQUIREMENTS_CLIENT_SET` 与 `provideRouteScopedRequirements()` 仅保留为非 Router 场景的低层 DI-scope 助手。
- **React** (`@securitydept/client-react`)：`AuthPlannerHostProvider`、`useAuthPlannerHost()`、`AuthRequirementsClientSetProvider`、`useEffectiveClientSet()`。

**为什么归属 `@securitydept/client` 而非 `token-set-context-client`：**

planner 和 orchestrator 与协议无关。其 requirement kind 词汇（session、OIDC、custom）明显跨越 token-set 边界。把它们放在 `token-set-context-client` 意味着 basic-auth、session 等非 token-set adopter 需要被迫依赖 token-set 包。`@securitydept/client` 是所有 auth-context family 的共享基础层，是正确的所有权边界。

canonical 导入：

```ts
import {
  createRequirementPlanner,
  createRouteRequirementOrchestrator,
  createPlannerHost,
  resolveEffectiveClientSet,
  RequirementsClientSetComposition,
  PlanStatus,
  ResolutionStatus,
} from "@securitydept/client/auth-coordination";
```

稳定性：`provisional`（`provisional-migration-required`）。从 `@securitydept/token-set-context-client/orchestration` 迁移于第 102 轮迭代。planner-host 层在第 104 轮迭代中新增。详见 [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)。

### 配置系统

配置系统应采用分层结构，而不是平铺大对象。

推荐分层：

- runtime / foundation config
- auth-context config
- adapter / framework config

示例（当前真实 API）：

```ts
// Direct client construction (full control)
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";

const client = new BackendOidcModeClient(
  {
    baseUrl: "https://auth.example.com",
    loginPath: "/auth/oidc/login",    // SDK default; adopters may override
    refreshPath: "/auth/oidc/refresh",
    refreshWindowMs: 60_000,
  },
  runtime,
);

// Browser convenience entry (see /backend-oidc-mode/web)
import { createBackendOidcModeBrowserClient } from "@securitydept/token-set-context-client/backend-oidc-mode/web";

const browserClient = createBackendOidcModeBrowserClient({
  baseUrl: "https://auth.example.com",
  loginPath: "/auth/token-set/login", // adopter-specific override
});
```

配置校验：

- 优先支持 `@standard-schema`
- 不绑定某个单一校验库

### 调度与统一输入源

问题不应只理解为“定时器方案”，而应理解为统一事件输入源与调度源。

foundation 核心倾向提供：

- `fromEventPattern`
- `fromSignal`
- `timer`
- `interval`
- `scheduleAt`
- `fromPromise`

adapter 层再提供：

- `fromEventTarget`
- `fromStorageEvent`
- `fromVisibilityChange`
- `fromAbortSignal`

不要依赖单一超长 `setTimeout`。  
应使用：

- 绝对 deadline
- 分段调度
- 生命周期唤醒重算

### 依赖注入

当前不建议先实现正式 DI 容器，也不建议引入 `injection-js`。

更稳的方向是：

- 显式 capability wiring
- `runtime` bundle
- 少数 composition root
- 内部通过 `Deps` 对象组装 service

如果未来复杂度确实上来，再考虑无反射、typed token 的轻量 resolver。

## Context Client 设计

### `basic-auth-context-client`

该模块应刻意保持很薄。它不是为了替代浏览器原生 Basic Auth，而是让 zone-aware 路由和重定向行为可预测。

最小职责：

- 定义当前 Basic Auth zone 边界
- 判断当前路由是否位于 zone 内
- zone 内受保护 API 返回 `401` 时，将用户重定向到 zone login URL
- 重定向时带上当前路由作为 `post_auth_redirect_uri` 或等价参数
- 暴露 logout helper，把用户重定向到配置好的 zone logout URL

### `session-context-client`

该模块预计较薄，主要覆盖：

- login 触发辅助
- logout 辅助
- `me` 端点访问
- session 存在性探测
- 可选登录后重定向辅助

### `token-set-context-client`

这里需要明确避免继续把它理解成一个单体模块。

更合适的后续规划，是把当前 `token-set-context-client` 背后的能力拆成两层：

1. **通用 token orchestration / token material 层**
   - `access_token` / `id_token` / `refresh_token` 的组合快照
   - restore / clear / refresh 调度
   - 持久化、trace 与 transport projection
   - 这一层不应感知 token 来源是：
     - 标准前端 OIDC
     - 标准后端 OIDC resource server
     - `token-set-context` 的 sealed metadata 组合流程

2. **OIDC-mediated 特定 browser adapter**
   - callback returns 解析
   - sealed metadata 特定 redirect 流程
   - metadata fallback
   - flow-state / 统一的 OIDC metadata fallback 存储

按这个方向理解，当前最重的客户端模块应覆盖的内容可以拆开阅读：

- **通用 token orchestration 层**
  - token snapshot / delta 合并规则
  - 持久化适配器
  - refresh 调度
  - bearer header 注入辅助
  - refresh 失败恢复策略
- **backend-oidc-mediated browser adapter 层**
  - callback returns 解析
  - 三级 metadata resolution (inline, redemption, fallback) 流程
  - sealed metadata 相关恢复策略

而不应默认继续承担：

- 多 provider 或多 source 管理
- route-level orchestration
- chooser UI / app policy

这里要额外澄清：上面这组“通用 orchestration 层OIDC-mediated 特定 adapter 层”的拆分，只是当前已落地的**共享基础设施 / 特定流程**内部模块边界。对外需要同时读成：

- TS 前端运行时产品面：`token-set-context-client`
- Rust crate public surface：`securitydept-token-set-context`

其中 Rust 侧不应再被读成“只有 `backend` 模块的后端 crate”；更合适的 adopter-facing 结构应直接收口为顶层 `*_mode` 与 shared modules（详见 [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md)）。

#### OIDC Mode Family（替代旧"三驾马车"术语）

当前主术语已切换为统一的 auth context / mode 分层。完整设计见 [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md)。

##### 产品面

| 产品面 / 权威面 | SDK / Crate | 角色 |
|---|---|---|
| **TS 前端运行时面** | `token-set-context-client`（TS） | 统一前端 subpath / runtime 入口；canonical target 是 `/frontend-oidc-mode`、`/backend-oidc-mode`、`/access-token-substrate` |
| **Rust 顶层 mode / shared module public surface** | `securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_mode, access_token_substrate, orchestration, models}` | 统一的 mode module / shared module adopter-facing 结构 |
| **Rust ownership boundary（实现层说明）** | mode-specific contract ownership、shared substrate ownership | 解释内部“谁负责什么”，但不再主导一级 public path |

##### 模式总览

| 模式 | 谁运行 OIDC 流程 | TS SDK 子路径 | Rust 侧权威入口 |
|---|---|---|---|
| `frontend-oidc` | 前端（浏览器） | `/frontend-oidc-mode` | `securitydept-token-set-context::frontend_oidc_mode` 负责 `Config / ResolvedConfig / ConfigSource / Runtime / Service / ConfigProjection`；它没有 backend runtime，但已是正式 mode module |
| `backend-oidc` | 后端 | `/backend-oidc-mode` | `securitydept-token-set-context::backend_oidc_mode` 负责统一 backend OIDC capability framework、前端可消费 contract、以及与 `access_token_substrate` 的边界 |

这些是历史遗留和内部概念，已从 canonical public surface 中统一：

- `backend-oidc` 内部包含完整的 preset 逻辑
- `/backend-oidc-mode` 和 `securitydept-token-set-context::backend_oidc_mode` 是统一的入口。

##### `backend-oidc` 的 preset/profile

`backend-oidc` 当前至少需要两组推荐 preset：

| Preset / Profile | 语义 | 默认能力组合 |
|---|---|---|
| `pure` | 最小后端 OIDC baseline | `refresh_material_protection = passthrough`、`metadata_delivery = none`、`post_auth_redirect_policy = caller_validated` |
| `mediated` | custody / policy augmentation | `refresh_material_protection = sealed`、`metadata_delivery = redemption`、`post_auth_redirect_policy = resolved` |

这些 preset 是能力预配置，不是额外一级 mode。

##### 基础设施层（内部实现 crate）

以下 crate 是内部实现层，adopter 不需要直接依赖。它们服务于整个 Rust public surface，而不是某个额外的 pure / mediated 模块分支：

| Crate | 职责 |
|---|---|
| `securitydept-oauth-provider` | OIDC discovery、JWKS、metadata 刷新、`OidcSharedConfig` |
| `securitydept-oidc-client` | OIDC 授权码 / 设备流、共享 `user_info` 协议组合能力 |
| `securitydept-oauth-resource-server` | JWT 验证、introspection |

#### `frontend-oidc`：前端纯 OIDC 客户端

- 前端通过 `oauth4webapi`（官方基座）处理 authorize/callback/token-exchange
- Rust 后端**不**自己运行 OIDC redirect/callback/token-exchange，但 Rust crate 仍通过 `securitydept-token-set-context::frontend_oidc_mode` 提供前端可消费配置，以及正式的 `Config / ResolvedConfig / ConfigSource / Runtime / Service / ConfigProjection`
- `oidc-client-ts` 作为 comparison/reference case（`devDependency` only）

依赖策略：
- `oauth4webapi`：官方基座，`optional peerDependency` + `devDependency`；使用 `/frontend-oidc-mode` 的 adopter 需安装
- `oidc-client-ts`：comparison case，`devDependency` only；不对 adopter 产生安装要求

#### `backend-oidc`：统一后端 OIDC capability framework

`backend-oidc` 不应再被解释成“pure 和 mediated 两套长期并列 mode”，而应视为一套统一后端能力框架：

- 后端运行标准 OIDC client / resource server verifier
- 可跨 preset 复用的 OIDC 协议级编排尽量下沉到 `securitydept-oidc-client`
- browser-facing callback / refresh canonical contract 以统一的 mode-qualified contract 为中心
- `user-info` 获取是 `backend-oidc` 的基线行为，协议核心应通过 `securitydept-oidc-client` 共享，而不是各写一套
- `metadata_redemption` 是独立的数据源投递能力，而 user-info baseline 获取则是基建本身固有的基线行为
- `resource-server`、`propagation`、`forwarder` 是 shared substrate，不再绑死在某个 preset

对外更准确的说法是：

- `backend-oidc-mode` 是前端消费 `backend-oidc` 的 canonical target
- pure / mediated 仅作为 capability preset/profile 叙事存在，不再对应额外的 TS 子路径 family

#### 共享配置模型

`oidc-client` 与 `oauth-resource-server` 通过 `OidcSharedConfig`（`securitydept-oauth-provider`）共享 provider 连接性配置。更准确地说，`OidcSharedConfig` 应被读成整个 Rust crate public surface 的共享 OIDC 配置权威，而不是某个 `backend` 一级命名空间的内部细节，详见 [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md) 中 `token-set-context` 一节。

#### Rust 权威面当前形状

当前 Rust public surface 已经收口为：

- `frontend_oidc_mode`
- `backend_oidc_mode`
- `access_token_substrate`
- `orchestration`
- `models`

其中：

- `frontend-oidc` 的配置规则 属于 `frontend_oidc_mode`
- `backend-oidc` 的 query / payload / callback/refresh return / redemption / user-info contract 属于 `backend_oidc_mode`
- `metadata_redemption`、`BackendOidcModeRuntime`、refresh material、redirect resolver 等材料属于 `backend-oidc` 内部 preset augmentation
- `resource-server` 消费的 access-token contract、`propagation`、`forwarder` 稳定归入 `access_token_substrate`
- 其中 `TokenPropagation` 更适合作为 `access_token_substrate` 自己的 capability，而不是 `backend_oidc_mode` 的 capability axis
- substrate runtime 未来应继续收口为 `AccessTokenSubstrateConfig` / `AccessTokenSubstrateRuntime`
- forwarder 不应直接内嵌进 `TokenPropagation`；更合理的方式是在 substrate runtime 之上通过 `PropagationForwarderConfigSource`、`PropagationForwarder` 两层 trait 构建

#### 跨模式约束

- OIDC mode family 当前只有两个 formal mode：`frontend-oidc` 与 `backend-oidc`
- TS 前端产品面 canonical 子路径当前就是：`/frontend-oidc-mode`、`/backend-oidc-mode`、`/access-token-substrate`、`/orchestration`
- `/orchestration` 是共享基础设施层，不是任一模式的完整替代
- 不同 mode / preset 应复用同一套 token lifecycle、persistence、transport 语义
- 同一 token family 不应出现多权威并存

#### Mixed-Custody 与 BFF 边界

必须考虑 mixed-custody：

- `browser-owned token family`
- `bff-owned token family`

同一 token family 不应由浏览器与 BFF 双权威维护。  
Mixed-custody 应被写入设计，但当前应明确标注为：

- 重要边界
- 高复杂度
- 第一版暂不实现完整能力

#### 多 OIDC Client / 多资格路由编排边界

还必须考虑一种下游 adopter 场景：

- 同一前端宿主对接多个后端服务
- 不同后端服务可能分别使用不同的 OIDC client / audience / scope 组合
- 某个前端路由区域可能同时要求 `app1` 与 `app2` 的资格

这类场景的关键问题不只是“如何拿 token”，而是：

- 哪些 requirement 可以静默满足
- 哪些 requirement 必须交互跳转
- 当同时存在多个交互 requirement 时，是否先让用户选择
- callback 返回后，剩余 requirement 如何继续恢复执行

当前建议方向是：

- 认证栈可以逐步演进出 **headless orchestration primitive / scheduler direction**
- 前端侧，`token-set-context-client` 或其未来上层编排能力可以承担 pending requirement / callback recovery 一类状态机问题；后端侧，`securitydept-token-set-context` 的 mode family 边界需要与之保持一致
- chooser UI、router policy、产品级交互步骤仍应留在 adopter 自己的 app glue 中

当前状态要说清楚：

- 这是一个高价值的下游参考案例方向，有助于指导整个认证栈（前端 `token-set-context-client`后端 `securitydept-token-set-context`）的后续设计
- 但它**不属于当前 v1 已验证 contract**

## SSR / 服务端宿主支持

本文件中的“服务端支持”，指的是 TypeScript SDK 在 SSR / server-render
宿主、以及 server request / response handling 边界下的行为与契约；它**不**
指 Rust route-facing service crate。

服务端支持不应被理解为“再做一套服务端版客户端 SDK 核心”，而应建立在同一套 portable capability 之上。

前端 `token-set-context-client` 中的 orchestration / lifecycle 基座（token snapshot、persistence、transport projection）设计为跨模式共享基础设施。Rust `securitydept-token-set-context` 更适合收口为：

- `frontend_oidc_mode`
- `backend_oidc_mode`
- `access_token_substrate`
- `backend_oidc_mode`
- `orchestration`
- `models`

其中各 `*_mode` module 负责各自 mode 的 config / contract / runtime entry，`access_token_substrate` 负责 resource-server / propagation / forwarder 一类 shared runtime substrate；`TokenPropagation`、`AccessTokenSubstrateConfig`、`AccessTokenSubstrateRuntime` 与 forwarder trait boundary 也应归这一层拥有，`orchestration` 与 `models` 只承载 truly shared abstraction。

### `basic-auth-context` / `session-context`

应支持 redirect-aware SSR / server request handling。

这里表达的是 TS SDK 的目标方向，不应被读成“当前已经有完整产品化的 SSR helper 层”。

核心不是浏览器导航，而是中性的 redirect instruction：

```ts
export const AuthGuardResultKind = {
  Ok: "ok",
  Redirect: "redirect",
} as const

export const AuthGuardRedirectStatus = {
  Found: 302,
  SeeOther: 303,
  TemporaryRedirect: 307,
} as const

type AuthGuardResult<T> =
  | { kind: typeof AuthGuardResultKind.Ok; value: T }
  | {
      kind: typeof AuthGuardResultKind.Redirect
      status: (typeof AuthGuardRedirectStatus)[keyof typeof AuthGuardRedirectStatus]
      location: string
    }
```

### `token-set-context`

服务端支持应被视为更高阶、会引入 stateful BFF 的模式，而不是 SSR 小扩展。

原则：

- `token-set-context` 的服务端支持是 provisional 能力
- SSR / BFF 默认只应消费 `bff-owned` token family
- 对敏感第三方 token，优先避免让 BFF 持有其原始 access token

## 错误模型

客户端不应只做单层 `Error`。  
更适合采用“双层错误模型”：

- machine-facing runtime error
- user-facing presentation / recovery hint

当前与服务端对齐的基础契约：

```ts
export const UserRecovery = {
  None: "none",
  Retry: "retry",
  RestartFlow: "restart_flow",
  Reauthenticate: "reauthenticate",
  ContactSupport: "contact_support",
} as const

type UserRecovery = (typeof UserRecovery)[keyof typeof UserRecovery]

interface ErrorPresentation {
  code: string
  message: string
  recovery: UserRecovery
}
```

当前原则：

- 尽量保留服务端返回的 `error: { codemessagerecovery }`
- `code` 是跨端稳定契约，`message` 不是
- 对这类高频、稳定、可判别的字符串域，优先使用导出的 `const objecttype alias`，例如 `UserRecovery`、`ClientErrorKind`、`AuthGuardResultKind`、`BackendOidcModeBootstrapSource`，而不是裸字符串 union 或 TypeScript `enum`
- 保留 `cause` 与结构化上下文
- redirect / reauthenticate 一类流程性结果不应一律建模成普通异常

## Cancellation 与资源释放

取消与资源释放应作为 core contract。

当前主方向：

```ts
interface DisposableTrait {
  dispose(): void
}

interface CancelableHandle {
  cancel(): void
}

interface CancellationTokenTrait {
  readonly isCancellationRequested: boolean
  readonly reason?: unknown
  onCancellationRequested(listener: (reason: unknown) => void): DisposableTrait
  throwIfCancellationRequested(): void
}

interface CancellationTokenSourceTrait extends DisposableTrait {
  readonly token: CancellationTokenTrait
  cancel(reason?: unknown): void
}
```

原则：

- `CancelableHandle` 主要用于资源句柄
- client 应持有 root cancellation source
- `dispose()` 应负责：
  - cancel root source
  - 清理 scheduler / subscription / watcher
  - 阻止后续启动新 operation
- `AbortSignal` 更适合作为 web interop，而不是 foundation 的唯一取消语义

## Logging、Trace 与测试

foundation 应正式提供可观测性层：

- `LoggerTrait`
- `TraceEventSinkTrait`
- `OperationTracerTrait`

原则：

- 为 OpenTelemetry 预留 bridge，但不直接绑到默认核心协议
- timeline / trace sink 是测试主观察面，不是文本日志

测试体系应分层：

1. 协议与基础原语测试
2. 运行时编排测试
3. auth client 测试
4. adapter 测试
5. 场景 / 回归测试

配套 test utilities 应优先提供：

- `FakeClock`
- `FakeScheduler`
- `FakeTransport`
- `InMemoryPersistence`
- `InMemoryTraceCollector`

## 构建、兼容性与 side effects

### 产物与兼容性

- `ESM only`
- 完整类型声明
- 不默认支持 CJS
- foundation 兼容性主要按 ECMAScript / JS built-in requirement 描述
- 具体宿主环境要求由 adapter capability requirement 描述
- 不维护 caniuse 式的大而全 runtime 支持表
- 应补充 verified environments，说明真实验证过的环境范围

### Polyfill

- 默认不内置或自动注入全局 polyfill
- 默认不 patch `globalThis`
- 能通过 capability injection 解决的问题，不通过 polyfill 解决
- 如确有需要，优先 ponyfill 或 opt-in helper

### sideEffects / tree-shaking

- tree-shaking 是设计目标
- SDK 默认应设计成无副作用
- 任何副作用都需要用户手动挂载或显式初始化
- import 不应自动触发 scheduler、storage、redirect、logger、trace、polyfill 等行为
- `sideEffects: false` 应作为目标能力，而不是事后补充声明

## API 稳定性

不应默认所有 public 导出都同等稳定。  
当前建议至少区分：

- `stable`
- `provisional`
- `experimental`

优先 `stable`：

- foundation 基础协议
- 各 context client 主入口与核心 API

优先 `provisional`：

- `token-set-context` 高级能力
- future server adapter
- mixed-custody / BFF 高级策略

优先 `experimental`：

- 高级 event operators
- advanced DI helpers
- debug / OTel bridge

subpath exports 本身也是 public contract。

### 当前 0.x 阶段的冻结语义

在当前 TypeScript SDK 的 0.x 阶段，这里的 `stable / provisional / experimental` 应按以下方式理解，而不是按“感觉上差不多”理解：

- `stable`
  - 含义：当前已承诺为外部消费者提供可直接依赖的公开 contract
  - 允许变化：新增能力、向后兼容的 convenience、文档澄清、内部重构
  - 不应发生：静默改变主入口职责、把 capability ownership 从一个层级挪到另一个层级、让既有最小接入路径失效
  - 当前依据：根导出边界明确、最小进入路径可说明、ordinary usage 不依赖 reference-app-only glue、并且已有 export/build/public vocabulary 这类最小自动化护栏
- `provisional`
  - 含义：已可用、也属于 public surface，但仍按“冻结中的 adapter / capability 边界”管理
  - 允许变化：在不破坏主能力方向的前提下继续补 lifecycle、补 convenience、补 focused automation、细化 capability requirement
  - 仍需谨慎：入口形态频繁重排、把 app glue 重新带回 adapter、在没有额外证据前提前提升为 `stable`
  - 当前依据：subpath 真实可用，但解释 ordinary usage 时仍更依赖 capability requirement、adapter-owned lifecycle、以及 focused evidence
- `experimental`
  - 含义：为了测试、演示、探索而暴露的能力，不应被读成发布前稳定承诺
  - 允许变化：重命名、重排、替换实现、甚至删除
  - 当前依据：主要服务测试/demo/workbench，而不是面向外部 adopter 的核心接入面

这里的关键不是“标签好不好看”，而是：

- `stable` 回答的是“现在什么可以被当作 v1 候选公开 contract”
- `provisional` 回答的是“什么已经公开可用，但仍按更严格的冻结标准维护”
- `experimental` 回答的是“什么目前主要服务内部验证，而不是外部承诺”

### 当前 Contract 快照

下面这张表是当前 TS SDK 的主判断入口。稳定性、能力前提与边界解释尽量只在这里集中表达，后面的 adopter / verified / promotion 段落只做补充，不再平行复述。

本表使用 canonical mode-aligned names 作为目标 contract。  
如果当前实现仍在迁移，优先以这张表表达的 public surface 边界为准。

| 包 / Subpath | 稳定性 | 宿主 / 能力要求 | 当前解释 |
|---|---|---|---|
| `@securitydept/client` | `stable` | 不要求 DOM，不自动注入 `fetch`；调用方显式提供 transport/runtime | Foundation 根导出 |
| `@securitydept/client/persistence` | `stable` | 不要求浏览器 storage；in-memory / codec / protocol 属于 foundation | Foundation persistence capability |
| `@securitydept/client/web` | `stable` ¹ | `fetch` / `AbortSignal`；browser convenience，不引入 side effect | Foundation-owned capability adapter |
| `@securitydept/client/persistence/web` | `stable` ¹ | Web storage 语义；如无则注入自定义 store | Foundation-owned storage adapter |
| `@securitydept/basic-auth-context-client` | `stable` | 不要求框架依赖；redirect convenience 留在 `./web` | Basic-auth 根 contract |
| `@securitydept/basic-auth-context-client/web` | `provisional` | `location` / redirect 语义 | Auth-context browser adapter；`loginWithRedirect` zone-aware convenience + 命名 `LoginWithRedirectOptions` |
| `@securitydept/basic-auth-context-client-react` | `provisional` | React runtime | 独立 React adapter 包；`BasicAuthContextProvider`、`useBasicAuthContext()` |
| `@securitydept/basic-auth-context-client-angular` | `provisional` | Angular 17+ `@angular/core` InjectionToken + service | 独立 Angular adapter 包：`BASIC_AUTH_CONTEXT_CLIENT` token、`provideBasicAuthContext()`、`BasicAuthContextService` |
| `@securitydept/session-context-client` | `stable` | Transport / cancellation；登录跳转流程不属于 SDK surface | Session 根 contract |
| `@securitydept/session-context-client-react` | `provisional` | React runtime | 独立 React adapter 包；`SessionContextProvider`、`useSessionPrincipal()`、`SessionContextValue` 已导出 |
| `@securitydept/session-context-client-angular` | `provisional` | Angular 17+ `@angular/core` InjectionToken + signal state | 独立 Angular adapter 包：`SESSION_CONTEXT_CLIENT` token、`provideSessionContext()`、`SessionContextService`（含 signal） |
| `@securitydept/token-set-context-client/backend-oidc-mode` | `provisional` ² | Backend OIDC capability negotiation、callback / refresh transport contract、preset/profile introspection、persistence / traceSink | 前端消费 `backend-oidc` 的 **canonical 入口** |
| `@securitydept/token-set-context-client/backend-oidc-mode/web` | `provisional` | `location` / `history` / `fetch` / flow-state storage | 前端消费 `backend-oidc` 的 browser adapter canonical 子路径 |
| `@securitydept/token-set-context-client/orchestration` | `provisional` ³ | 不感知 backend-oidc preset-specific sealed flow；协议无关 token snapshot / persistence / transport / `AuthMaterialController` 薄控制层 | Shared token lifecycle substrate **显式子路径入口**（推荐的协议无关基座；不是完整模式/流程入口） |
| `@securitydept/token-set-context-client-react` | `provisional` | React runtime | 独立 React adapter 包：`TokenSetContextProvider`、React hooks |
| `@securitydept/token-set-context-client-angular` | `provisional` | Angular 17+ Signal / RxJS / HttpClient / DI / callback lifecycle | 独立 Angular adapter 包：`TokenSetAuthRegistry`、`provideTokenSetAuth()`、`CallbackResumeService`、multi-client interceptor。路由 adapter 已全量提取到 `@securitydept/client-angular` |
| `@securitydept/client-react/tanstack-router` | `provisional` | `@tanstack/react-router` matched routes；duck-typed，无 build-time 依赖 | **Canonical** TanStack React Router 路由安全 contract。Canonical adopter-facing 入口：`createSecureBeforeLoad()`（beforeLoad factory，将 runtime policy 接入 router 执行语义）+ `withTanStackRouteRequirements()`（child route 可序列化声明）。下层 primitive：`extractTanStackRouteRequirements()`、`createTanStackRouteSecurityPolicy()`、`projectTanStackRouteMatches()`、`createTanStackRouteActivator()` |
| `@securitydept/client-angular` | `provisional` | Angular `@angular/router` `ActivatedRouteSnapshot`；duck-typed，无运行时依赖 | **Canonical** Angular Router 投影 adapter（`AuthRouteAdapter`）；不含 token-set 策略 |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | `provisional` ⁴ | 前端纯 OIDC client（`frontend-oidc` 模式）；基于 `oauth4webapi`；提供完整 browser client、`ConfigProjection` adapter、claims check、refresh、`userInfo()` | `frontend-oidc` **mode-aligned 显式子路径入口** |
| `@securitydept/token-set-context-client/access-token-substrate` | `provisional` ⁵ | access-token substrate vocabulary、`TokenPropagation` capability、与 Rust `access_token_substrate` 对齐的 integration info | shared substrate 的 **显式子路径入口** |
| `@securitydept/test-utils` | `experimental` | Fake clock / scheduler / transport / trace collector | 测试/演示基础设施 |

¹ Adapter subpath 默认 `provisional`，但 `@securitydept/client/web` 与 `@securitydept/client/persistence/web` 是刻意保留的 `stable` 例外：职责窄、无产品语义、只把 foundation protocol 接到宿主能力上。

² `/backend-oidc-mode*` 是当前文档中的 canonical 目标 contract。它已经是当前真实存在的对外子路径家族；当前稳定性之所以仍为 `provisional`，是因为 capability/adapter surface 仍在冻结中，而不是因为仍依赖其它过渡子路径。

³ orchestration 能力通过 `@securitydept/token-set-context-client/orchestration` 显式子路径对外暴露，承载在同一 npm 包内，未独立成新包。外部 adopter 可使用 `AuthMaterialController`（薄控制层）及其 `applyDelta()` 外部驱动更新入口，或直接使用底层 helper，如 `bearerHeader`、`createAuthStatePersistence`、`createAuthorizedTransport`。控制层仅承接 token material lifecycle，不提供 acquisition / redirect / refresh scheduling 能力。它本身不是完整模式或完整 flow 入口，而是前端产品面内部的共享 token lifecycle 基座，供 `/backend-oidc-mode` 与 `/frontend-oidc-mode` 等子路径复用，并与更高层的 auth context / mode 分层设计保持一致。官方前端 OIDC 封装使用 `oauth4webapi`，`oidc-client-ts` 为 comparison case（详见 [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md)）。稳定性仍属冻结进行中（`provisional`）：已公开、有显式入口，但不是完整 `stable` 承诺。

⁴ `/frontend-oidc-mode` 子路径实现 `frontend-oidc` 模式，以 `oauth4webapi` 为基座。当前为 `provisional`：已有显式入口、browser runtime、与 Rust `FrontendOidcMode*` 对齐的 `ConfigProjection`、以及 claims check、refresh、`userInfo()` 等 client API。使用 `/frontend-oidc-mode` 的 adopter 需安装 `oauth4webapi`（`optional peerDependency`）。

⁵ `/access-token-substrate` 子路径承载 access-token substrate 的共享 vocabulary。它不是额外 mode，而是与 Rust `securitydept-token-set-context::access_token_substrate` 对齐的 shared contract surface。

统一解释：

- `stable`：当前已可作为 0.x 外部 contract 直接解释
- `provisional`：公开可用，但仍按更严格的 adapter 冻结标准维护
- `experimental`：主要服务测试/demo/workbench，而不是 adopter-facing contract
- 自动化当前锁住 export map、`sideEffects: false` 与构建 entry 对齐；稳定性标签本身仍是文档层判断

#### token-set-context-client Subpath Family 阅读方式

把 `@securitydept/token-set-context-client` 先读成**前端产品面**，再读它内部的 subpath family：

- root (`.`) 及旧 `./web` / `./react` bridge 已移除，不再存在于 package exports 中
- `/backend-oidc-mode*` 是前端消费 `backend-oidc` 的 canonical family
- `/frontend-oidc-mode` 是 `frontend-oidc` 的 mode-aligned 前端实现子路径
- `/access-token-substrate` 是 access-token substrate 的显式 shared contract 入口
- `/orchestration` 是共享 token lifecycle substrate，不是完整模式或完整 flow
- mode family 是跨前后端设计层；subpath family 是前端产品面内部导出层，二者不是同一维度
- Rust 侧也应采用顶层 `*_mode` / shared module 结构；TS subpath family 与 Rust crate public modules 都应服务同一套 mode / shared 边界

#### Capability Boundary Rules

用下面这些规则快速回答"某个能力到底在哪一层"，不必反复读完整指南：

- **redirect / location / history** → `./web` subpath 或 app glue，不回流到 foundation 根导出
- **fetch / AbortSignal** → foundation transport 可表达取消；browser convenience 继续属于 `./web`
- **persistence / web storage** → protocol 与 codec 属于 foundation；`localStorage` / `sessionStorage` 适配属于 `persistence/web`
- **React state / subscription** → 对应的 independent `-react` package（独立包），不与核心逻辑混同
- **traceSink / lifecycle trace** → SDK contract
- **trace timeline UI / DOM harness / propagation probe / business helper** → reference app glue，不属于 SDK surface

#### token-set-context-client 前端 subpath / abstraction split

基于当前 `outposts` 单 provider / 单 app 接入 `oauth-resource-server` 的经验，`token-set-context-client` 内部已引入更清晰的模块边界：

- **通用 token orchestration**（`src/orchestration/`）
  - 管 `access_token` / `id_token` / `refresh_token` 的组合状态
  - 管 restore / refresh / persistence / disposal / transport projection
  - 不要求知道 token 的来源是标准 OIDC、后端 OIDC 或某个 backend-oidc preset
- **backend-oidc adapter**
  - 管 callback returns、refresh payload、metadata fallback、统一的 OIDC metadata fallback
  - 在需要时感知 preset augmentation（如 sealed / redemption），但 public surface 仍统一挂在 `backend-oidc-mode*`

当前已落地的最小内部模块切片：

| 内部模块 | 内容 |
|---|---|
| `orchestration/types.ts` | `TokenSnapshot`、`TokenDelta`、`AuthSnapshot`、`AuthPrincipal`、`AuthSource` |
| `orchestration/token-ops.ts` | `mergeTokenDelta()`、`bearerHeader()` |
| `orchestration/persistence.ts` | `createAuthStatePersistence()` 及对应的强类型选项配置 `CreateAuthStatePersistenceOptions` |
| `orchestration/auth-transport.ts` | `createAuthorizedTransport()` |
| `orchestration/controller.ts` | `AuthMaterialController` / `createAuthMaterialController()` |
| `frontend-oidc-mode/types.ts` | `FrontendOidcModeClientConfig` / `FrontendOidcModeTokenResult` / `FrontendOidcModeAuthorizeResult` / `FrontendOidcModeUserInfo` |
| `frontend-oidc-mode/client.ts` | `createFrontendOidcModeClient()` / `FrontendOidcModeClient` |
| `frontend-oidc-mode/contracts.ts` | `FrontendOidcModeConfigProjection` adapters |
| `frontend-oidc-mode/config-source.ts` | `ConfigProjectionSource*` — 异步配置投影源 contract：source 类型（`inline`、`network`、`persisted`、`bootstrap_script`），`resolveConfigProjection()` 优先级解析器，`ClientReadinessState`，`networkConfigSource()` 便捷 helper |
| `access-token-substrate/contracts.ts` | `TokenPropagation` / `AccessTokenSubstrateIntegrationInfo` |
| `backend-oidc-mode/contracts.ts` | `BackendOidcModeCapabilities` / `BackendOidcModePreset` / callback / refresh / redemption / `UserInfoRequest` / `UserInfoResponse` 等 transport contract |

现有 v1 类型（如 `AuthTokenSnapshot`、`AuthStateSnapshot`）是对 orchestration 类型的 re-export alias，完全向后兼容。

#### Config Projection Source Contract（`frontend-oidc-mode/config-source.ts`）

`frontend-oidc-mode` 子路径现在拥有正式的**异步配置投影源**contract。这是 core/shared 能力——不是 Angular 或 React 独有的关注点。

**解决的问题**：在此 contract 之前，需要从后端端点（如 `/api/auth/config`）获取 OIDC 客户端配置的 adopter 必须创建 app-local 的 workaround（Angular `APP_INITIALIZER` + 闭包 hack，React `useEffect` + context）。这些 hack 将 SDK ownership 泄漏到 adopter 层，阻止了框架 adapter 正确表达 readiness 语义。

**Source 类型**（`ConfigProjectionSourceKind`）：

| Source Kind | 解析方式 | 用途 |
|---|---|---|
| `inline` | 同步——注册时已提供 config | 硬编码 config，测试环境 |
| `network` | 异步——从后端端点 fetch | 生产环境 backend-driven config projection |
| `persisted` | 异步——从 localStorage/sessionStorage 恢复 | 离线优先，热启动优化 |
| `bootstrap_script` | 同步——从 `window.__BOOTSTRAP__` 全局变量读取 | SSR 注入的 config，CDN edge config |

**解析语义**（`resolveConfigProjection(sources[])`）：
- Sources 按声明顺序尝试（最高优先级在前）
- 第一个成功的 source 生效；失败的 source 跳过并记录诊断日志
- 所有 sources 耗尽 → 抛出诊断摘要错误
- 结果包含 `sourceKind` 用于遥测和缓存决策

**Readiness 状态**（`ClientReadinessState`）：
- `not_initialized` → `initializing` → `ready` | `failed`
- Angular 与 React adapter 现在共享 `@securitydept/token-set-context-client/registry` core，两侧统一暴露该状态
- React `useTokenSetCallbackResume` / `TokenSetCallbackOutlet` 现在把 callback 主路径接在 `registry.whenReady(clientKey)` 上，随后再调用 `handleCallback()`，async / lazy client 不再需要 adopter 侧自行 `whenReady()`（iteration 110 review-1 修复）
- 路由 guard（`createTokenSetRouteAggregationGuard`）和 callback service（`CallbackResumeService`）使用 `registry.whenReady(key)` 等待异步初始化
- Bearer interceptor **刻意不**等待 readiness——使用 `registry.get()` 并在客户端未就绪时直接放行（无 token）；guard 才是强制执行层

**Canonical 用法**（Angular adapter）：

```ts
import { resolveConfigProjection, networkConfigSource, createFrontendOidcModeClient }
  from "@securitydept/token-set-context-client/frontend-oidc-mode";

provideTokenSetAuth({
  clients: [{
    key: "main",
    // 异步 clientFactory——registry 自动跟踪 readiness
    clientFactory: async () => {
      const resolved = await resolveConfigProjection([
        networkConfigSource({
          apiEndpoint: "https://api.example.com/api",
          redirectUri: `${location.origin}/auth/callback`,
        }),
      ]);
      return createFrontendOidcModeClient(resolved.config, runtime);
    },
    urlPatterns: ["/api/"],
    callbackPath: "/auth/callback",
  }],
});
```

**关键设计决策**：
- Config source 解析在设计上是框架无关的——`resolveConfigProjection()` API 位于 core `frontend-oidc-mode` 子路径。Angular adapter（`TokenSetAuthRegistry`）与 React adapter（`TokenSetAuthProvider` + `useTokenSetCallbackResume`）均通过 async `clientFactory` 消费此 API；React callback 路径在调用 `handleCallback()` 前先 await `registry.whenReady(clientKey)`，async / lazy client 的 callback 不再依赖 adopter 自行接线
- `TokenSetClientEntry.clientFactory` 现在除同步返回外还接受 `() => Promise<OidcModeClient>`
- `TokenSetAuthRegistry.register()` 使用 TypeScript 重载保持向后兼容的同步返回类型推断
- Metadata（urlPatterns、callbackPath、requirementKind、providerFamily）在异步解析完成前即被 eagerly 注册——查找维度立即可用
- 路由 guard（`createTokenSetRouteAggregationGuard`）使用 `registry.whenReady(key)` 等待 client 物化
- Callback service（`CallbackResumeService`）在调用 `handleCallback()` 前使用 `registry.whenReady(clientKey)`
- Bearer interceptor 刻意使用 `registry.get()`（而非 `whenReady`）——client 尚未就绪时请求正常放行；guard 是强制执行点

当前状态说明：

- 这些 orchestration exports 现在是**已公开的 additive exports**，不是 purely internal-only
- 这些协议无关的编排基础件（Substrate）由于处于核心被调用的位置，它们本身直接承载在 `@securitydept/token-set-context-client` 包内，不作为独立 npm 包拆出
- 外部 adopter 可以使用这些 exports 组合通用 token orchestration 能力（见 `examples/token-orchestration-contract.test.ts`）
- `backend-oidc-mode/contracts.ts` 已是当前 canonical frontend-facing contract surface 的一部分
- `@securitydept/token-set-context-client/orchestration` 已成为**显式子路径入口**，推荐协议无关场景优先从此进入
- `/orchestration` 子路径是协议无关 orchestration exports 的唯一入口（root bridge 已移除）
- `AuthMaterialController`（`createAuthMaterialController()`）是本层的薄控制层入口，组合了 snapshot read/write、bearer projection、persistence restore/save/clear 与 authorized transport 四件套
- `AuthMaterialController.applyDelta()` 是外部驱动 renew/update 的协议无关入口：
  - 接受 `TokenDelta`（只含变化的字段），内部调用 `mergeTokenDelta()` 合并
  - 不提供 `metadata` 时自动保留当前 metadata（刷新不改变 principal）
  - 提供 `options.metadata` 时替换（重新认证、source 变化等场景）
  - 自动 save merged snapshot 到 persistence（与 `applySnapshot` 一致）
  - 如无现有 snapshot 则抛出错误（需先调用 `applySnapshot` 建立初始状态）
- `BackendOidcModeClient` 内部已进一步建立在控制层之上：
  - `restoreState()` / `clearState()` / `restorePersistedState()` 通过 controller 路由
  - `authorizationHeader()` 直接由 controller 提供
  - `refresh()` 成功路径通过 `_authMaterial.applyDelta()` 完成 token 合并并持久化
  - 原来采用配置对象作为参数的公有方法，已被定义并将它们的强类型契约导出至 `backend-oidc-mode` canonical subpath，包括 `BackendOidcModeRefreshOptions`、`BackendOidcModeFetchUserInfoOptions` 及 `BackendOidcModeMetadataRedemptionOptions`。
  - `createBackendOidcModeAuthorizedTransport()` 内部委托到 `createAuthorizedTransport()`
- 但 `/orchestration` 不应再被继续单独抽象推演成最终前端 OIDC 方案；下一阶段应直接用 `oauth4webapi`、`oidc-client-ts` 与真实 Angular 宿主案例来校准 `frontend-oidc` 模式的前端实现
- Angular 案例应优先参考 `outposts` 这类真实 adopter 的宿主约束；它当前基于 `angular-auth-oidc-client` 的桥接形状只能作为迁移输入，而不是 SDK Angular public contract 的模板
- 当前规划中的官方 `frontend-oidc` 前端实现，位于 `token-set-context-client` 内部（`/frontend-oidc-mode` 子路径），以封装 `oauth4webapi` 为基座，复用同包内的 orchestration 基础设施。对应的后端消费入口是 `/backend-oidc-mode`
- 当前默认预期是沿同一包内的 subpath / additive surface 继续演进，而不是先把它拆成并列新包
- 当前前端 public surface 应按 exact mode-aligned canonical subpath family 理解，而不再依赖 root bridge：
- `/backend-oidc-mode` — 前端消费 `backend-oidc` 的 canonical 子路径（`provisional`）
- `/backend-oidc-mode/web` — backend-oidc mode browser adapter 子路径（`provisional`）
- `/orchestration` — 共享 protocol-agnostic token lifecycle substrate，供 `/backend-oidc-mode` 与 `/frontend-oidc-mode` 复用（`provisional`）
- `/frontend-oidc-mode` — `frontend-oidc` 的 mode-aligned 前端子路径，封装 `oauth4webapi`，提供 browser client、`ConfigProjection` adapter 和**配置投影源 contract**（`provisional`）
- `/access-token-substrate` — 与 Rust `access_token_substrate` 对齐的 shared substrate contract 子路径（`provisional`）
- root (`.`) 及旧 `./web` / `./react` bridge 已移除，canonical 子路径家族是唯一对外 public surface
- Rust 侧 `securitydept-token-set-context` 也已经按顶层 `*_mode` / shared modules 承接前端可消费配置、跨边界 contract 与 shared substrate
- 依赖语义：
  - `oauth4webapi` = 官方基座，`optional peerDependency` + `devDependency`
  - `oidc-client-ts` = comparison/reference case，`devDependency` only


### Framework Router Adapters

路由级 auth 编排需要将框架特定的匹配路由树映射到 SDK 的 `RouteMatchNode[]` contract。SDK 提供专用的 adapter 子路径：

| Adapter 包 / 路径 | 框架 | 稳定性 | 用途 |
|---|---|---|---|
| `@securitydept/client-react/tanstack-router` | `@tanstack/react-router` | `provisional` | **Canonical owner。** 与 Angular sibling 对齐的完整 route-security contract。Canonical adopter-facing 入口：`createSecureBeforeLoad()` — 根级 beforeLoad factory，将不可序列化 runtime policy 接入 TanStack Router 执行语义（抛出 `redirect` 或 `RouteSecurityBlockedError`）；child route 仅通过 `withTanStackRouteRequirements()` 声明可序列化 `staticData`。通过 `extractTanStackRouteRequirements()` 实现 `merge` / `replace` / `inherit` 组合语义的全路径聚合。下层 primitive：`createTanStackRouteSecurityPolicy()`、`projectTanStackRouteMatches()`、`createTanStackRouteActivator()` |
| `@securitydept/client-angular` | Angular Router | `provisional` | **Canonical owner。** 带 `merge` / `replace` 组合语义的路由元数据助手（`withRouteRequirements`、`extractFullRouteRequirements`、`resolveEffectiveRequirements`）；planner-host DI 接线；signal/Observable 桥接工具（`bridgeToAngularSignal`、`signalToObservable`）；`AuthRouteAdapter` injectable service |

设计规则：

- Adapter 使用**duck-typed 接口**，**不**引入 build-time 框架依赖（`@tanstack/react-router`、`@angular/router`）
- Adopter 自带框架依赖；adapter 接受结构兼容的对象
- Adapter 只做投影和集成，**不**拥有 router lifecycle、navigation 或 UI
- headless orchestration core (`/orchestration`) 保持 framework-agnostic
- auth requirement 在路由配置中声明（TanStack `staticData`、Angular route `data`），使用约定 key（默认 `authRequirements`）

#### Framework adapter 独立包审计（iteration 100 裁决）

React adapter 与 Angular adapter 均已拆分为独立 npm 包。Angular adapter 使用 `ng-packagr` 生成 APF / FESM2022 输出，React adapter 使用 `tsdown` 构建：

| Surface | React adapter 独立包 | Angular adapter 独立包 | 状态 |
|---|---|---|---|
| `basic-auth-context-client` | `@securitydept/basic-auth-context-client-react` | `@securitydept/basic-auth-context-client-angular` | **已落地**：React：`BasicAuthContextProvider` + hooks；Angular：`@Injectable()` service + InjectionToken + provideBasicAuthContext() |
| `session-context-client` | `@securitydept/session-context-client-react` | `@securitydept/session-context-client-angular` | **已落地**：React：`SessionContextProvider` + hooks + `SessionContextValue`；Angular：`@Injectable()` service + Angular signal state + provideSessionContext() |
| `token-set-context-client`（跨模式） | `@securitydept/token-set-context-client-react` | `@securitydept/token-set-context-client-angular` | **已落地**：React：OIDC mode 集成 hooks；Angular：multi-client registry（`TokenSetAuthRegistry`）+ provideTokenSetAuth() + `@Injectable()` CallbackResumeService + multi-client interceptor + canonical `secureRouteRoot` / `secureRoute` 路由安全构建器。（框架路由投影归 `@securitydept/client-react` 与 `@securitydept/client-angular`） |

Angular adapter 使用真实 `@angular/core` `@Injectable()` decorator、`InjectionToken`、`signal()`、RxJS Observable。构建输出由 `ng-packagr` 管理（partial compilation → JIT linkable）。

> **注意**：API contract 形状已落地并通过测试覆盖。`outposts` 真实宿主接入尚未开始，可能在实际消费中暴露 ergonomics 调整需求。


### token-set-context-client v1 Scope Baseline

`@securitydept/token-set-context-client` 当前应按冻结中的 browser-owned v1 baseline 理解，而不是把所有未来 custody 模型都读进来。

| 当前 baseline contract 内 | 不属于当前 baseline contract |
|---|---|
| browser-owned `backend-oidc` consumption | mixed-custody token family 管理 |
| callback returns parsing, metadata fallback | stateful BFF token ownership |
| in-memory auth state signal | server-side mediated token ownership / SSR token store |
| persisted restore, explicit clear | cross-tab sync / visibility re-check 等更大 browser lifecycle hardening |
| refresh-token-driven refresh | 多 provider orchestration / token family policy |
| bearer authorization header projection | product-specific resource helpers / propagation probe / trace timeline UI |
| `createBackendOidcModeAuthorizedTransport()` 等 token-snapshot transport convenience | popup-based login flow（两种模式均涉及） |
| `./web` browser bootstrap / callback returns capture / reset helpers |  |
| 框架特定（`-react` 与 `-angular` 独立包）最小集成 |  |

右侧列并**不**等于“全部延期到 2.0 之后”。  
在当前 `2.0-alpha` 重审后，这些主题应拆成三类：

- `2.0` backlog：popup 登录、cross-tab / visibility lifecycle hardening、多 provider orchestration
- `3.0` 延期：mixed-custody / BFF / server-side mediated token ownership
- 设计上就不属于 SDK surface：product-specific helper、probe、timeline UI

这些主题继续留在当前 baseline contract 之外，是因为：

- mixed-custody / BFF / server-side mediated token ownership 会实质改变 ownership model
- 更大的 browser lifecycle hardening 属于后续 adapter hardening，而不是第一版 root-contract freeze
- app-specific helper 与 probe 依赖 reference app API 形状和产品模型，留在 `apps/webui` 才能保持 SDK surface 清晰

### 2.0-alpha 重审：未完成项状态

这份 guide 当前同时承载了三类内容：

- 当前已实现 contract
- 设计规则 / 预期架构
- 尚未完成、但仍属于产品面目标的功能

为了减少当前 `2.0-alpha.x` 阶段的歧义，下面这张表应被视为本文件中主要未完成项的 authoritative 重审结论。

| 主题 | 当前重审结论 | 2.0 GA 前要求 |
|---|---|---|
| `@standard-schema` 支持 | **多路径 adoption 已实现。** Foundation validation entry（`createSchema`、`validateWithSchema`、`validateWithSchemaSync`）在 `@securitydept/client` 中。真实 adoption：`session-context-client.fetchMe()`、`frontend-oidc-mode.parseConfigProjection()`、`BasicAuthContextClient` config validation、`parseBackendOidcModeCallbackBody` / `parseBackendOidcModeRefreshBody`。行为级 evidence 在 `standard-schema-adoption.test.ts` 和 `standard-schema-expanded-adoption.test.ts`。 | 按需逐步扩展到其他 cross-boundary payload。 |
| 调度与统一输入源 | **Foundation baseline 已实现。** `Scheduler` / `Clock` 抽象 + 默认 runtimes + 新 foundation helpers：`timer()`、`interval()`、`scheduleAt()`、`fromEventPattern()` 在 `@securitydept/client` 中。浏览器 adapter：`fromVisibilityChange()` 在 `@securitydept/client/web` 中。真实 adoption：`FrontendOidcModeClient` metadata refresh 使用 `interval()`。 | `fromSignal`、storage adapter、cross-tab leader election 仍延期。 |
| `basic-auth-context-client` 轻量 browser helper | **baseline 已实现。** zone-aware login/logout URL 构造、neutral redirect instruction、`./web` redirect helper（`performRedirect`）和 `loginWithRedirect()` convenience（带命名 `LoginWithRedirectOptions`）及 focused tests 已存在。 | 2.0 前继续保持 thin，不要求扩成更重的产品 UI。 |
| `session-context-client` login-trigger convenience | **baseline 已实现。** `loginWithRedirect()` convenience 已在 `@securitydept/session-context-client/web` 中建立；行为级测试覆盖 pending redirect state 和浏览器导航。 | 保持 thin；仅在 adopter 反馈需要时扩展。 |
| token-set redirect 登录 convenience | **baseline 已实现。** `loginWithBackendOidcRedirect()` 在 `backend-oidc-mode/web` 中、`FrontendOidcModeClient.loginWithRedirect()` 在 `frontend-oidc-mode` 中提供一步式 redirect convenience；行为级测试覆盖两者。 | 保持 thin；仅在 adopter 反馈需要时扩展。 |
| `backend-oidc-mode` / `frontend-oidc-mode` 的 popup 登录 | **baseline 已实现。** 共享 popup 基础设施（`openPopupWindow`、`waitForPopupRelay`、`relayPopupCallback`、`PopupErrorCode`）在 `@securitydept/client/web` 中。`loginWithBackendOidcPopup` + `relayBackendOidcPopupCallback` 在 `backend-oidc-mode/web` 中。`FrontendOidcModeClient.popupLogin()` 在 `frontend-oidc-mode` 中。稳定错误码覆盖 blocked、closed、timeout 和 relay error 语义。 | Cross-tab lifecycle hardening、chooser UI 和 multi-provider orchestration 明确延期到 baseline 之后。 |
| 多 OIDC Client / 多资格路由编排 | **Headless primitive baseline 已实现。** `createRequirementPlanner()` 在 `@securitydept/client/auth-coordination` 中提供 mode-agnostic 顺序 requirement planner，包含 `AuthRequirement`、`PlanStatus`、`ResolutionStatus`、`PlanSnapshot`。`kind` 是 opaque `string`，不再导出 `RequirementKind` 常量。支持顺序推进、混合 resolution 状态、reset/retry 与错误路径。`createRouteRequirementOrchestrator()` 提供 route-level 的 matched-route-chain 胶水层。 | Chooser UI、app router 集成、跨 tab 编排、非顺序（并行/条件）flow 仍延期。 |
| `basic-auth-context` 的 SSR / server-render-host 支持 | **Server helper baseline 已实现。** `createBasicAuthServerHelper()` 在 `@securitydept/basic-auth-context-client/server` 中提供 host-neutral 的 `handleUnauthorized()`、`loginUrlForPath()`、`logoutUrlForPath()`，含 `ServerRequestContext` / `ServerRedirectInstruction` contract。Contract-level evidence 在 `ssr-server-helper-baseline.test.ts`。 | Framework-specific adapter（Next.js、Remix）仍延期。 |
| `session-context` 的 SSR / server-render-host 支持 | **Server helper baseline 已实现。** `createSessionServerHelper()` 在 `@securitydept/session-context-client/server` 中提供 host-neutral 的 `fetchMe()` + cookie 转发 transport、`loginUrl()`、`logoutUrl()`。Contract-level evidence 在 `ssr-server-helper-baseline.test.ts`。 | Framework-specific adapter 和 response mutation abstraction 仍延期。 |
| TS SDK 冻结与 release-gate 纪律 | **0.x baseline 全部实现。** `public-surface-inventory.json` 提供含 stability、evidence、docs anchor、`changeDiscipline` 的权威清单。`release-gate.test.ts`（14 tests）校验 export 对齐、evidence、docs anchor（EN heading + ZH 结构对齐）、stability、discipline/stability 对齐、migration ledger 存在性。`110-TS_SDK_MIGRATIONS.md` 为 adopter 可引用的迁移记录。 | Full semver / release automation / changelog generation 仍延期。 |
| Mixed-Custody / BFF / server-side token ownership | 是重要边界，但复杂度高，不属于当前 browser-owned 2.0 baseline。 | 明确延期到 3.0，而不是继续扰动 2.0 release target。 |

这张表刻意只审计 TS SDK surface。Rust backend service support 属于仓库中的另一类问题，不应和这里的 SSR / 服务端宿主支持混为一谈。

#### Popup-based 登录设计方向

Popup 登录 baseline **已实现**。以下组件可用：

当前实现：

- 共享 popup 基础设施在 `@securitydept/client/web` 中：
  - `openPopupWindow()` — 弹窗打开 + blocked 检测
  - `waitForPopupRelay()` — `postMessage` relay 等待（含 closed/timeout 处理）
  - `relayPopupCallback()` — 通用 callback relay helper
  - `PopupErrorCode` — 稳定错误码（`popup.blocked`、`popup.closed_by_user`、`popup.relay_timeout`、`popup.relay_error`）
  - `computePopupFeatures()` — 居中弹窗 features 字符串
- `backend-oidc-mode/web`：
  - `loginWithBackendOidcPopup()` — 顶层 popup 登录，relay fragment 回既有 bootstrap 管线，尊重 `callbackFragmentKey` / `sessionStore` 命名空间
  - `relayBackendOidcPopupCallback()` — mode-local callback relay helper
- `frontend-oidc-mode`：
  - `FrontendOidcModeClient.popupLogin()` — 实例方法，组合 `authorizeUrl()` → 弹窗 → relay → `handleCallback()` → persist
  - `relayFrontendOidcPopupCallback()` — mode-local callback relay helper

明确延期到 baseline 之后：

- cross-tab lifecycle hardening / leader election
- chooser UI 或多 provider orchestration
- 自动降级（popup blocked → redirect）— 留给消费方决策

### Adopter 使用清单

本节只回答外部 adopter 最关心的问题：我能不能用、该从哪一层开始、哪些东西不要误读成 SDK surface。

| 如果你需要... | 当前应这样理解 | 不要这样假设 |
|---|---|---|
| Browser App / SPA 消费 `backend-oidc` | 直接从 `@securitydept/token-set-context-client/backend-oidc-mode` 进入 | timeline UI、propagation probe、`apps/webui/src/api/*` 是 SDK surface |
| 前端消费特定 preset | 继续通过 `@securitydept/token-set-context-client/backend-oidc-mode`，再用 capability/preset 信息决定具体行为 | pure / mediated 对应额外的长期并列 canonical family |
| React integration | 用 `*-react` 独立包做最小 Provider, hook integration；`session-context-client-react` 可直接从下方 React 入口片段开始 | route guard、pending redirect UI、reference page interaction form 属于 adapter contract |
| browser-owned baseline 之外的 mediated token ownership | 直接按“明确延期到 `3.0`，不属于当前 `2.0` public surface”理解 | mixed-custody / BFF / SSR token store 已经内建支持 |

#### 不应被当作 SDK Surface 的内容

| 内容 | 应在哪里 | 原因 |
|---|---|---|
| `apps/webui/src/api/*` 业务 helper | reference app | 依赖 reference app API 形状与产品模型 |
| trace timeline UI / DOM harness | reference app | 调试/演示 glue，非外部 contract |
| propagation smoke / same-server probe | reference app, server config | 依赖产品路由与服务配置 |
| SSR session redirect glue（完整版） | app/server 层 | 框架 response 边界属于 app |
| cross-tab sync / visibility lifecycle hardening | 后续 adapter hardening backlog | 当前还不属于 public adapter contract，但 `2.0` GA 前应补出最小 baseline |

#### 开始接入前的确认清单

- 你的运行环境具备 `fetch` / `AbortSignal`
- 你的存储需求可由 `localStorage` / `sessionStorage` 满足，或已准备好注入自定义 store
- 你已理解 `./web` 与 `-react` 独立包仍是 `provisional`
- 你不期望 SDK 吸收 route guard / 登录跳转 / timeline UI 等产品级关注点
- 如果用 React，你准备由宿主显式提供 transport / scheduler / clock

### Verified Environments / Host Assumptions

这里的“当前已验证”指能力前提测试环境粒度，不是品牌浏览器兼容矩阵。

| 范围 | Required Host Capability | Currently Verified | Assumed but Not Broadly Verified | Not Yet Verified / Not Promised |
|---|---|---|---|---|
| Foundation 包 | ES2020+、`Promise`、`Map` / `Set` / `WeakRef` | Node.js（vitest）、modern browser（Vite build） |  | IE / legacy environments、非 ES 模块宿主、CJS 消费者 |
| Browser capability adapter | `fetch`、`AbortSignal`、`localStorage` / `sessionStorage` 语义 | apps/webui dogfooding、vitest jsdom | `sessionStorage` 跨 tab 隔离、storage event 精确行为 | Service Worker 环境、非标准 storage 宿主、浏览器版本矩阵 |
| Auth-context `./web` adapter | `location.href`、`history.replaceState`、`fetch`、flow-state storage | apps/webui dogfooding、backend-oidc-mediated browser focused lifecycle tests | SPA router 边缘行为、iframe / webview 适用性 | 非 SPA router 场景、SSR 宿主、React Native / Electron |
| React adapter | React 18+（`useSyncExternalStore`）、宿主提供 transport / scheduler / clock | vitest focused adapter test(s)、apps/webui dogfooding | React 17、React Server Components、concurrent mode 边缘行为 | 非 React 宿主、React Native |

### 最小进入路径

下面这些片段的目标是回答“最小怎么开始接”，而不是替代 reference app。

#### 1. Foundation 入口：runtime 仍由宿主显式拥有

当宿主希望自己掌握 transport/runtime 接线时，优先从 foundation 包开始。

```ts
import { createRuntime } from "@securitydept/client";
import { SessionContextClient } from "@securitydept/session-context-client";

const runtime = createRuntime({
	transport: {
		async execute(request) {
			const response = await fetch(request.url, {
				method: request.method,
				headers: request.headers,
				body: request.body,
			});

			return {
				status: response.status,
				headers: Object.fromEntries(response.headers.entries()),
				body: await response.json().catch(() => null),
			};
		},
	},
});

const sessionClient = new SessionContextClient({
	baseUrl: "https://auth.example.com",
});

const session = await sessionClient.fetchMe(runtime.transport);
```

#### 2. Browser 入口：`./backend-oidc-mode/web` 负责 browser glue

当宿主希望直接使用浏览器侧的 `fetch`、storage flow-state 与 callback bootstrap helper 时，优先从 `./backend-oidc-mode/web` 进入。

`createBackendOidcModeBrowserClient()` 承接 `BackendOidcModeClientConfig` 的**全部字段**（`baseUrl`、`loginPath`、`refreshPath`、`metadataRedeemPath`、`userInfoPath`、`refreshWindowMs`、`persistentStateKey`、`defaultPostAuthRedirectUri`），同时管理浏览器 runtime 接线（`persistentStore`、`sessionStore`、`transport`、`fetchTransport`、`scheduler`、`clock`、`logger`、`traceSink`）。如果需要完全控制 `ClientRuntime`，应直接构造 `BackendOidcModeClient`。

**`transport` 与 `fetchTransport` 的优先级：**

- 传入 `transport` 时，它直接作为 runtime transport，`fetchTransport` 被忽略
- 不传 `transport` 时，entry 通过 `createWebRuntime` 创建默认的 `fetch` transport；此路径下 `fetchTransport` 选项会与 SDK 默认值（`redirect: "manual"`）合并，允许 adopter 微调 fetch 行为而无需重写整个 transport
- SDK 默认 `redirect: "manual"` 是 backend-oidc 浏览器协议处理所需的安全默认值

**同源多集成的存储隔离**：当同一 origin 下运行多个独立的 backend-oidc integration 且共享相同存储时：

- `persistentStateKey` 隔离 persisted auth state（已登录 token 快照）
- callback fragment 隔离通过 `bootstrapBackendOidcModeClient` 和 `resetBackendOidcModeBrowserState` 的 `callbackFragmentKey` + `sessionStore` 完成；使用 `resolveBackendOidcModeCallbackFragmentKey(persistentStateKey)` 派生 namespaced key
- `resetBackendOidcModeBrowserState` 会跟 bootstrap 同样接受 `callbackFragmentKey` / `sessionStore` convenience 参数，确保清理能够正确找到独立的 fragment store。显式提供的 `callbackFragmentStore` 优先级高于 `callbackFragmentKey` / `sessionStore`

> [!NOTE]
> 所有的 browser helpers 的选项参数都已被提取为强类型的命名接口，并且直接可以从 `@securitydept/token-set-context-client/backend-oidc-mode/web` 中导入。例如 `BootstrapBackendOidcModeClientOptions` 和 `ResetBackendOidcModeBrowserStateOptions` 等可以用来进行显式的类型声明。

**一步登录跳转：** `loginWithBackendOidcRedirect(client, options?)` 是推荐的一步式 backend-oidc 登录浏览器入口。它会解析授权 URL 并导航当前窗口。选项合约 `LoginWithBackendOidcRedirectOptions` 从 `@securitydept/token-set-context-client/backend-oidc-mode/web` 导出。

**Session-context 浏览器便捷层：** `@securitydept/session-context-client/web` 提供 `loginWithRedirect(client, options?)` — 一步式 session 登录跳转 helper，保存 post-auth redirect intent 并导航至登录 URL。选项合约 `LoginWithRedirectOptions` 从 `/web` 子路径导出。

**Basic-auth 浏览器便捷层：** `@securitydept/basic-auth-context-client/web` 提供 `loginWithRedirect(client, options?)` — 一步式 zone-aware 跳转 helper，根据当前路径解析匹配的 zone 并导航至该 zone 的登录 URL。选项合约 `LoginWithRedirectOptions` 从 `/web` 子路径导出。如果跳转已发起返回 `true`，如果没有匹配的 zone 则返回 `false`。

**Frontend-oidc 登录跳转：** `FrontendOidcModeClient.loginWithRedirect(options?)` 构建 OIDC 授权 URL（含 PKCE + nonce），存储 pending state 并导航浏览器。选项合约 `FrontendOidcModeLoginWithRedirectOptions` 从 `@securitydept/token-set-context-client/frontend-oidc-mode` 导出。

```ts
import {
	bootstrapBackendOidcModeClient,
	createBackendOidcModeBrowserClient,
	resolveBackendOidcModeAuthorizeUrl,
	resolveBackendOidcModeCallbackFragmentKey,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";

const INTEGRATION_KEY = "my-app:backend-oidc";
const mySessionStore = /* custom session store */ undefined;

const client = createBackendOidcModeBrowserClient({
	baseUrl: "https://auth.example.com",
	defaultPostAuthRedirectUri: window.location.href,
	loginPath: "/auth/token-set/login",     // adopter-specific path override
	persistentStateKey: INTEGRATION_KEY,    // namespaces persisted auth state
	sessionStore: mySessionStore,           // custom session storage
});

// callbackFragmentKey + sessionStore together provide end-to-end fragment isolation
const bootstrap = await bootstrapBackendOidcModeClient(client, {
	sessionStore: mySessionStore,
	callbackFragmentKey: resolveBackendOidcModeCallbackFragmentKey(INTEGRATION_KEY),
});

if (bootstrap.source === "empty") {
	window.location.href = resolveBackendOidcModeAuthorizeUrl(client);
}
```

```ts
import {
	bootstrapBackendOidcModeClient,
	createBackendOidcModeBrowserClient,
	createBackendOidcModeCallbackFragmentStore,
	resolveBackendOidcModeAuthorizeUrl,
	resolveBackendOidcModeCallbackFragmentKey,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";

const INTEGRATION_KEY = "my-app:backend-oidc";

const client = createBackendOidcModeBrowserClient({
	baseUrl: "https://auth.example.com",
	defaultPostAuthRedirectUri: window.location.href,
	// Adopter-specific path overrides (SDK defaults to /auth/oidc/*)
	loginPath: "/auth/token-set/login",
	// Namespaces persisted auth state in localStorage
	persistentStateKey: INTEGRATION_KEY,
});

// Use the matching namespaced fragment key for sessionStorage isolation
const fragmentStore = createBackendOidcModeCallbackFragmentStore({
	key: resolveBackendOidcModeCallbackFragmentKey(INTEGRATION_KEY),
});

const bootstrap = await bootstrapBackendOidcModeClient(client, { callbackFragmentStore: fragmentStore });

if (bootstrap.source === "empty") {
	window.location.href = resolveBackendOidcModeAuthorizeUrl(client);
}
```

#### 3. React 入口：`@securitydept/session-context-client-react` 从 Provider, hook 开始

如果 adopter 想以 React 方式接入 session-context，可从 `SessionContextProvider`, `useSessionPrincipal` 这条最小入口开始；route guard、页面级 UI 与 app glue 仍留在宿主。

```tsx
import {
	SessionContextProvider,
	useSessionPrincipal,
} from "@securitydept/session-context-client-react";

function SessionBadge() {
	const principal = useSessionPrincipal();

	return <output>{principal?.displayName ?? "guest"}</output>;
}

export function App() {
	return (
		<SessionContextProvider
			config={{ baseUrl: "https://auth.example.com" }}
			transport={{
				async execute(request) {
					const response = await fetch(request.url, {
						method: request.method,
						headers: request.headers,
						body: request.body as BodyInit | null,
					});

					return {
						status: response.status,
						headers: Object.fromEntries(response.headers.entries()),
						body: await response.json().catch(() => null),
					};
				},
			}}
		>
			<SessionBadge />
		</SessionContextProvider>
	);
}
```

#### 4. SSR / server-host 入口：dedicated `./server` helpers

在 SSR 或服务端请求处理器（Next.js `getServerSideProps`、Remix `loader`、Astro endpoints、Node request handler 等）中，使用各 auth-context package 的 **`./server` 子路径**。这些 helpers 提供 host-neutral、cookie-aware 的操作，无需浏览器全局变量。

**架构边界：**

| 职责 | 归属 |
|---|---|
| 登录 / 登出 / 跳转 URL 构造 | SDK `./server` helpers |
| 带 cookie 转发的 Session 探测 (`fetchMe`) | SDK `./server` helpers，通过 host 提供的 transport |
| 基于 zone 的 401 → 跳转指令 | SDK `./server` helpers (`handleUnauthorized`) |
| HTTP 响应构造（302、Set-Cookie、body） | Host / 框架 |
| 浏览器导航（`window.location`） | 仅 `/web` 子路径（SSR 中不应导入） |

##### session-context: 登录跳转 + session 探测（推荐 baseline）

```ts
import { createSessionServerHelper } from "@securitydept/session-context-client/server";

const helper = createSessionServerHelper({
	config: { baseUrl: "https://auth.example.com" },
	transport: fetchTransport, // 你的 fetch-based HttpTransport
});

export async function getServerSideProps(context) {
	const session = await helper.fetchMe({
		headers: { cookie: context.req.headers.cookie ?? "" },
	});

	if (!session) {
		return {
			redirect: {
				destination: helper.loginUrl(context.resolvedUrl),
				permanent: false,
			},
		};
	}

	return { props: { user: session.principal } };
}
```

##### basic-auth-context: 基于 zone 的跳转指令（推荐 baseline）

```ts
import { createBasicAuthServerHelper } from "@securitydept/basic-auth-context-client/server";

const helper = createBasicAuthServerHelper({
	config: {
		baseUrl: "https://auth.example.com",
		zones: [{ zonePrefix: "/api" }],
	},
});

export async function handleRequest(request: Request) {
	const url = new URL(request.url);

	// 收到上游 401 后：
	const redirect = helper.handleUnauthorized({ path: url.pathname });
	if (redirect) {
		return Response.redirect(redirect.destination, redirect.statusCode);
	}

	// ...
}
```

##### 低层 escape hatch：root client + 自定义 transport

如果 `./server` helpers 不能覆盖你的场景，仍可直接从 root subpath 导入并手动构造 transport。这是 helper 之前的做法，作为 escape hatch 保留：

```ts
import { SessionContextClient } from "@securitydept/session-context-client";

const sessionClient = new SessionContextClient({
	baseUrl: "https://auth.example.com",
});

// 手动带 cookie 转发的 transport
const ssrTransport = {
	async execute(request) {
		const response = await fetch(request.url, {
			method: request.method,
			headers: { ...request.headers, cookie: incomingCookies },
		});
		return {
			status: response.status,
			headers: Object.fromEntries(response.headers.entries()),
			body: await response.json().catch(() => null),
		};
	},
};

const session = await sessionClient.fetchMe(ssrTransport);
```

> [!IMPORTANT]
> 在 SSR 场景中，请从 `./server`（推荐）或 **根** 子路径导入。**绝不要**从 `/web` 导入 — 它依赖浏览器全局变量（`window.location`），不应在服务端代码中使用。

### Provisional Adapter 维护标准

`./web` 与 `./server` subpath 以及独立框架 adapter 包（`*-react`、`*-angular`）均可用，但仍按比根导出更严格的 `provisional` 标尺维护。Foundation-owned stable 例外（`@securitydept/client/web`、`@securitydept/client/persistence/web`）见 [Capability 清单](#当前-public-contract-与-capability-清单)脚注 ¹。

维护规则：

- 保持边界职责稳定：browser capability 留在 `./web`，React integration 留在专用 `*-react` 包，Angular integration 留在专用 `*-angular` 包，business helper 留在 SDK 之外
- 保持 import-time 行为稳定：不做全局 patch、不偷偷注入 polyfill、导入 adapter 不产生 side effect
- 允许 additive convenience 演进；避免每轮改入口形态迫使使用方重新学习
- 用 reference app dogfooding 加 focused smoke/regression 测试保护 adapter contract，不只靠文档
- 当前最小 evidence 基线：external-consumer scenario、token-set web lifecycle tests、至少一条 React focused test 与 Angular focused test

#### Provisional Adapter 晋升前 Checklist

全部条件满足后方可重新评估晋升到 `stable`：

| 条件 | 判断标准 |
|---|---|
| Capability boundary 已稳定 | 连续多轮迭代与 review 中核心职责没有发生重排或重大扩展 |
| Minimal entry path 已清晰 | 有独立最小进入示例，不依赖阅读完整 reference page |
| Ordinary usage 不依赖 reference-app glue | 标准使用场景可脱离 `apps/webui` 产品级 glue 独立说明 |
| Focused automation 覆盖 adapter lifecycle | 关键 subpath/export 事实以及 adapter 主 lifecycle 有 focused 护栏 |
| Verified environments 已足够清楚 | 宿主能力前提已如实写出，与真实验证粒度一致（见 [Verified Environments](#verified-environments--host-assumptions)） |

#### 当前晋升就绪度（快照，非路线图）

| Adapter | 最强证据 | 当前缺口 |
|---|---|---|
| `token-set-context-client/backend-oidc-mode` | Standalone minimal entry example（`backend-oidc-mode-minimal-entry.test.ts`）、subpath contract test、wrapper contract comparison | 平台中立根入口；browser / React 覆盖通过子路径 / 独立包承载 |
| `token-set-context-client/backend-oidc-mode/web` | Standalone minimal entry example（`backend-oidc-web-minimal-entry.test.ts`）、focused lifecycle tests（callback precedence / recovery、retained JSON body replacement、shared-store fresh-client restore/reset）、popup login baseline、visibility hardening baseline（`visibility-hardening-baseline.test.ts`）、cross-tab sync baseline（`cross-tab-sync-baseline.test.ts`）、reference app dogfooding | 更广泛 browser matrix 与真实下游 adopter 集成仍未验证 |
| `basic-auth-context-client/web` | redirect-contract focused root tests、zone-aware External-consumer scenario、zone-aware standalone minimal entry example、query/hash-bearing browser-route forwarding focused web tests、zone-aware `loginWithRedirect` convenience with named options contract | 更广泛 browser host 语义仍未验证 |
| `basic-auth-context-client-react`（独立包） | dedicated React provider/hook focused test（`adapter.test.ts`）、standalone minimal entry example（`basic-auth-react-minimal-entry.test.ts`）覆盖 provider wiring、hook consumption、zone-aware contract usage | 更广泛 browser host 语义仍未验证 |
| `session-context-client/web` | Standalone minimal entry example（`session-web-minimal-entry.test.ts`）、multi-line convenience baseline（`login-redirect-convenience.test.ts`）、`loginWithRedirect` + 命名 `LoginWithRedirectOptions` | 更广泛 browser host 语义仍未验证 |
| `session-context-client-react`（独立包） | Standalone minimal entry example、dedicated React provider/hook、`SessionContextValue` type exports、refresh/cleanup focused test、StrictMode stale-fetch discard focused test、reconfigure stale-result discard focused test | React 17 / concurrent mode 未验证；更广泛宿主矩阵仍未覆盖 |
| `token-set-context-client-react`（独立包） | Standalone minimal entry example（`backend-oidc-react-minimal-entry.test.ts`）、dedicated React adapter focused test（`adapter.test.ts`）覆盖 signal sync / disposal / StrictMode / reconfigure、subpath contract test | React 17 / concurrent mode 未验证；更广泛宿主矩阵仍未覆盖 |
| `basic-auth-context-client/server` | Standalone minimal entry example（`basic-auth-server-minimal-entry.test.ts`）、shared SSR baseline（`ssr-server-helper-baseline.test.ts`）、dedicated helper focused test | 框架级 server adapter 覆盖（Next.js、Remix 等） |
| `session-context-client/server` | Standalone minimal entry example（`session-server-minimal-entry.test.ts`）、shared SSR baseline（`ssr-server-helper-baseline.test.ts`）、dedicated helper focused test | 框架级 server adapter 覆盖（Next.js、Remix 等） |
| `token-set-context-client/frontend-oidc-mode` | Standalone minimal entry example（`frontend-oidc-minimal-entry.test.ts`）、wrapper contract comparison（`oidc-client-wrapper-contract.test.ts`）、scheduling input source baseline | 真实 OIDC provider 集成与框架级 adapter 验证仍未完成；popup/callback 往返覆盖有限 |
| `token-set-context-client/access-token-substrate` | Standalone minimal entry example（`access-token-substrate-minimal-entry.test.ts`） | 仅 substrate 词汇表；无运行时 propagation 集成测试 |
| `client/auth-coordination` | Requirement planner unit tests（`packages/client/src/auth-coordination/__tests__/requirement-planner.test.ts`）、multi-requirement orchestration example（`examples/multi-requirement-orchestration.test.ts`）、route orchestration baseline（`examples/route-orchestration-baseline.test.ts`）覆盖 matched-route-chain、chooser decisions 与 route transition；TanStack Router adapter（`examples/tanstack-react-router-adapter.test.ts`）、Angular Router adapter（`examples/angular-router-adapter.test.ts`） | 条件流、并行 orchestration 与真实 adopter 端到端校准仍为 open |

## Raw Web Router Baseline（原生 Web 路由基线）

**Subpath**：`@securitydept/client/web-router`（provisional，iteration 110）。

非框架 adopter（原生 TS、Web Components、Lit）也需要与 React / Angular / TanStack 同等地位的安全感知路由。Raw Web Router 是该类宿主的标准答案：一个框架中立、体量极小的路由核心，在原生浏览器导航原语之上叠加 requirement 守卫语义。

设计要点：

- **Navigation API 优先，History API 回退。** `createNavigationAdapter()` 会探测 `window.navigation`：存在时使用 Navigation API 的 `navigate` 事件同步拦截导航意图，并通过 `intercept({ handler })` 在 requirement 评估后提交；不存在时装配一个对 `history.pushState` / `history.replaceState` + `popstate` 的薄包装，提供与前者完全相同的 pre-commit hook 形状。两条路径通过同一套 evidence 套件验证。
- **PlannerHost 是唯一权威。** 路由自身不实现 requirement planning。每一段路由可声明 `requirements?: readonly AuthGuardClientOption[]`（见 `@securitydept/client/auth-coordination`）。每次导航意图时，路由遍历匹配到的 root→leaf `WebRouteDefinition` 链路，调用一次 `extractFullRouteRequirements(chain)` 得到扁平候选列表；仅当列表非空时才 `await plannerHost.evaluate(candidates)`，并根据返回的 `PlannerHostResult` 行动：若 `allAuthenticated` 为 false，则调用 `pendingCandidate.onUnauthenticated()`；返回值为 `true`（放行导航）、`false`（对 intent 调用 `preventDefault` 取消），或 URL 字符串（重定向）。未登录时的行为由**每个候选**自身的 `onUnauthenticated` 决定——`createWebRouter` **没有**顶层的 `onUnauthenticated` 选项。聚合后候选集为空的段会跳过 planner。
- **Adapter 表面。**
  - `createNavigationAdapter(options?)` — 返回带 `kind: "navigation-api" | "history"` 的 `NavigationAdapter`。
  - `isNavigationApiAvailable()` — 能力探测，adopter 可显式断言或降级。
  - `createWebRouter({ navigationAdapter?, plannerHost?, routes?, onNavigate?, defaultComposition? })` — 返回带 `navigate(url)`、`back()`、`forward()`、`match(url)`、`currentMatch()`、`currentUrl()`、`extractRequirements(match)`、`onNavigate(listener)`（返回取消订阅函数）、`addRoute`、`routes()`、`destroy()`，以及 `readonly adapter` 的 `WebRouter`。`navigationAdapter` 可传入已构造的 `NavigationAdapter`，或传给 `createNavigationAdapter()` 的选项对象。
  - `NavigationAdapterKind` — 字符串常量 union，用于 telemetry / 测试。
- **全路径 requirement 聚合。** 路由通过 `WebRouteDefinition.children` 形成树；每一段可声明自己的 `requirements` 与显式 `composition: "inherit" | "merge" | "replace"`（默认 `"merge"`）。每次导航时，路由将匹配到的叶子还原为完整 root→leaf 链路，仅调用一次 `extractFullRouteRequirements(chain)` 合成 effective 候选集，并把这份单一列表交给 `plannerHost.evaluate()`。该契约深度与 Angular `createTokenSetRouteAggregationGuard` / `extractFullRouteRequirements` 对以及 TanStack Router adapter 对齐——非框架 adopter 不再需要手写逐级合并。
- **不绑定框架。** 路由不含任何 React / Angular / TanStack 导入，框架包可以包装它，但它本身独立可用。

最小示例（framework-neutral；与 evidence 测试一致）：

```ts
import { createPlannerHost } from "@securitydept/client/auth-coordination";
import { createNavigationAdapter, createWebRouter } from "@securitydept/client/web-router";

const plannerHost = createPlannerHost();
const navigationAdapter = createNavigationAdapter();
const router = createWebRouter({
  navigationAdapter,
  plannerHost,
  routes: [
    {
      id: "dashboard",
      match: "/dashboard",
      requirements: [
        {
          requirementId: "session",
          requirementKind: "session",
          checkAuthenticated: () => false,
          onUnauthenticated: () => "/login",
        },
      ],
    },
    { id: "public", match: "/public" },
  ],
});

const off = router.onNavigate((commit) => {
  console.log("committed", commit.url.href);
});

await router.navigate("/dashboard");
off();
router.destroy();
```

证据：[`examples/web-router-navigation-api.test.ts`](../../sdks/ts/examples/web-router-navigation-api.test.ts) 与 [`examples/web-router-history-fallback.test.ts`](../../sdks/ts/examples/web-router-history-fallback.test.ts) 同时覆盖两种后端在同一对外契约下的 redirect / block / commit 路径。[`examples/web-router-full-route-aggregation.test.ts`](../../sdks/ts/examples/web-router-full-route-aggregation.test.ts) 在此契约上扩展了嵌套路由证据：`inherit` / `merge` / `replace` 合成、`WebRouteMatch.chain` 暴露完整 root→leaf 链路、以及 `plannerHost.evaluate()` 单次调用即收到完整聚合候选集（嵌套 requirement 失败时阻断导航）。

## Shared Client Lifecycle Contract（共享客户端生命周期契约）

**Subpath**：`@securitydept/token-set-context-client/registry`（provisional，iteration 110）。

Iteration 110 将 framework-neutral 的多客户端管理核心从 Angular adapter 中抽离，使 React 与原生 Web 消费者共享完全一致的 readiness、lifecycle、lookup 语义。Angular 的 `TokenSetAuthRegistry` 现为基于该核心的薄 DI 包装；React 的 `TokenSetAuthProvider` 也直接向该核心注册。

Readiness 状态机（`ClientReadinessState`）：

```
not_initialized --(register primary | preload lazy)--> initializing
initializing    --(factory resolves)----------------> ready
initializing    --(factory rejects)-----------------> failed
failed          --(reset(key))----------------------> not_initialized
```

关键概念：

- **`ClientInitializationPriority`** —— `"primary"`（`register` 时立即物化）与 `"lazy"`（只有在 `whenReady` / `preload` / `idleWarmup` 强制时或某个 requirement 经由该 client 评估时才物化）。默认值为 `"primary"` 以保留 iteration-109 行为。
- **`preload(key)`** —— 强制 lazy client 立即物化，不需要等待 requirement。返回就绪 service 或失败 promise。
- **`whenReady(key)`** —— 等待 `ready`，对 lazy 条目触发 `preload`，对 `failed` 抛错；幂等。
- **`idleWarmup()`** —— 以 `requestIdleCallback`（含 `setTimeout` 回退）为每个 `lazy + not_initialized` 客户端调度 `preload`，返回 `cancel()`。生产 shell 可用它在浏览器 idle 时间分摊 OIDC metadata 拉取。
- **`reset(key)`** —— 拆除 service，状态回到 `not_initialized`，便于在瞬时失败后重新注册。
- **多维度识别。** Registry 以 `urlPatterns`、`callbackPath`、`requirementKind`、`providerFamily` 对 client 建立索引。`clientKeyGenFor*` 为惰性生成器；`clientKeyListFor*` 为对应 snapshot。框架 adapter 在其上叠加宿主语法糖，但永远不重实现索引。

错误形状：`require("missing")` 抛出 `[TokenSetAuthRegistry] No client registered for key "missing" (and ready). Available keys: ...`。尾部的 `(and ready)` 是刻意保留——用于区分「key 从未注册」与「已注册但尚未 ready」，并被 Angular adapter 契约测试校验。

证据：[`examples/multi-client-lazy-init-contract.test.ts`](../../sdks/ts/examples/multi-client-lazy-init-contract.test.ts) 覆盖 `primary | lazy` 区分、`preload`、`whenReady`、`idleWarmup`、失败传播与 `reset`；[`examples/async-client-readiness-contract.test.ts`](../../sdks/ts/examples/async-client-readiness-contract.test.ts) 覆盖异步 factory + 失败语义。

## React Query Integration（React Query 集成）

**Subpath**：`@securitydept/token-set-context-client-react/react-query`（provisional，iteration 110）。

按 iteration-110 管理层裁决，React 生态集成不得以独立包形式存在。React Query 支持以 **subpath** 形式落在 React 主包内，`@tanstack/react-query` 作为 **optional peer dependency** 声明，并在 `devDependencies` 中镜像以保证 subpath 自身能够类型检查。未导入该 subpath 的消费者不承担任何成本。

严格 consumer 定位：

- 该 subpath 是 token-set registry 与 `TokenSetAuthService` readable signal 的 **消费者**，**从不是权威**——这里没有任何 query 驱动的登录、刷新或生命周期改写路径。
- Query 状态从 registry 派生；registry 不从 query 状态派生。
- 运行时如果没有 React Query，消费者只需不导入该 subpath，主包独立可用。

表面：

- `tokenSetQueryKeys` —— 确定性 key factory：`all()`、`forClient(key)`、`readiness(key)`、`authState(key)`。对外导出，adopter 可用来 invalidate 或与自身 key 协同。
- `useTokenSetReadinessQuery(clientKey, options?)` —— 把 `registry.whenReady(clientKey)` 包装成 `useQuery`，返回标准 `UseQueryResult<TokenSetAuthService, Error>`。
- `useTokenSetAuthorizationHeader(clientKey)` —— 返回 `{ enabled: boolean; authorization: string | null }`，派生自客户端 access-token signal，可直接喂给 `fetch` / axios / Query `queryFn` 的 header。
- `invalidateTokenSetQueriesForClient(queryClient, clientKey)` —— `queryClient.invalidateQueries({ queryKey: tokenSetQueryKeys.forClient(key) })` 的薄包装。

最小示例：

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TokenSetAuthProvider } from "@securitydept/token-set-context-client-react";
import {
  useTokenSetReadinessQuery,
  useTokenSetAuthorizationHeader,
} from "@securitydept/token-set-context-client-react/react-query";

function Dashboard() {
  const ready = useTokenSetReadinessQuery("main");
  const header = useTokenSetAuthorizationHeader("main");
  if (ready.status !== "success") return null;
  // header.authorization 可传给其他 query 的 fetch 层。
}
```

证据：[`examples/react-query-integration-evidence.test.ts`](../../sdks/ts/examples/react-query-integration-evidence.test.ts) 证明 subpath 经 vitest alias 正常解析、由 `whenReady()` 驱动 `useQuery`、与 access-token signal 保持镜像、并支持定向 invalidate。

## 示例与参考实现

### 真实参考实现

- `apps/server`
- `apps/webui`

它们应作为第一优先级的 dogfooding / reference app。

当前应明确按如下方式理解：

- `apps/server`：reference server，负责给客户端 SDK 提供真实 auth / forward-auth / propagation 语义
- `apps/webui`：reference app，负责验证真实 read/write/auth lifecycle、trace timeline、以及最小可用 propagation dogfood
- `apps/webui/src/api/*` 中的业务 helper：属于 reference app glue，不属于 SDK public surface
- `apps/webui/src/routes/tokenSet/*`：属于 reference page UI / observability glue，用于解释与回归 SDK 边界，不是 SDK package
- `sdks/ts/packages/test-utils`：属于测试/演示基础设施，不应与 reference app glue 混淆

### 下游参考案例：Outposts

除 `apps/server` 与 `apps/webui` 之外，`~/workspace/outposts` 应被视为一个高价值的下游 adopter 参考案例：

- 它不替代主 reference app / dogfooding 入口
- 它的价值在于验证真实多后端、多 OIDC client、route-level requirement orchestration 场景
- 它更适合指导后续 headless orchestration primitive / scheduler 方向，而不是立即被读成当前已完成能力
- `outposts` 的 Angular 接入应被视为真实 browser OIDC / router 宿主案例，用于校准 SDK 形状
- 但它当前基于 `angular-auth-oidc-client` 的 auth 模块形状带有明显历史过渡痕迹，应被视为迁移样本与宿主约束，而不是 SDK Angular public API 的 source of truth

相关阶段规划见：

- [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md)

### 当前 Bundle / Code Split 判断

- 当前 `/backend-oidc-mode` 页面已经通过局部 route split 收掉最明显的 chunk warning
- 因此 bundle/code split 目前可从“阻塞项”降级为“后续工程议题”
- 如果后续继续推进，更合理的下一步切分点应优先放在其他高密度 reference routes 或 shared UI hot paths，而不是继续围绕同一处 OIDC-mediated 页面做机械拆分
- 在当前阶段，它应让位于 SDK public contract、capability requirement 与边界表达的固化工作

### Demo 与 OIDC Provider

- fake/test 基础设施可复用来构建交互式 demo，例如时间轴与 trace 可视化
- 如果要演示完整 OIDC flow，最好引入可容器化的轻量 demo provider
- 当前更倾向优先使用 Dex 作为 demo OIDC provider
- demo 本身也应支持 Docker / `docker compose`

## 对后续开发者与 AI Agents 的要求

- 不要把客户端 SDK 命名或实现成 `auth-runtime`
- 不要把 platform adapter 反向污染 foundation
- 不要默认引入全局 polyfill 或 import-time side effects
- 不要让 `token-set-context-client` 在第一版无约束地膨胀成包含所有 mixed-custody / BFF 复杂度的单体实现
- 在实现前，优先检查现有 `apps/server` 与 `apps/webui` 是否可以作为真实接入验证目标

[English](../en/007-CLIENT_SDK_GUIDE.md) | [中文](007-CLIENT_SDK_GUIDE.md)
