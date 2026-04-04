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
- 框架适配通过同包 subpath exports 暴露
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

SecurityDept 客户端 SDK 应采用类似 TanStack 的打包风格：

- public 包按能力或 auth-context 拆分
- 默认导出面保持框架无关
- 框架适配通过同包 subpath exports 暴露
- 不额外创建 `@securitydept/react-client` 一类框架聚合包

TypeScript 示例：

- `@securitydept/client`
- `@securitydept/client/react`
- `@securitydept/client/web`
- `@securitydept/client/persistence`
- `@securitydept/client/persistence/web`
- `@securitydept/basic-auth-context-client`
- `@securitydept/basic-auth-context-client/react`
- `@securitydept/basic-auth-context-client/web`
- `@securitydept/session-context-client`
- `@securitydept/session-context-client/react`
- `@securitydept/token-set-context-client/frontend-oidc-mode`
- `@securitydept/token-set-context-client/backend-oidc-pure-mode`
- `@securitydept/token-set-context-client/backend-oidc-mediated-mode`
- `@securitydept/token-set-context-client/backend-oidc-mediated-mode/web`
- `@securitydept/token-set-context-client/backend-oidc-mediated-mode/react`

对于暴露 React 适配器的 npm 包：

- 把 `react` 及相关库放在 `peerDependencies`
- 当基础包无需适配器也能工作时，将这些 peer dependencies 标记为 optional
- 保持根导出不强制依赖具体框架

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
  headers: Record<string, string>
  body?: unknown
}

interface HttpResponse {
  status: number
  headers: Record<string, string>
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
  set(key: string, value: string): Promise<void>
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

### 配置系统

配置系统应采用分层结构，而不是平铺大对象。

推荐分层：

- runtime / foundation config
- auth-context config
- adapter / framework config

示例：

```ts
createBackendOidcMediatedModeClient({
  runtime: {
    transport,
    persistence,
    scheduler,
    clock,
  },
  auth: {
    authorizePath,
    callbackPath,
    refreshPath,
    refreshWindowMs,
  },
})
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
     - 标准后端 OIDC + resource server
     - `token-set-context` 的 sealed + metadata 组合流程

2. **OIDC-mediated 特定 browser adapter**
   - callback fragment 解析
   - sealed + metadata 特定 redirect 流程
   - metadata redemption
   - flow-state / redirect recovery 存储

按这个方向理解，当前最重的客户端模块应覆盖的内容可以拆开阅读：

- **通用 token orchestration 层**
  - token snapshot / delta 合并规则
  - 持久化适配器
  - refresh 调度
  - bearer header 注入辅助
  - refresh 失败恢复策略
- **backend-oidc-mediated browser adapter 层**
  - callback fragment 解析
  - metadata redemption 流程
  - sealed + metadata 相关恢复策略

而不应默认继续承担：

- 多 provider 或多 source 管理
- route-level orchestration
- chooser UI / app policy

这里要额外澄清：上面这组“通用 orchestration 层 + OIDC-mediated 特定 adapter 层”的拆分，只是当前已落地的**共享基础设施 / 特定流程**内部模块边界。对外需要同时读成：

- TS 前端运行时产品面：`token-set-context-client`
- Rust crate public surface：`securitydept-token-set-context`

其中 Rust 侧不应再被读成“只有 `backend` 模块的后端 crate”；更合适的 adopter-facing 结构应直接收口为顶层 `*_mode` 与 shared modules（详见 [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md)）。

#### OIDC Mode Family（替代旧"三驾马车"术语）

当前主术语已切换为统一的 auth context / mode 分层。完整设计见 [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md)。

##### 产品面

| 产品面 / 权威面 | SDK / Crate | 角色 |
|---|---|---|
| **TS 前端运行时面** | `token-set-context-client`（TS） | 所有 OIDC 模式的统一前端 subpath / runtime 入口 |
| **Rust 顶层 mode / shared module public surface** | `securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_pure_mode, backend_oidc_mediated_mode, access_token_substrate, orchestration, models}` | 统一的 mode module + shared module adopter-facing 结构 |
| **Rust ownership boundary（实现层说明）** | mode-specific contract ownership + shared substrate ownership | 解释内部“谁负责什么”，但不再主导一级 public path |

##### 模式总览

| 模式 | 谁运行 OIDC 流程 | TS SDK 子路径 | Rust 侧权威入口 |
|---|---|---|---|
| `frontend-oidc` | 前端（浏览器） | `/frontend-oidc-mode` | `securitydept-token-set-context::frontend_oidc_mode` 应负责配置与 integration contract；当前代码仍有过渡期命名，不是最终 public shape |
| `backend-oidc-pure` | 后端 | `/backend-oidc-pure-mode` | `securitydept-token-set-context::backend_oidc_pure_mode` 应收口 mode entry 与前端可消费 contract |
| `backend-oidc-mediated` | 后端（经中介） | `/backend-oidc-mediated-mode` | `securitydept-token-set-context::backend_oidc_mediated_mode` 应收口 mode entry 与前端可消费 contract |

本节里的 TS 子路径直接采用 canonical mode-aligned naming。  
如果当前实现仍残留旧导出名或旧目录形状，应视为待迁移实现，而不是文档层的最终命名。

##### 基础设施层（内部实现 crate）

以下 crate 是内部实现层，adopter 不需要直接依赖。当前代码里部分能力仍带过渡期 `backend` 聚合痕迹，但从概念上说它们服务于整个 Rust public surface，而不只是某个一级 backend namespace：

| Crate | 职责 |
|---|---|
| `securitydept-oauth-provider` | OIDC discovery、JWKS、metadata 刷新、`OidcSharedConfig` |
| `securitydept-oidc-client` | OIDC 授权码 / 设备流 |
| `securitydept-oauth-resource-server` | JWT 验证、introspection |

#### `frontend-oidc`：前端纯 OIDC 客户端

- 前端通过 `oauth4webapi`（官方基座）处理 authorize/callback/token-exchange
- Rust 后端**不**自己运行 OIDC redirect/callback/token-exchange，但 Rust crate 仍应通过 `securitydept-token-set-context::frontend_oidc_mode` 提供前端可消费配置与 integration contract；当前实现仍有过渡期命名
- `oidc-client-ts` 作为 comparison/reference case（`devDependency` only）

依赖策略：
- `oauth4webapi`：官方基座，`optional peerDependency` + `devDependency`；使用 `/frontend-oidc-mode` 的 adopter 需安装
- `oidc-client-ts`：comparison case，`devDependency` only；不对 adopter 产生安装要求

#### `backend-oidc-mediated`：原 "token-set" 的真正含义

历史上被统称为 "token-set" 的那组能力，在当前结构里需要拆开理解：

- 前端产品面中，对应的前端消费入口直接命名为 `/backend-oidc-mediated-mode`
- Rust crate public surface 中，对应的 mode module 应直接命名为 `securitydept-token-set-context::backend_oidc_mediated_mode`
- 对应的 query / payload / redirect fragment / metadata redemption contract 也应归到这个 mode module 下，而不应长期散落在 crate 根部

真正需要强调的是 `backend-oidc-mediated` 的 mode 边界：

- 后端中介所有 provider 交互，前端不直接接触 provider
- Sealed refresh material（AEAD 加密）、metadata redemption、post-auth redirect 规则
- "token-set"描述的是数据结构名而非操作模式

#### `backend-oidc-pure`：标准后端 OIDC

`backend-oidc-pure` 是另一个正式 mode。后端运行标准 OIDC client + resource server 验证，前端接收不透明 session、token，或协议无关 material。前端产品面上的 canonical 入口应直接命名为 `/backend-oidc-pure-mode`；Rust crate 侧的 canonical module 则应为 `securitydept-token-set-context::backend_oidc_pure_mode`。即使初始实现只是薄的 config / guard / transport projection，也不应继续缺席或留在 app glue。

#### 共享配置模型

`oidc-client` 与 `oauth-resource-server` 通过 `OidcSharedConfig`（`securitydept-oauth-provider`）共享 provider 连接性配置。更准确地说，`OidcSharedConfig` 应被读成整个 Rust crate public surface 的共享 OIDC 配置权威，而不是某个 `backend` 一级命名空间的内部细节，详见 [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md) 中 `token-set-context` 一节。

#### Rust 权威面当前 gap

当前实现里最不和谐的地方不是“命名不够好看”，而是 public surface 还没收透：

- `securitydept-token-set-context` 当前代码仍带着过渡期 `frontend` / `backend` 一级模块形状
- 但 canonical public API 更适合直接收口到顶层 `frontend_oidc_mode`、`backend_oidc_pure_mode`、`backend_oidc_mediated_mode`、`access_token_substrate`、`orchestration`、`models`
- `frontend-oidc` 的配置规则、它与 `access_token_substrate` 对接所需的 integration contract、以及 `backend-oidc-mediated` 的前端可消费 query / payload / fragment / redemption contract，本质上都属于这些顶层 mode/shared modules 的职责
- `metadata_redemption`、`BackendOidcMediatedModeRuntime`、refresh material、redirect resolver 等 mediated-specific 材料，本质上属于 `backend-oidc-mediated` runtime domain，不应继续被误读成 generic crate-root capability
- `resource-server` 消费的 access-token contract、`propagation`、`forwarder` 则不应再被绑死在 `backend-oidc-mediated`；它们只依赖 access token 与 `X-SecurityDept-Propagation`，应提升为顶层 shared module `access_token_substrate`

所以当前更准确的结论是：

- Rust 顶层 mode/shared module public surface：目标已明确，但代码仍在过渡期
- `frontend_oidc_mode` 不再只是 config producer，还必须承接 frontend-oidc 与 `access_token_substrate` 对接所需的 integration contract
- crate 根：仍保留历史扁平导出，是待收口的实现形状，不是最终概念模型

#### 跨模式约束

- OIDC mode family 三个模式属于同一认证栈，前端通过 `token-set-context-client` 进入，后端通过 `securitydept-token-set-context` 进入
- TS 前端产品面应有三个 formal mode-aligned 子路径：`/frontend-oidc-mode`、`/backend-oidc-pure-mode`、`/backend-oidc-mediated-mode`
- `/orchestration` 是共享基础设施层，不是任一模式的完整替代
- 不同模式应复用同一套 token lifecycle、persistence、transport 语义
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

- 这是一个高价值的下游参考案例方向，有助于指导整个认证栈（前端 `token-set-context-client` + 后端 `securitydept-token-set-context`）的后续设计
- 但它**不属于当前 v1 已验证 contract**

## 服务端支持

服务端支持不应被理解为“再做一套服务端版客户端 SDK 核心”，而应建立在同一套 portable capability 之上。

前端 `token-set-context-client` 中的 orchestration / lifecycle 基座（token snapshot、persistence、transport projection）设计为跨模式共享基础设施。Rust `securitydept-token-set-context` 更适合收口为：

- `frontend_oidc_mode`
- `backend_oidc_pure_mode`
- `backend_oidc_mediated_mode`
- `access_token_substrate`
- `orchestration`
- `models`

其中各 `*_mode` module 负责各自 mode 的 config / contract / runtime entry，`access_token_substrate` 负责 resource-server / propagation / forwarder 一类 shared runtime substrate，`orchestration` 与 `models` 只承载 truly shared abstraction。

### `basic-auth-context` / `session-context`

应支持 redirect-aware SSR / server request handling。

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

- 尽量保留服务端返回的 `error: { code, message, recovery }`
- `code` 是跨端稳定契约，`message` 不是
- 对这类高频、稳定、可判别的字符串域，优先使用导出的 `const object + type alias`，例如 `UserRecovery`、`ClientErrorKind`、`AuthGuardResultKind`、`BackendOidcMediatedModeBootstrapSource`，而不是裸字符串 union 或 TypeScript `enum`
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
| `@securitydept/basic-auth-context-client` | `stable` | 不要求 React；redirect convenience 留在 `./web` | Basic-auth 根 contract |
| `@securitydept/basic-auth-context-client/web` | `provisional` | `location` / redirect 语义 | Auth-context browser adapter |
| `@securitydept/basic-auth-context-client/react` | `provisional` | React runtime | React adapter |
| `@securitydept/session-context-client` | `stable` | Transport / cancellation；登录跳转流程不属于 SDK surface | Session 根 contract |
| `@securitydept/session-context-client/react` | `provisional` | React runtime | React adapter |
| `@securitydept/token-set-context-client/backend-oidc-mediated-mode` | `stable` ² | Callback / restore / refresh / persistence / traceSink | 前端消费 `backend-oidc-mediated` 的 **canonical 入口** |
| `@securitydept/token-set-context-client/backend-oidc-mediated-mode/web` | `provisional` | `location` / `history` / `fetch` / flow-state storage | 前端消费 `backend-oidc-mediated` 的 browser adapter canonical 子路径 |
| `@securitydept/token-set-context-client/backend-oidc-mediated-mode/react` | `provisional` | React runtime | 前端消费 `backend-oidc-mediated` 的 React adapter canonical 子路径 |
| `@securitydept/token-set-context-client/orchestration` | `provisional` ³ | 不感知 backend-oidc-mediated sealed flow；协议无关 token snapshot / persistence / transport / `AuthMaterialController` 薄控制层 | Shared token lifecycle substrate **显式子路径入口**（推荐的协议无关基座；不是完整模式/流程入口） |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | `experimental` ⁴ | 前端纯 OIDC client（`frontend-oidc` 模式）；基于 `oauth4webapi`，不引入 `oidc-client-ts`；normalize token material 给 `/orchestration` | `frontend-oidc` **mode-aligned 显式子路径入口** |
| `@securitydept/token-set-context-client/backend-oidc-pure-mode` | `experimental` ⁵ | Opaque session / requirement / config projection / thin transport contract；前端消费 `backend-oidc-pure` mode，不自行运行 provider flow | `backend-oidc-pure` **mode-aligned 显式子路径入口**（即使实现很薄，也不再缺席） |
| `@securitydept/test-utils` | `experimental` | Fake clock / scheduler / transport / trace collector | 测试/演示基础设施 |

¹ Adapter subpath 默认 `provisional`，但 `@securitydept/client/web` 与 `@securitydept/client/persistence/web` 是刻意保留的 `stable` 例外：职责窄、无产品语义、只把 foundation protocol 接到宿主能力上。

² 此 `stable` 覆盖 `/backend-oidc-mediated-mode` 这一前端消费 `backend-oidc-mediated` 的 canonical 子路径。Root entry (`.`) 及旧 `./web` / `./react` bridge 已移除，不再存在于 package exports 中。Mixed-custody / BFF / server-side mediated token ownership 不在承诺范围内。

³ orchestration 能力通过 `@securitydept/token-set-context-client/orchestration` 显式子路径对外暴露，承载在同一 npm 包内，未独立成新包。外部 adopter 可使用 `AuthMaterialController`（薄控制层）及其 `applyDelta()` 外部驱动更新入口，或直接使用底层 helper（`bearerHeader`, `createAuthStatePersistence`, `createAuthorizedTransport` 等）。控制层仅承接 token material lifecycle，不提供 acquisition / redirect / refresh scheduling 能力。它本身不是完整模式或完整 flow 入口，而是前端产品面内部的共享 token lifecycle 基座，供 `/backend-oidc-mediated-mode` 与 `/frontend-oidc-mode` 等子路径复用，并与更高层的 auth context / mode 分层设计保持一致。官方前端 OIDC 封装使用 `oauth4webapi`，`oidc-client-ts` 为 comparison case（详见 [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md)）。稳定性仍属冻结进行中（`provisional`）：已公开、有显式入口，但不是完整 `stable` 承诺。

⁴ `/frontend-oidc-mode` 子路径实现 `frontend-oidc` 模式，以 `oauth4webapi` 为基座。当前为 `experimental`：已有显式入口和 normalize 逻辑，但 runtime surface 尚未完整冻结。使用 `/frontend-oidc-mode` 的 adopter 需安装 `oauth4webapi`（`optional peerDependency`）。

⁵ `/backend-oidc-pure-mode` 是 `backend-oidc-pure` 的 formal frontend-facing 子路径。它的初始实现可以是薄的 config-first / guard-first / transport-contract surface，但文档与导出层不再接受“pure mode 没有前端入口”这一叙事。
统一解释：

- `stable`：当前已可作为 0.x 外部 contract 直接解释
- `provisional`：公开可用，但仍按更严格的 adapter 冻结标准维护
- `experimental`：主要服务测试/demo/workbench，而不是 adopter-facing contract
- 自动化当前锁住 export map、`sideEffects: false` 与构建 entry 对齐；稳定性标签本身仍是文档层判断

#### token-set-context-client Subpath Family 阅读方式

把 `@securitydept/token-set-context-client` 先读成**前端产品面**，再读它内部的 subpath family：

- root (`.`) 及旧 `./web` / `./react` bridge 已移除，不再存在于 package exports 中
- `/backend-oidc-mediated-mode*` 是前端消费 `backend-oidc-mediated` 的显式 family
- `/backend-oidc-pure-mode` 是前端消费 `backend-oidc-pure` 的显式子路径，即使表面很薄
- `/frontend-oidc-mode` 是 `frontend-oidc` 的 mode-aligned 前端实现子路径
- `/orchestration` 是共享 token lifecycle substrate，不是完整模式或完整 flow
- mode family 是跨前后端设计层；subpath family 是前端产品面内部导出层，二者不是同一维度
- Rust 侧也应采用顶层 `*_mode` / shared module 结构；TS subpath family 与 Rust crate public modules 都应服务同一套 mode / shared 边界

#### Capability Boundary Rules

用下面这些规则快速回答"某个能力到底在哪一层"，不必反复读完整指南：

- **redirect / location / history** → `./web` subpath 或 app glue，不回流到 foundation 根导出
- **fetch / AbortSignal** → foundation transport 可表达取消；browser convenience 继续属于 `./web`
- **persistence / web storage** → protocol 与 codec 属于 foundation；`localStorage` / `sessionStorage` 适配属于 `persistence/web`
- **React state / subscription** → `./react` subpath，不与根导出混同
- **traceSink / lifecycle trace** → SDK contract
- **trace timeline UI / DOM harness / propagation probe / business helper** → reference app glue，不属于 SDK surface

#### token-set-context-client 前端 subpath / abstraction split（进行中）

基于当前 `outposts` 单 provider / 单 app 接入 `oauth-resource-server` 的经验，`token-set-context-client` 内部已引入更清晰的模块边界：

- **通用 token orchestration**（`src/orchestration/`）
  - 管 `access_token` / `id_token` / `refresh_token` 的组合状态
  - 管 restore / refresh / persistence / disposal / transport projection
  - 不要求知道 token 的来源是标准 OIDC、后端 OIDC 还是 backend-oidc-mediated sealed flow
- **backend-oidc-mediated browser adapter**
  - 管 callback fragment、sealed payload、metadata redemption、redirect recovery
  - 这一层才感知 OIDC-mediated 的特定协议形状

当前已落地的最小内部模块切片：

| 内部模块 | 内容 |
|---|---|
| `orchestration/types.ts` | `TokenSnapshot`, `TokenDelta`, `AuthSnapshot`, `AuthPrincipal`, `AuthSource` 等协议无关类型 |
| `orchestration/token-ops.ts` | `mergeTokenDelta()`, `bearerHeader()` |
| `orchestration/persistence.ts` | `createAuthStatePersistence()` |
| `orchestration/auth-transport.ts` | `createAuthorizedTransport()` |
| `frontend-oidc-mode/types.ts` | `FrontendOidcModeClientConfig` / `FrontendOidcModeTokenResult` / `FrontendOidcModeAuthorizeResult` — 前端 pure OIDC client 配置与协议词汇 |
| `frontend-oidc-mode/client.ts` | `createFrontendOidcModeClient()` — 封装 oauth4webapi 的标准 browser OIDC Authorization Code + PKCE 流程 |
| `orchestration/controller.ts` | `AuthMaterialController` / `createAuthMaterialController()` — 薄控制层，组合 snapshot read/write + persistence + bearer + transport；提供 `applyDelta()` 外部驱动 renew/update 入口 |

现有 v1 类型（`AuthTokenSnapshot`, `AuthStateSnapshot` 等）是对 orchestration 类型的 re-export alias，完全向后兼容。

当前状态说明：

- 这些 orchestration exports 现在是**已公开的 additive exports**，不是 purely internal-only
- 它们仍承载在 `@securitydept/token-set-context-client` 包内，**不是**独立 npm 包
- 外部 adopter 可以使用这些 exports 组合通用 token orchestration 能力（见 `examples/token-orchestration-contract.test.ts`）
- `backend-oidc-pure` 的前端投影也应补齐为 `backend-oidc-pure-mode` family，而不是继续作为“无入口”的例外
- v1 public surface（`BackendOidcMediatedModeClient`、`./backend-oidc-mediated-mode/web`、`./backend-oidc-mediated-mode/react`）已收口到 canonical 子路径
- `@securitydept/token-set-context-client/orchestration` 已成为**显式子路径入口**，推荐协议无关场景优先从此进入
- `/orchestration` 子路径是协议无关 orchestration exports 的唯一入口（root bridge 已移除）
- `AuthMaterialController`（`createAuthMaterialController()`）是本层的薄控制层入口，组合了 snapshot read/write、bearer projection、persistence restore/save/clear 与 authorized transport 四件套
- `AuthMaterialController.applyDelta()` 是外部驱动 renew/update 的协议无关入口：
  - 接受 `TokenDelta`（只含变化的字段），内部调用 `mergeTokenDelta()` 合并
  - 不提供 `metadata` 时自动保留当前 metadata（刷新不改变 principal）
  - 提供 `options.metadata` 时替换（重新认证、source 变化等场景）
  - 自动 save merged snapshot 到 persistence（与 `applySnapshot` 一致）
  - 如无现有 snapshot 则抛出错误（需先调用 `applySnapshot` 建立初始状态）
- `BackendOidcMediatedModeClient` 内部已进一步建立在控制层之上：
  - `restoreState()` / `clearState()` / `restorePersistedState()` 通过控制层完成
  - `authorizationHeader()` 由控制层直接返回
  - `refresh()` 成功路径通过 `_authMaterial.applyDelta()` 完成 token 合并 + persistence save
  - `createBackendOidcMediatedModeAuthorizedTransport()` 内部委托到 `createAuthorizedTransport()`
- 但 `/orchestration` 不应再被继续单独抽象推演成最终前端 OIDC 方案；下一阶段应直接用 `oauth4webapi`、`oidc-client-ts` 与未来 `angular-auth-oidc-client` 三组现实案例来校准 `frontend-oidc` 模式的前端实现
- 当前规划中的官方 `frontend-oidc` 前端实现，仍位于 `token-set-context-client` 内部（`/frontend-oidc-mode` 子路径），以封装 `oauth4webapi` 为基座，复用同包内的 orchestration 基础设施。对应的 `backend-oidc-pure` / `backend-oidc-mediated` 前端消费入口则应分别收口到 `/backend-oidc-pure-mode` 与 `/backend-oidc-mediated-mode`
- 当前默认预期是沿同一包内的 subpath / additive surface 继续演进，而不是先把它拆成并列新包
- 当前前端 public surface 应按 exact mode-aligned canonical subpath family 理解，而不再依赖 root bridge：
- `/backend-oidc-mediated-mode` — 前端消费 `backend-oidc-mediated` 的 canonical 子路径（`stable` v1）
- `/backend-oidc-mediated-mode/web` — backend-oidc-mediated mode browser adapter 子路径（`provisional`，稳定性待专项 evidence 提升）
- `/backend-oidc-mediated-mode/react` — backend-oidc-mediated mode React adapter 子路径（`provisional`，稳定性待专项 evidence 提升）
- `/orchestration` — 共享 protocol-agnostic token lifecycle substrate，供 `/backend-oidc-mediated-mode` 与 `/frontend-oidc-mode` 复用（`provisional`）
- `/frontend-oidc-mode` — `frontend-oidc` 的 mode-aligned 前端子路径，封装 oauth4webapi（`experimental`）
- `/backend-oidc-pure-mode` — 前端消费 `backend-oidc-pure` 的显式子路径；初始实现可保持 thin/config-first（`experimental`）
- root (`.`) 及旧 `./web` / `./react` bridge 已移除，canonical 子路径家族是唯一对外 public surface
- Rust 侧的 `securitydept-token-set-context` 仍需把当前过渡期 `frontend` / `backend` 形状收口为顶层 `*_mode` / shared modules，承接前端可消费配置、跨边界 contract 与 shared substrate
- 依赖语义：
  - `oauth4webapi` = 官方基座，`optional peerDependency` + `devDependency`
  - `oidc-client-ts` = comparison/reference case，`devDependency` only


### token-set-context-client v1 Scope Baseline

`@securitydept/token-set-context-client` 当前应按冻结中的 browser-owned v1 baseline 理解，而不是把所有未来 custody 模型都读进来。

| 在 v1 scope 内 | 不在 v1 scope 内 |
|---|---|
| browser-owned `backend-oidc-mediated` consumption | mixed-custody token family 管理 |
| callback fragment parsing + metadata redemption | stateful BFF token ownership |
| in-memory auth state signal | server-side mediated token ownership / SSR token store |
| persisted restore + explicit clear | cross-tab sync / visibility re-check 等更大 browser lifecycle hardening |
| refresh-token-driven refresh | 多 provider orchestration / token family policy |
| bearer authorization header projection | product-specific resource helpers / propagation probe / trace timeline UI |
| `createBackendOidcMediatedModeAuthorizedTransport()` 等 token-snapshot transport convenience |  |
| `./web` browser bootstrap / callback fragment capture / reset helpers |  |
| `./react` 最小 integration |  |

这些主题继续留在 v1 之外，是因为：

- mixed-custody / BFF / server-side mediated token ownership 会实质改变 ownership model
- 更大的 browser lifecycle hardening 属于后续 adapter hardening，而不是第一版 root-contract freeze
- app-specific helper 与 probe 依赖 reference app API 形状和产品模型，留在 `apps/webui` 才能保持 SDK surface 清晰

### Adopter 使用清单

本节只回答外部 adopter 最关心的问题：我能不能用、该从哪一层开始、哪些东西不要误读成 SDK surface。

| 如果你需要... | 当前应这样理解 | 不要这样假设 |
|---|---|---|
| Browser App / SPA 消费 `backend-oidc-mediated` | 用 `@securitydept/token-set-context-client/backend-oidc-mediated-mode` canonical 入口；browser bootstrap / callback / storage 走 `./backend-oidc-mediated-mode/web` | timeline UI、propagation probe、`apps/webui/src/api/*` 是 SDK surface |
| 前端消费 `backend-oidc-pure` | 用 `@securitydept/token-set-context-client/backend-oidc-pure-mode` 进入前端可消费 config / requirement / transport contract | 所有 related flow 仍都只能留在 app glue |
| React integration | 用 `@securitydept/*/react` 做最小 Provider + hook integration；`session-context-client/react` 可直接从下方 React 入口片段开始 | route guard、pending redirect UI、reference page interaction form 属于 adapter contract |
| browser-owned baseline 之外的 mediated token ownership | 立即按“超出 v1 scope”处理 | mixed-custody / BFF / SSR token store 已经内建支持 |

#### 不应被当作 SDK Surface 的内容

| 内容 | 应在哪里 | 原因 |
|---|---|---|
| `apps/webui/src/api/*` 业务 helper | reference app | 依赖 reference app API 形状与产品模型 |
| trace timeline UI / DOM harness | reference app | 调试/演示 glue，非外部 contract |
| propagation smoke / same-server probe | reference app + server config | 依赖产品路由与服务配置 |
| SSR session redirect glue（完整版） | app/server 层 | 框架 response 边界属于 app |
| cross-tab sync / visibility lifecycle | 超出 v1 scope | 后续 adapter hardening 主题 |

#### 开始接入前的确认清单

- 你的运行环境具备 `fetch` / `AbortSignal`
- 你的存储需求可由 `localStorage` / `sessionStorage` 满足，或已准备好注入自定义 store
- 你已理解 `./web` 与 `./react` subpath 仍是 `provisional`
- 你不期望 SDK 吸收 route guard / 登录跳转 / timeline UI 等产品级关注点
- 如果用 React，你准备由宿主显式提供 transport / scheduler / clock

### Verified Environments / Host Assumptions

这里的“当前已验证”指能力前提 + 测试环境粒度，不是品牌浏览器兼容矩阵。

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

#### 2. Browser 入口：`./backend-oidc-mediated-mode/web` 负责 browser glue

当宿主希望直接使用浏览器侧的 `fetch`、storage flow-state 与 callback bootstrap helper 时，优先从 `./backend-oidc-mediated-mode/web` 进入。

```ts
import {
	bootstrapBackendOidcMediatedModeClient,
	createBackendOidcMediatedModeBrowserClient,
	resolveBackendOidcMediatedModeAuthorizeUrl,
} from "@securitydept/token-set-context-client/backend-oidc-mediated-mode/web";

const client = createBackendOidcMediatedModeBrowserClient({
	baseUrl: "https://auth.example.com",
	defaultPostAuthRedirectUri: window.location.href,
});

const bootstrap = await bootstrapBackendOidcMediatedModeClient(client);

if (bootstrap.source === "empty") {
	window.location.href = resolveBackendOidcMediatedModeAuthorizeUrl(client);
}
```

#### 3. React 入口：`session-context-client/react` 从 Provider + hook 开始

如果 adopter 想以 React 方式接入 session-context，可从 `SessionContextProvider` + `useSessionPrincipal` 这条最小入口开始；route guard、页面级 UI 与 app glue 仍留在宿主。

```tsx
import {
	SessionContextProvider,
	useSessionPrincipal,
} from "@securitydept/session-context-client/react";

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
						body: request.body,
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

#### 4. SSR redirect 入口：继续属于 app/server glue

SSR redirect 处理目前仍属于 app/server 层。SDK 可以帮助构造 redirect URL，但不会隐藏框架自己的 response 边界。

```ts
import { SessionContextClient } from "@securitydept/session-context-client";

const sessionClient = new SessionContextClient({
	baseUrl: "https://auth.example.com",
});

export async function loader(request: Request) {
	const url = new URL(request.url);
	const returnTo = `${url.origin}${url.pathname}${url.search}`;

	return Response.redirect(sessionClient.loginUrl(returnTo), 302);
}
```

### Provisional Adapter 维护标准

Auth-context `./web` 与 `./react` subpath 已可用，但仍按比根导出更严格的 `provisional` 标尺维护。Foundation-owned stable 例外（`@securitydept/client/web`、`@securitydept/client/persistence/web`）见 [Capability 清单](#当前-public-contract-与-capability-清单)脚注 ¹。

维护规则：

- 保持 subpath 职责稳定：browser capability 留在 `./web`，React integration 留在 `./react`，business helper 留在 SDK 之外
- 保持 import-time 行为稳定：不做全局 patch、不偷偷注入 polyfill、导入 adapter 不产生 side effect
- 允许 additive convenience 演进；避免每轮改入口形态迫使使用方重新学习
- 用 reference app dogfooding 加 focused smoke/regression 测试保护 adapter contract，不只靠文档
- 当前最小 evidence 基线：external-consumer scenario、token-set web lifecycle tests、至少一条 token-set React focused test

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
| `token-set-context-client/backend-oidc-mediated-mode/web` | Focused lifecycle tests（覆盖 callback precedence / recovery、retained-fragment replacement / reset-to-empty transition、shared-store fresh-client restore/reset）、reference app dogfooding、最小入口示例 | 更大范围 browser lifecycle hardening（cross-tab sync 等） |
| `token-set-context-client/backend-oidc-mediated-mode/react` | 最小 React focused test、入口示例、StrictMode remount/disposal focused test、reconfigure dispose/subscription-isolation focused test | React 17 / concurrent mode 未验证；更广泛宿主矩阵仍未覆盖 |
| `basic-auth-context-client/web` + `/react` | redirect-contract focused root tests、zone-aware External-consumer scenario、zone-aware standalone minimal entry example、query/hash-bearing browser-route forwarding focused web tests、dedicated React provider/hook focused test | 更广泛 browser host 语义仍未验证 |
| `session-context-client/react` | Standalone minimal entry example、dedicated React provider/hook、refresh/cleanup focused test、StrictMode stale-fetch discard focused test、reconfigure stale-result discard focused test | React 17 / concurrent mode 未验证；更广泛宿主矩阵仍未覆盖 |

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
- 未来 `outposts` 的 Angular 改造及 `angular-auth-oidc-client` 接入，应被视为第三组现实 browser OIDC 案例，用于校准 SDK 形状，而不是项目内偶发实现细节

相关阶段规划见：

- [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md)

### 当前 Bundle / Code Split 判断

- 当前 `/backend-oidc-mediated-mode` 页面已经通过局部 route split 收掉最明显的 chunk warning
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
