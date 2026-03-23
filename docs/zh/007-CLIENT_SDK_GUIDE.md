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
- `@securitydept/token-set-context-client`
- `@securitydept/token-set-context-client/react`

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
createTokenSetContextClient({
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

这是预计最重的客户端 SDK 模块，应负责：

- callback fragment 解析
- token snapshot / delta 合并规则
- metadata redemption 流程
- 持久化适配器
- refresh 调度
- 多 provider 或多 source 管理
- bearer header 注入辅助
- refresh / redemption 失败恢复策略

#### Mixed-Custody 与 BFF 边界

必须考虑 mixed-custody：

- `browser-owned token family`
- `bff-owned token family`

同一 token family 不应由浏览器与 BFF 双权威维护。  
Mixed-custody 应被写入设计，但当前应明确标注为：

- 重要边界
- 高复杂度
- 第一版暂不实现完整能力

## 服务端支持

服务端支持不应被理解为“再做一套服务端版客户端 SDK 核心”，而应建立在同一套 portable capability 之上。

### `basic-auth-context` / `session-context`

应支持 redirect-aware SSR / server request handling。

核心不是浏览器导航，而是中性的 redirect instruction：

```ts
type AuthGuardResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "redirect"; status: 302 | 303 | 307; location: string }
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
type UserRecovery =
  | "none"
  | "retry"
  | "restart_flow"
  | "reauthenticate"
  | "contact_support"

interface ErrorPresentation {
  code: string
  message: string
  recovery: UserRecovery
}
```

当前原则：

- 尽量保留服务端返回的 `error: { code, message, recovery }`
- `code` 是跨端稳定契约，`message` 不是
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

## 示例与参考实现

### 真实参考实现

- `apps/server`
- `apps/webui`

它们应作为第一优先级的 dogfooding / reference app。

### 最小示例

仍应补充更小的最小示例，用于隔离验证：

- foundation
- web adapter
- React adapter
- SSR redirect

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
