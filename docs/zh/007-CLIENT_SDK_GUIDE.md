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

## Rust / Server Diagnosis Baseline

当前 Rust / server auth-flow diagnosis baseline 的权威 owner 是共享的 `securitydept-utils::observability` contract。

当前已稳定的 vocabulary：

- `AuthFlowDiagnosis`
- `AuthFlowDiagnosisOutcome`
- `DiagnosedResult<T, E>`
- `AuthFlowOperation`
- `AuthFlowDiagnosisField`

当前已经进入真实服务端 auth path 的 operation name：

- `projection.config_fetch`
- `oidc.callback`
- `oidc.token_refresh`
- `propagation.forward`
- `forward_auth.check`
- `session.login`
- `session.logout`
- `session.user_info`
- `basic_auth.login`
- `basic_auth.logout`
- `basic_auth.authorize`
- `dashboard_auth.check`
- `creds_manage.group.list`
- `creds_manage.group.get`
- `creds_manage.group.create`
- `creds_manage.group.update`
- `creds_manage.group.delete`
- `creds_manage.entry.list`
- `creds_manage.entry.get`
- `creds_manage.entry.create_basic`
- `creds_manage.entry.create_token`
- `creds_manage.entry.update`
- `creds_manage.entry.delete`

当前 owner boundary：

- `securitydept-utils` 拥有共享 machine-readable diagnosis contract
- `securitydept-token-set-context`、`securitydept-oidc-client`、`securitydept-session-context` 在各自 auth-flow 上消费这条 contract
- `apps/server` 是记录并暴露这些 diagnosed result 的 HTTP boundary，不是 vocabulary owner

当前已完成产品化的部分：

- frontend-mode config projection 现在直接返回可供 focused Rust tests 断言的 machine-readable diagnosis surface
- callback / token refresh diagnosis 已在 OIDC client 层共享，并被 session 与 backend-oidc server path 消费
- forward-auth 与 propagation 现在会输出稳定的 `operation` / `outcome` / 关键字段 diagnosis record，而不再只剩人类阅读的 route log
- session-context login / logout / user-info 现在也会输出由 `securitydept-session-context` 拥有、并被 `apps/server` 直接消费的稳定 diagnosed result
- basic-auth login / logout / authorize 现在也会输出由 `securitydept-basic-auth-context` 拥有的稳定 diagnosed result；与此同时，protocol-specific response 语义仍由 Basic Auth context 自己继续拥有
- `apps/server` 现在拥有一层薄的 route diagnosis logging adapter，使 middleware 与 auth route 统一输出 `operation` / `outcome` / `diagnosis` 形状，而不再继续漂移出 route-local `tracing` 字段
- dashboard auth boundary diagnosis 现在已通过共享的 `dashboard_auth.check` vocabulary 覆盖 bearer accepted、bearer rejected/failed、session-cookie accepted/rejected、basic-auth accepted/rejected、propagation disabled、propagation auth mismatch，以及 no accepted auth method 等分支
- credential-management route 现在已为 groups 与 entries 的 list/get/create/update/delete 输出 route-level diagnosis，包含 target id 与计数字段，同时显式排除 password、token value、Authorization header、cookie 与 raw session content

当前仍未产品化的部分：

- 当前 auth boundary 与 credential-management path 之外的更广泛 route coverage
- 完整 timeline/exporter/OTel pipeline
- 把所有 plain `tracing` log 全量替换为 diagnosed surface

## Rust / Server Error Baseline

当前 Rust / server dual-layer HTTP error baseline 的权威 owner 是共享的 `securitydept-utils::error` contract。

当前 shared server error contract 包括：

- `ErrorPresentation`
- `UserRecovery`
- `ServerErrorKind`
- `ServerErrorDescriptor`
- `ServerErrorEnvelope`

当前边界分层：

- diagnosis 继续回答“发生了什么”，owner 是 `securitydept-utils::observability`
- server error envelope 回答“宿主/客户端应如何理解与恢复 HTTP failure”，owner 是 `securitydept-utils::error`
- `apps/server` 负责把 `ServerError` 映射到 shared server error envelope，但不拥有 envelope schema 本身

当前已产品化的 route/path coverage：

- frontend-mode projection failure 现在通过 shared `ServerErrorEnvelope` 对外返回
- session callback failure 现在通过 shared `ServerErrorEnvelope` 对外返回
- backend-mode callback / refresh failure 现在通过 shared `ServerErrorEnvelope` 对外返回
- dashboard propagation auth boundary failure（`propagation_auth_method_mismatch`、`propagation_disabled`）现在也通过 shared `ServerErrorEnvelope` 对外返回，而不再停留在 route-local JSON

当前 envelope 保证：

- 稳定的 machine-facing `kind` 与 `code`
- 稳定的 recovery vocabulary
- 与 machine-facing 字段并存的 host-facing `presentation` descriptor
- 对仍直接读取 `error.code` / `error.message` / `error.recovery` 的 consumer 保持兼容

当前 browser/server symmetry 证据：

- `apps/webui` 的 frontend-mode config projection fetch 现在会把结构化 server envelope 保留为 `ClientError`，不再塌缩成 app-local `Error` 字符串
- `apps/webui` 的 dashboard API client 现在通过 `ClientError.fromHttpResponse()` 消费结构化 auth envelope，而不再做 app-local status/message 解析
- reference app 现在已经有两条 focused 证据，直接证明 `ServerErrorEnvelope -> ClientError -> readErrorPresentationDescriptor()`：一条是 frontend-mode config path，一条是 dashboard auth-boundary path

当前仍未产品化的部分：

- 不经过 `ServerError` 的 route-local status/message
- 带有 `WWW-Authenticate` / logout poison 语义的 Basic Auth protocol response 仍是显式 plain-status 特例，尚未进入 shared envelope baseline
- 完整 RFC 7807/problem-details 平台
- 把所有 browser/server error schema 做成完全统一的跨语言大 contract

## Protocol-Specific Auth Exception Baseline

当前 Basic Auth protocol-specific exception baseline 的权威 owner 是 `securitydept-basic-auth-context`。

当前 protocol-specific contract：

- `BasicAuthProtocolResponseKind`
- `BasicAuthProtocolResponse`
- `BasicAuthZone::login_challenge_protocol_response()`
- `BasicAuthZone::logout_poison_protocol_response()`
- `BasicAuthZone::unauthorized_protocol_response_for_path()`

当前边界分层：

- `securitydept-utils::error` 继续拥有普通 HTTP failure 的 shared server error envelope baseline
- `securitydept-basic-auth-context` 拥有必须保留 RFC 7235 challenge 语义或 poison/logout 语义的 Basic Auth response
- `apps/server` 与 browser consumer 应把这些 path 当作 protocol-specific exception，而不是尝试把它们解析成 `ServerErrorEnvelope`

当前已产品化的 path coverage：

- 显式 `/basic/login` challenge path 现在通过共享的 Basic Auth protocol-response owner 生成，而不再靠 route-local response 拼装
- `/basic/logout` poison path 现在也通过同一 owner 生成，而不再只是 route-local plain `401`
- Basic Auth zone 内的受保护 JSON path 现在也通过同一 owner 区分 plain unauthorized 与显式 challenge response

当前 direct consumer evidence：

- crate-level tests 直接证明 challenge response 会保留 `WWW-Authenticate`，而 poison response 不会
- `apps/webui` 现在拥有专用 `readBasicAuthBoundaryKind()` helper 和 focused tests，可区分 challenge、logout-poison 与 plain unauthorized JSON probe，而不会把它们误当成普通 envelope failure
- `apps/webui` 现在也补出了一条 browser-level Basic Auth reference sequence，并明确把 protocol guarantee 与 browser-observed behavior 分开写实：在 Chromium 自动化且没有 cached credentials 的前提下，顶层导航到 `/basic/login` 会被观察为 browser auth error；而 `/basic/logout` 仍返回不带 `WWW-Authenticate` 的 plain `401`，受保护 JSON probe 也仍是 plain unauthorized
- `apps/webui` 现在还补出了一条已验证的 Chromium authenticated logout sequence，不过它依赖正式的 browser harness：带 `Authorization` 注入的浏览器上下文会在 logout 前把受保护后端 probe 拉到 `200`，`/basic/logout` 仍返回不带 `WWW-Authenticate` 的 plain `401`，而 logout 之后下一次受保护 probe 仍保持 authenticated，因为 harness 会继续发送凭证
- Chromium 与 Firefox 现在也把 no-cached-credentials challenge path 上的 browser-specific divergence 正式写实：已验证的高层结论保持一致，但 Chromium 呈现 browser auth error，而 Firefox 呈现原生 `NS_ERROR_*` failure page

当前仍不在该 baseline 内的部分：

- 面向非 Basic 协议的更通用 challenge-framework 抽象
- 超出当前 challenge / poison / plain 401 切分之外的浏览器特定启发式
- authenticated logout 之后，浏览器自己管理的 credential cache 是否真正被逐出，当前仍没有通用证据；现有 browser proof 只覆盖 Chromium 的 no-cached-credentials path，以及 Chromium 下的 authorization-header harness，不能误写成通用协议保证
- 当前还没有完整的第三浏览器已验证矩阵；Firefox 已作为第二个已验证浏览器接入（通过 Playwright 托管缓存检测，全部 10 个 auth-flow 场景验证通过），而 WebKit 现在已经拥有正式的 `distrobox` Ubuntu execution path，并已拿到一条真实 verified callback 结果，但更广的 WebKit 场景矩阵仍未补齐

## 浏览器 Harness 能力基线

当前浏览器 harness 能力和已验证环境基线的权威所有者是 `apps/webui/e2e/support/browser-harness.ts`。

该 owner 正式报告：

- 当前环境中检测到哪些 Playwright 浏览器项目可用、blocked 或 unavailable
- 哪条 executable baseline 产生了该浏览器项目（`system-executable` 或 `playwright-managed`）
- 该项目属于哪条 execution baseline（`host-native` 或 `distrobox-hosted`）
- 每个浏览器当前采用哪条 execution baseline policy（`primary-authority`、`host-truth`、`canonical-recovery-path`、`not-adopted`）
- 哪些浏览器 unavailable 或 blocked 及原因（未检测到可执行文件、项目未配置、宿主依赖缺失）
- 哪些 auth-flow 场景在哪个浏览器上已验证，明确区分 browser-native 路径和 harness-backed 路径
- 哪些场景因浏览器 unavailable 或 blocked 而未验证

当前基线拆分如下：

| 浏览器路径 | 可用性 | 可执行文件基线 | 执行基线 | 原因 |
|---|---|---|
| 宿主上的 Chromium | 可用 | system executable | host-native | 已检测到系统可执行文件 |
| 宿主上的 Firefox | 可用 | Playwright-managed | host-native | 已检测到 Playwright 托管可执行文件 |
| 非 Debian/Ubuntu 宿主上的 WebKit | blocked | Playwright-managed | host-native | 运行时 probe 在 WebKit 启动阶段观察到宿主依赖缺失 |
| `distrobox` `playwright-env` 中的 WebKit | 可用 | Playwright-managed | distrobox-hosted | repo 预置的 Ubuntu 24.04 执行路径；已在其中验证当前 10 场景 harness matrix 全量通过 |

当前已验证 auth-flow 场景：

| 场景 | 路径类型 | 测试套件 |
|---|---|---|
| `basic-auth.challenge.no-cached-credentials` | browser-native | basic-auth |
| `basic-auth.logout.authorization-header-harness` | harness-backed | basic-auth |
| `frontend-oidc.callback.redirect` | browser-native | frontend-oidc |
| `frontend-oidc.popup.relay` | browser-native | frontend-oidc |
| `frontend-oidc.popup.closed-by-user` | browser-native | frontend-oidc |
| `frontend-oidc.cross-tab.storage` | browser-native | frontend-oidc |
| `frontend-oidc.callback.duplicate-replay` | browser-native | frontend-oidc |
| `frontend-oidc.callback.unknown-state` | browser-native | frontend-oidc |
| `frontend-oidc.callback.stale-state` | browser-native | frontend-oidc |
| `frontend-oidc.callback.client-mismatch` | browser-native | frontend-oidc |

以上全部 10 个场景均已在 host-native baseline 下的 Chromium 和 Firefox 上验证通过。WebKit 不再是单一扁平结论：对 Linux 非 Debian/Ubuntu 宿主，host-native 路径仍会以 `host-dependencies-missing` 被正式报告为 `blocked`，但其细节现在来自真实启动 probe，而不是写死的库名表；repo 预置的 distrobox-hosted Ubuntu 路径则会把 WebKit 报告为 `available`，并通过真实 browser-owned 运行验证当前 10 场景 harness matrix 全量通过。在该 distrobox-hosted baseline 下，WebKit 当前共有 10 个 `verified`、0 个 `blocked`、0 个 `unavailable`。

`basic-auth` 和 `frontend-oidc` 两个 e2e 测试套件在测试时直接消费该 owner 并断言已验证环境基线，而不再依赖散文描述。

当前 execution baseline policy：

| 浏览器 | 首选 execution baseline | Host-native 角色 | Distrobox-hosted 角色 |
|---|---|---|---|
| Chromium | host-native | primary-authority | not-adopted |
| Firefox | host-native | primary-authority | not-adopted |
| WebKit | distrobox-hosted | host-truth | canonical-recovery-path |

这条 policy 现在已经进入 owner contract，而不再只是文档约定。Chromium 与 Firefox 当前继续把 host-native browser-owned evidence 当成正式 authority，因为这条宿主基线已经得到验证。WebKit 则继续保留 host-native bring-up failure 作为 unsupported Linux 宿主上的真实 host truth，同时把 distrobox-hosted Ubuntu 作为能够建立 verified browser-owned evidence 的 canonical recovery path。

`playwright.config.ts` 从同一 owner 派生浏览器检测逻辑，不再维护独立的可执行文件检测代码。对于 Playwright 托管浏览器，capability detection 现在优先依赖 Playwright runtime 的 `browserType.executablePath()` 与 repo-level executable override，而不是扫描私有缓存布局。默认情况下它仍只运行当前 execution baseline 下的 available 浏览器；如需对 host-native blocked 浏览器采样证据，可通过 `PLAYWRIGHT_INCLUDE_BLOCKED_PROJECTS=1` 显式把 WebKit 这类 blocked project 纳入定点运行，而不会破坏默认绿色矩阵。对 Linux 非 Debian/Ubuntu 宿主来说，repo 预置的 `distrobox` `playwright-env` 现在则是 WebKit 的正式运行方案。

当前正式策略也不是“把全部浏览器统一搬进 distrobox”。如果现在把 Chromium 与 Firefox 也压平成同一条容器路径，项目会丢失对 browser-owned challenge / popup / callback 宿主行为的直接 authority，而这些 host-native baseline 明明已经完成验证。

尚未产品化：

- 动态渲染 harness 报告的运行时 UI 集成
- 跨 workspace 的 harness 报告（当前仅覆盖 `apps/webui`）

当前已正式进入 authority 的 browser-specific divergence 包括：

- Chromium 与 Firefox 在 Basic Auth no-cached-credentials path 上共享同一条 verified 高层结论
- 但 browser-owned failure surface 仍然分叉（Chromium 为 `ERR_INVALID_AUTH_CREDENTIALS`，Firefox 为原生 `NS_ERROR_*` failure surface）
- WebKit 现在有两条正式结论：host-native 路径在 Linux 非 Debian/Ubuntu 宿主上仍可能因缺失宿主依赖而在启动前失败，而 canonical 的 distrobox-hosted Ubuntu 路径现在已经形成完整 10 场景 verified matrix
- WebKit Basic Auth 现在也引入了一条更细的 browser-specific divergence：在 distrobox-hosted WebKit 下，显式 `/basic/login` challenge 会提交一个带 `WWW-Authenticate` 的 `401` 响应，而 Chromium 与 Firefox 仍会在页面渲染前进入 browser-owned auth failure channel

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
- 当前 configuration story 已正式收成三层，而不再只是设计方向：
  - runtime / foundation config：transport、persistence、scheduler/clock、trace/diagnostics、browser capability bridge
  - auth-context config：issuer/clientId/endpoints、redirect policy、zone policy、required scopes、callback semantics
  - adapter / host config：provider registration、callback host path、client registry entry、app bootstrap 与 route integration
- 当前没有一个统一的大而全 public config DSL；如果 future 讨论中的统一形状还未进入 inventory / evidence，就不应被写成现状

### 调度与统一输入源

foundation 继续拥有：

- `timer`
- `interval`
- `scheduleAt`
- `fromEventPattern`
- `fromSignal`
- `fromPromise`

它们是共享 scheduler/input primitives，不是单个 auth context 的私有实现。

当前 browser/web 层拥有环境相关 bridge：

- `fromVisibilityChange`
- `fromAbortSignal`
- `fromStorageEvent`

这些 helper 现在已形成当前 richer unified input-source baseline。它们只负责 source adaptation 与 subscription cleanup；**不**意味着当前已经产品化整套 Rx/operator family。

当前仍明确不在 baseline 内的包括：

- `switchMap`
- `concatMap`
- `exhaustMap`
- `debounce`
- `throttle`
- 更重的 stream-composition DSL

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

它的 authenticated human principal contract 现在已对齐到 `@securitydept/client` 中的共享 `AuthenticatedPrincipal` baseline，而不再继续维护一套更窄的 session-only semantic owner。

这意味着：

- 稳定身份主键首先是 `subject`，而不是可选的 display-only convenience
- 共享 claims bag 仍属于 semantic principal contract
- host-facing display projection 应落到 `projectAuthenticatedPrincipal()` 及其上层 app helper，而不是继续在 app 内重复手写 fallback 规则

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
- 共享 authenticated human principal 语义现在由 `@securitydept/client` 提供，session-context-client 与 token-set-context-client 都消费这条 baseline，而不再各自维护平行 contract
- resource-token fact 仍归属于 token material / substrate owner，不能被并入共享 authenticated-principal baseline
- raw claims 与 host-facing display string 仍是分层边界：semantic principal 可以保留 claims bag，而 app-facing display 应走共享 projection helper，而不是每个 app 自己写 fallback 代码

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

公开 contract 现在已经拥有一条正式 shared baseline：

- long-running browser flow 可取消或重置
- service / controller / provider 在 teardown 时可释放资源
- adopter 不应自己兜底 SDK 内部 watcher / timer / subscription 清理

当前 baseline 已明确为：

- `DisposableTrait.dispose()` 是正式资源释放原语；SDK 当前不要求 adopter 依赖 `Symbol.dispose`
- `CancellationTokenTrait` / `CancellationTokenSourceTrait` 与 `createCancellationTokenSource()` 构成共享 cooperative cancellation contract
- `createLinkedCancellationToken()` 已进入当前 baseline，用于 token-level fan-in cancellation；长生命周期资源的释放仍由创建该资源的 owning source / handle 显式 `dispose()`
- `CancellationTokenSourceTrait.dispose()` 代表“释放拥有的资源并取消其 token”；`cancel()` 则保留为 producer 侧的语义取消动词，用于资源尚未 release 但操作需要被取消的场景
- `@securitydept/client/web` 现在正式拥有 browser interop：`createAbortSignalBridge(token)` 面向 fetch 等需要 `AbortSignal` 的 consumer，`createCancellationTokenFromAbortSignal(signal)` 面向 React Query queryFn 这类先收到 `AbortSignal` 的 host/framework consumer
- reference consumer 不应继续保留 app-local `AbortSignal -> CancellationTokenTrait` wrapper；`apps/webui/src/api/tokenSet.ts` 现已直接消费共享 web helper
- `createVisibilityReconciler()` 继续作为真实 long-lived resource / teardown 证据：它返回显式 `dispose()` handle，focused tests 直接断言 teardown 后 listener 已释放

当前仍明确不在 baseline 内、但不应被遗忘的边界包括：

- `Symbol.dispose` 集成；`DisposableTrait` 当前仍是 plain `dispose()` contract
- 超出 `createLinkedCancellationToken()` 的 linked cancellation source / cancellation tree；当前 baseline 只正式化 token linking，而非 linked source factory 或 ambient cancellation hierarchy
- 超出显式 `dispose()` handle 的自动全局 teardown registry

## Logging、Trace 与测试

规则保持：

- foundation 提供 logger / trace integration points
- reference app 可做 probe / timeline / diagnostics，但这些不自动成为 SDK public surface
- 真实 authority 由 inventory + evidence + release-gate 共同维护

当前还应明确三条工程纪律：

- logger、trace sink、operation tracer 仍应视为不同层次，而不是单一日志接口
- structured trace / state snapshot / redirect instruction 仍优先于文本日志，作为行为验证观察面
- `FakeClock`、`FakeScheduler`、`FakeTransport`、`InMemoryTraceCollector` 这类测试工具思路是当前有效方法论，但只有进入 public surface 的部分才算正式 SDK contract

当前 structured observation baseline 也已更明确：

- `LoggerTrait` 只负责 human-readable diagnostic channel
- `TraceEventSinkTrait` 与 `TraceEvent` / `createTraceTimelineStore()` 继续负责 machine-readable timeline channel
- `createOperationTracer()` 与 `OperationTraceEventType` 现在正式把 operation lifecycle correlation layer 产品化，但它建立在 trace sink 之上，而不是取代 trace sink
- `OperationScope` 现在已是实际 owner surface：`setAttribute()` 会进入后续 lifecycle event，`recordError()` 会发出 structured machine-readable error event，且可以顺带写 human-readable log，`end()` 只会关闭一次 lifecycle
- `@securitydept/test-utils` 中的 `InMemoryTraceCollector` 现在也支持 operation-level observation：`ofOperation()`、`operationLifecycle()`、`assertOperationLifecycle()`

第 141 轮还把 auth-flow consumer path 从“类型可用”推进成了真实路径：

- token-set frontend 的 callback 与 refresh 现在会发出 operation lifecycle event，并让现有 frontend-mode trace event 通过同一个 `operationId` 相关联
- token-set backend 的 callback fragment、callback body、metadata redemption、refresh，以及嵌套 user-info fallback trace 现在共享同一条 operation correlation story
- `apps/webui` 的 reference timeline 现在把 operation lifecycle entry 作为正式 trace domain 展示，并直接显示 `operationId`，因此这条相关性不再只存在于 SDK focused tests 中
- Rust/server diagnosis 仍是 `securitydept-utils::observability` 拥有的 sibling structured-observation owner，而不是与 TS `createOperationTracer()` 混成同一个 runtime primitive

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
| `@securitydept/basic-auth-context-client-react` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/session-context-client` | `stable` | `session-context` | `stable-deprecation-first` |
| `@securitydept/session-context-client/web` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/session-context-client/server` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-react` | `provisional` | `session-context` | `provisional-migration-required` |
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
source precedence、freshness、restore / revalidate 语义属于该层。

第 139 轮把 browser materialization 上最后一块明显的 owner split 收口到了 SDK：

- `createFrontendOidcModeBrowserClient()` 现在正式拥有 browser 侧的 config projection fetch、validated projection parse、通过 `createWebRuntime()` 的 runtime capability wiring，以及 client materialization
- `resolveFrontendOidcModePersistentStateKey()` 与 `resolveFrontendOidcModeBrowserStorageKey()` 现在正式拥有 persistent-state key derivation，而不再把这条故事留在 reference app
- reference app 现仅保留 frontend mode 的 host bootstrap 关注点：host route constant、host trace consumption，以及 host-specific cross-tab reconciliation behavior

这也把 adopter-facing path 的 layering 明确写实为：

- config acquisition/bootstrap input：config endpoint + redirect URI
- auth-context config：resolved frontend OIDC projection
- runtime/foundation config：transport、store、clock/scheduler、trace sink
- host glue：page route、popup host route、trace render、cross-tab host UX

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
- 第 141 轮随后把 operation correlation layer 也产品化到了这条 baseline 之上：`@securitydept/client` 现在正式拥有 `createOperationTracer()` 与 `OperationTraceEventType`；token-set frontend/backend 的 callback + refresh flow 会把现有 trace event 收口到同一个 `operationId`；reference app timeline 也会把这些 lifecycle entry 直接展示出来，而不再把它们当成 test-only metadata
- testing evidence 也开始从同一条结构化表面出发：focused SDK tests 直接断言 popup 与 callback trace event，browser e2e 则通过由 structured trace timeline 派生的 `data-trace-type` 标记断言 frontend-mode popup / cross-tab 行为，而不再只依赖页面文案
- token-set frontend host 与 token-set backend host 现在在 reference app 中共享同一条显式 structured-trace story：两条 timeline 都是正式 host-owned diagnosis surface，而不再是一条 formal owner + 一条 app-local convenience
- 项目级 observation hierarchy 现在也已从 implicit prose 收成显式层级：
  1. public result / protocol result
  2. redirect / response instruction
  3. structured trace / diagnosis surface
  4. focused fake / harness interaction
  5. human-readable text / log
- 不同 auth family 会有不同 primary surface，但 hierarchy 本身统一：token-set frontend/backend 主要落在 structured trace；Basic Auth browser behavior 主要落在 public/protocol result；browser harness verified-environment claim 主要落在 focused harness interaction

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

#### 3. React 入口：独立 adapter 包拥有 Provider 与 hook wiring

React adopter 应优先从独立 React adapter 包进入，而不是回到 core root surface 手搓 provider glue。  
同理：

- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

它们的 provider/config story 现在都应按同一套 layering 语言来读：

- `BasicAuthContextProvider({ config })`：只有 auth-context config；provider 本身只是 React host glue，当前没有单独 runtime capability layer
- `SessionContextProvider({ config, transport, sessionStore })`：`config` 属于 auth-context config，`transport` / `sessionStore` 属于 runtime capability
- `BackendOidcModeContextProvider({ config, transport, scheduler, clock, ... })`：`config` 属于 auth-context config，而 transport/scheduler/clock/store/trace 属于 runtime capability input
- `TokenSetAuthProvider({ clients, idleWarmup })`：`clients` 是进入共享 registry lifecycle 的 adapter/host registration entry，而不是扁平化的大一统 auth-context config DSL

都应被读成各自 auth-context family 的 React canonical entry。

第 136 轮已把 reference app 的主要 thin-surface parity gap 收口：

- `apps/webui` 现在挂载 `SessionContextProvider`，并通过 `useSessionContext()` 接管 session login URL 解析、pending redirect owner、user-info 状态与 logout flow
- `apps/webui` 现在挂载 `BasicAuthContextProvider`，并通过 `useBasicAuthContext()` 接管 `/login` 与 `/playground/basic-auth` 的 Basic Auth login entry wiring
- 仍刻意保留与 token-set 的不对称边界：session/basic-auth 不复制 token material ownership、callback orchestration 或 bearer transport layering

第 137 轮继续收掉 `session-context` 剩余的 shared convenience owner 漏口：

- `SessionContextClient` 现在正式拥有 framework-neutral 的 browser-shell convenience：`rememberPostAuthRedirect()`、`clearPostAuthRedirect()`、`resolveLoginUrl()` 以及 logout + redirect cleanup
- `@securitydept/session-context-client-react` 不再是这些组合语义的首个 owner，而是改为消费 core 方法

#### 4. Angular 入口：thin DI wrapper 保持 canonical owner 边界

Angular adopter 应优先从独立 Angular adapter 包进入，用于 DI、signal state 与 provider registration glue：

- `@securitydept/basic-auth-context-client-angular`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client-angular`

它们不应成为 framework-neutral convenience 的首个 owner。

它们的 configuration story 也遵循同一层次：

- `provideBasicAuthContext({ config })`：只有 auth-context config
- `SessionContextService.client` 拥有 auth-context behavior，而 Angular DI 只拥有 host registration 与 transport 等 runtime capability injection
- `provideTokenSetAuth({ clients, idleWarmup })`：只拥有 Angular host registration；每个 client entry 仍各自拥有 auth-context config 与 runtime composition

- `@securitydept/session-context-client-angular` 现在暴露与 React 相同的 canonical session browser-shell path，并把低层能力统一留在 `auth.client`，不再在 Angular service facade 上重复转发 core 方法。
- `@securitydept/basic-auth-context-client-angular` 继续只是 core zone / redirect / boundary helper 的 thin facade；因为这些共享 helper 早已位于 `@securitydept/basic-auth-context-client`，所以本轮不需要新的 owner uplift。

#### 5. SSR / server-host 入口：dedicated `./server` helpers

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
