# TS SDK 迁移记录

本文档是 TS SDK public-surface 变更纪律、迁移说明与 deprecation 记录的权威入口。

## 0.x 合约变更策略

TS SDK 当前处于 `0.x` 阶段。这不意味着"随便改" — 而是**允许 breaking change，但必须有纪律**。

### 按 Stability 分级的变更纪律

| Stability | Change Discipline | 含义 |
|---|---|---|
| `stable` | `stable-deprecation-first` | Breaking change 必须先经过 deprecation 周期。至少在一个 minor release 中保留已废弃 API 可用，并在本文档中记录迁移说明。 |
| `provisional` | `provisional-migration-required` | 允许 breaking change，但必须带迁移说明（记录在本文档中）和 review 可见的理由。 |
| `experimental` | `experimental-fast-break` | 预期会有 breaking change，无需提前 deprecation。建议在本文档中留简要说明，但 gate 不强制。 |

### 规则

1. **每个非 experimental 的 breaking change 必须在下方 [迁移说明](#迁移说明) 中留记录。**
2. **Stable surface**：先 deprecate，后移除。已废弃 API 至少在一个 minor release 中保持可用。
3. **Provisional surface**：允许 break，但说明必须包含理由和迁移路径。
4. **Experimental surface**：无流程要求，但建议留简要说明。
5. **Inventory 是权威**：`public-surface-inventory.json` 声明了每个 subpath 的 `changeDiscipline`。本文档是其人类可读的伴随文档。

### 如何添加迁移说明

在对非 experimental public surface 进行 breaking change 时：

1. 在下方 [迁移说明](#迁移说明) 中按以下格式新增条目。
2. 如 subpath stability 或形状有变，同步更新 `public-surface-inventory.json`。
3. 确保 `release-gate.test.ts` 通过。

条目格式：

```markdown
### [日期] package/subpath — 简要描述

**Discipline**: `stable-deprecation-first` | `provisional-migration-required`
**Subpath**: `@securitydept/package/subpath`
**变更**: breaking change 描述
**迁移**: 逐步迁移说明
**理由**: 为何必须 break（仅 provisional/stable）
```

## 迁移说明

### 2026-04-24 @securitydept/client / session-context / token-set-context-client —— shared authenticated-principal baseline 现已成为 canonical cross-family contract

**Discipline**: `stable-deprecation-first`（`@securitydept/client`、`@securitydept/session-context-client`）+ `provisional-migration-required`（`@securitydept/token-set-context-client/*`）

**Subpath**: `@securitydept/client`、`@securitydept/session-context-client`、`@securitydept/token-set-context-client/backend-oidc-mode`、`@securitydept/token-set-context-client/frontend-oidc-mode`、`@securitydept/token-set-context-client/orchestration`

**变更**：

仓库现在不再把 session 与 token-set 视为 authenticated human-principal 数据的两套独立 semantic owner。

- `@securitydept/client` 现在拥有共享的 TS/browser `AuthenticatedPrincipal` baseline，以及 `normalizeAuthenticatedPrincipal()`、`normalizeAuthenticatedPrincipalWire()`、`projectAuthenticatedPrincipal()`
- `session-context-client` 的 user-info normalization 现在要求稳定 `subject`，并把 principal contract 对齐到这条共享 baseline
- token-set backend/frontend 的 user-info 与 orchestration principal 路径现在都消费同一条共享 semantic owner，而不再维护一套 token-set-only 平行 principal contract
- `apps/webui` dashboard user projection 现在改走 shared helper-backed projection path，不再在 app 内按 mode 重复手写 fallback 规则
- 这次 consolidation 只针对 authenticated human principal 语义；resource-token fact、browser-owned token material、mixed-custody、以及 BFF/server-side token ownership 仍是独立议题

**迁移**：

1. 如果你的 TS 代码仍把 session principal 视为只有 `displayName` 的窄数据，请迁移到共享 `AuthenticatedPrincipal` 形状，并提供/断言稳定的 `subject`。
2. 如果你的代码仍直接解析 snake_case wire user-info payload，优先改用 `normalizeAuthenticatedPrincipalWire()`，让 `subject`、`display_name`、`issuer` 与 `claims` 的 normalization 留在同一个 owner。
3. 如果你的 app 仍从原始 principal 字段拼接 host-facing current-user label，优先使用 `projectAuthenticatedPrincipal()` 或建立在其上的薄 app helper，而不是继续重复 `displayName ?? subject ?? ...` 之类的 fallback 逻辑。
4. 不要把 resource-token principal/fact surface 视为这份 contract 的别名；它们仍属于 substrate/token-material concern，而不是 authenticated human-principal projection。

**理由**：

在 iteration 142 之前，session 与 token-set 都带着相互重叠但不完全一致的 principal 语义，这让 cross-family host code 与 cross-language authority 很难保持一致。本轮把 semantic owner 上提到共享 foundation，同时明确不把 resource-token 与后续 mixed-custody/BFF 主题误并入当前 baseline。

### 2026-04-24 Operation tracer / trace sink / logger 分层产品化 —— operation lifecycle correlation 现已拥有真实 TS owner

**Discipline**: `stable-deprecation-first`（foundation）+ `experimental-fast-break`（test-utils）

**Subpath**: `@securitydept/client`, `@securitydept/test-utils`

**变更**：

TS/browser structured observation baseline 现在已包含一条真实的 operation correlation layer，而不再只是 interface-only 类型。

- `@securitydept/client` 现在正式拥有 `createOperationTracer()` 与 `OperationTraceEventType`
- `OperationScope` 现在已有 canonical implementation，会把 `operation.started`、`operation.event`、`operation.error`、`operation.ended` 发进 `TraceEventSinkTrait`
- token-set frontend 的 callback/refresh 与 backend 的 callback family/refresh 现在都会通过同一个 `operationId` 关联它们现有的 trace event
- `apps/webui` timeline 现在会直接展示 operation lifecycle entry 与 `operationId`，不再让这条相关性只停留在 SDK-focused tests 内部
- `@securitydept/test-utils` 中的 `InMemoryTraceCollector` 现在支持 `ofOperation()`、`operationLifecycle()` 与 `assertOperationLifecycle()`，用于 operation-level assertion

**迁移**：

1. 当你需要 operation lifecycle correlation 时，优先使用 `createOperationTracer({ traceSink, logger, clock, scope, source })`，而不是手写 wrapper。
2. 继续把 `LoggerTrait` 视为 human-readable auxiliary channel；不要再用 console text assertion 取代 machine-readable observation。
3. 如果你的 auth-flow 测试仍在手写按 operation filter trace 数组，现在应迁移到 `InMemoryTraceCollector.ofOperation()` 与 `assertOperationLifecycle()`。
4. 将 `operationId` 视为 lifecycle event 与现有 family-specific trace event 之间的稳定 correlation key；exporter/OTel/span-tree 仍明确不在当前 baseline 内。

**理由**：

在 iteration 141 之前，`OperationTracerTrait` 与 `OperationScope` 虽已是 public type，但缺少 canonical implementation 与真实 auth-flow consumer path。本轮把这个 owner gap 收口，但仍刻意不扩张为完整 exporter / OTel stack。

### 2026-04-24 Unified input-source helper 收口 —— richer foundation/web source helpers 现已进入当前 public baseline

**Discipline**: `stable-deprecation-first`

**Subpath**: `@securitydept/client`, `@securitydept/client/web`

**变更**：

统一 input-source richer helper 现在已从“文档中承认的方向”前进为正式产品化 baseline。

- `@securitydept/client` 现在正式拥有 `fromSignal()` 与 `fromPromise()`，并与 `timer()`、`interval()`、`scheduleAt()`、`fromEventPattern()` 共同构成 foundation 层 helper 集
- `@securitydept/client/web` 现在正式拥有 `fromAbortSignal()` 与 `fromStorageEvent()`，并与 `fromVisibilityChange()` 一起构成 browser/web 层 source bridge
- auth-flow / browser consumer 不再需要手写这些 bridge：React signal bridge、callback-resume promise settlement、browser cancellation interop 与 cross-tab storage listener 现在都直接消费 shared owner

**迁移**：

1. 当你需要 shared subscription 形状时，用 `fromSignal()` 替换手写 `signal.subscribe(...)` 到 external-store 的桥接代码。
2. 当你在把异步完成状态投影到 host state 时，用 `fromPromise()` 替换 ad hoc `promise.then(...).catch(...)` + 手写 stale guard。
3. 当 owner 明显属于 shared web layer 而不是 app-local code 时，用 `fromAbortSignal()` / `fromStorageEvent()` 替换直接的浏览器 `abort` / `storage` 监听 glue。
4. 继续把这些 helper 视为 thin source adapter；operator-style composition 仍明确不在当前 baseline 内。

**理由**：

在 iteration 140 之前，文档一直明确保留这些 richer helper 的可见性，但实现层始终缺少正式 owner，导致设计讨论与当前 browser/auth-flow adopter 之间存在真实空档。本轮把这个 owner gap 收口，但没有把范围扩张成完整 stream/operator framework。

### 2026-04-23 Capability-first configuration layering consolidation —— frontend-mode browser materialization 与 adapter vocabulary 现已拥有正式 owner

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/token-set-context-client/frontend-oidc-mode`

**变更**：

capability-first configuration layering 现在已从设计方向前进为当前正式 adopter-facing baseline：

- `@securitydept/token-set-context-client/frontend-oidc-mode` 现在正式拥有 `createFrontendOidcModeBrowserClient()`，用于 browser 侧的 config projection fetch、validated parse、runtime capability wiring 与 client materialization
- 同一 subpath 现在也正式拥有 `resolveFrontendOidcModePersistentStateKey()` 与 `resolveFrontendOidcModeBrowserStorageKey()`，用于 persistent-state key story
- reference app 不再在 `apps/webui/src/lib/tokenSetFrontendModeClient.ts` 中保留 frontend-mode 的 config fetch + parse + `createWebRuntime()` + `createFrontendOidcModeClient()` assembly owner
- adapter/provider entry docs 现在统一按三层书写：runtime/foundation config、auth-context config、adapter/host config

**迁移**：

1. 当宿主通过 projection endpoint 获取 frontend-mode config 时，用 `createFrontendOidcModeBrowserClient()` 替换 app-local browser materialization。
2. 将 `configEndpoint` / `redirectUri` 视为 bootstrap input，而不是 auth-context config 本体。
3. 将 transport/store/scheduler/clock/trace 视为 runtime capability input，而不是塞进同一个扁平 auth config 对象。
4. route constant、popup host route、registry registration、trace render 这类 host-only concern 继续保留在 mode/root client config 之外。

**理由**：

在 iteration 139 之前，这条 foundation 方向其实早已明确，但 reference app 仍保留着最重的 frontend-mode materialization path，而 provider/config vocabulary 在不同 auth family 间也仍各说各话。本轮把这个 owner gap 收口，并把当前 layering story 正式写成 authority。

### 2026-04-23 Cancellation / resource-release baseline consolidation —— shared AbortSignal interop 与 dispose 语义现已产品化

**Discipline**: `stable-deprecation-first`

**Subpath**: `@securitydept/client`, `@securitydept/client/web`

**变更**：

TS/browser foundation 现在已有一条明确的 cancellation / resource-release story，而不再是 core contract + app-local glue 并存：

- `DisposableTrait`、`CancellationTokenTrait`、`CancellationTokenSourceTrait`、`createCancellationTokenSource()` 与 `createLinkedCancellationToken()` 现在都被正式写入当前 shared cancellation baseline
- `CancellationTokenSourceTrait.dispose()` 现在被明确为当前 owner-side release primitive：释放拥有的资源也会一并取消其 token
- `@securitydept/client/web` 现在正式拥有两个 bridge 方向：
   - `createAbortSignalBridge(token)`：面向 fetch 这类需要 `AbortSignal` 的 browser-native consumer
   - `createCancellationTokenFromAbortSignal(signal)`：面向先收到 `AbortSignal`、再调用接受 `CancellationTokenTrait` 的 SDK API 的 browser/framework consumer
- reference app 已不再在 `apps/webui/src/api/tokenSet.ts` 中保留 app-local `AbortSignal -> CancellationTokenTrait` wrapper

**迁移**：

1. 将任何 app-local `AbortSignal -> CancellationTokenTrait` wrapper 替换为 `@securitydept/client/web` 导出的 `createCancellationTokenFromAbortSignal(signal)`。
2. 当 browser adapter 需要把 foundation cancellation 交给 fetch 或其它 web-native API 时，继续使用 `createAbortSignalBridge(token)` 作为 canonical path。
3. 将 `.dispose()` 视为当前显式资源释放 contract；不要假设已有 `Symbol.dispose` 支持。
4. 如果需要 low-level cancellation fan-in，使用 `createLinkedCancellationToken()`；linked source factory 或 ambient cancellation tree 仍明确不在当前 baseline 内。

**理由**：

在 iteration 138 之前，core contract 虽已存在，但 browser consumer path 仍被拆成两半：fetch transport 使用 shared forward bridge，而 reference app 还保留了第二套 reverse bridge story。本轮把这条 owner split 收口，并把当前 release / disposal 边界正式写实。

### 2026-04-23 Cross-runtime observability consolidation —— 浏览器观察层级与 server auth diagnosis 现已拥有正式 owner，但没有新增 TS 导出

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**变更**：

本轮没有新增 TypeScript public export，因此不需要更新 `public-surface-inventory.json`。

但 reference app observability 与 server auth path 行为又发生了一轮实质性收口：

- token-set frontend host 与 token-set backend host 现在共享同一条显式 structured-trace story，而不再是一条 formal owner + 一条 app-local convenience surface
- `apps/webui/src/lib/authObservationHierarchy.ts` 现在把 token-set host、Basic Auth browser boundary 与 browser harness verified-environment claim 统一收成正式 project observation hierarchy
- `securitydept-session-context` 现在在 `session.login`、`session.logout`、`session.user_info` 上暴露 machine-readable diagnosis
- `securitydept-basic-auth-context` 现在在 `basic_auth.login`、`basic_auth.logout`、`basic_auth.authorize` 上暴露 machine-readable diagnosis，同时继续保留 protocol-specific response owner
- `apps/server` 的 route 与 middleware 现在直接消费这些 diagnosed result，而不再把 plain route log 当成这些路径的唯一 runtime 证据

**迁移**：

1. 无需修改任何 TS import path。
2. 如果你的宿主/runtime 叙事仍把 token-set frontend trace 当成唯一正式 structured surface，现在应更新为 frontend/backend host trace 共享同一 observation hierarchy。
3. 如果你的 server integration 或测试仍通过 plain route log 得出 session/basic-auth auth path 结论，现在应迁移到 diagnosed `operation` / `outcome` / field surface。
4. 如果你的文档仍只用散文描述 Basic Auth 与 browser harness 的观察方式，现在应改用显式 hierarchy vocabulary：public result、redirect/response instruction、structured trace/diagnosis、focused harness interaction、human-readable log。

**理由**：

第 135 轮补齐了更早最小 trace/diagnosis baseline 留下的 cross-runtime observability 缺口：frontend/backend token-set host trace、Basic Auth/browser harness observation 定位、以及 session/basic-auth server auth path 现在都拥有正式、machine-readable 的 owner。

### 2026-04-23 WebKit matrix consolidation —— canonical distrobox baseline 现已验证当前完整 10 场景 harness，但没有新增 TS 导出

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**变更**：

本轮没有新增 TypeScript public export，因此不需要更新 `public-surface-inventory.json`。

但 browser harness 的 WebKit verified-environment matrix 又发生了实质性推进：

- 剩余 6 条 `frontend-oidc` 场景现在已在 distrobox-hosted Ubuntu baseline 下验证通过
- 2 条 WebKit Basic Auth 场景现在也已在同一 baseline 下验证通过
- canonical 的 distrobox-hosted WebKit matrix 现在在当前 harness surface 上达到 10 verified / 0 blocked / 0 unavailable
- 同时，verified matrix 内现在也正式保留一条更细的 browser-specific divergence：WebKit 会把显式 Basic Auth challenge 提交为带 `WWW-Authenticate` 的 `401` 响应，而 Chromium 与 Firefox 仍会在页面渲染前进入 browser-thrown auth failure channel

**迁移**：

1. 无需修改任何 TS import path。
2. 如果你的文档或测试仍把 WebKit 写成 canonical distrobox baseline 下仍有部分 unavailable，现在应更新为完整 10 场景 verified matrix。
3. 继续显式保留 WebKit Basic Auth divergence：它仍然是 verified browser evidence，但 challenge surface 与 Chromium / Firefox 不同。

**理由**：

第 134 轮在已产品化的 canonical distrobox baseline 之上收口了剩余 WebKit matrix，把最后一段 partial-status 叙事也改成了单一权威 verified surface。

### 2026-04-23 WebKit verified matrix expansion —— popup relay 现已成为 canonical distrobox baseline 的正式场景，但没有新增 TS 导出

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**变更**：

本轮没有新增 TypeScript public export，因此不需要更新 `public-surface-inventory.json`。

但 browser harness 的 verified-environment matrix 又向前推进了一步：

- `frontend-oidc.popup.relay` 现已成为 distrobox-hosted Ubuntu baseline 下的真实 WebKit verified scenario
- `frontend-oidc.callback.redirect` 仍继续在该 baseline 下保持 verified，因此 WebKit 现在在当前 10 场景 harness matrix 中共有 2 个 verified scenario
- 同一条 distrobox-hosted WebKit matrix 当前共有 0 个 blocked scenario 与 8 个 unavailable scenario；这些 remaining scenario 仍必须保留为正式 unavailable，而不是只写成“未来计划”
- 这次扩矩阵没有引入新的 browser-specific failure divergence；popup relay 在 browser-owned host 中与现有 Chromium / Firefox 行为形状保持一致

**迁移**：

1. 无需修改任何 TS import path。
2. 如果你的文档或测试仍把 WebKit 写成“只有一条 distrobox-hosted callback verified scenario”，现在应更新为包含 popup relay 这第二条 verified scenario。
3. 对仍未验证的 WebKit 场景，继续保持正式状态表达，不要把它们改写成模糊的未来计划。

**理由**：

第 133 轮是在已产品化的 canonical distrobox baseline 之上继续扩 WebKit verified matrix，而不是再次改写 baseline-policy contract 本身。

### 2026-04-23 Browser execution baseline policy productization —— 双 baseline authority 现已显式化，但没有新增 TS 导出

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**变更**：

本轮没有新增 TypeScript public export，因此不需要更新 `public-surface-inventory.json`。

但 browser harness owner 现在新增了一层正式 execution-baseline policy：

- Chromium 与 Firefox 已明确把 `host-native` 保留为 `primary-authority`
- WebKit 已明确把 `host-native` 保留为 `host-truth`，同时把 `distrobox-hosted` Ubuntu 作为 `canonical-recovery-path`
- owner 现在正式拒绝把全部浏览器统一压进 distrobox 作为默认策略，因为那会丢掉已经验证完成的 host-native browser-owned evidence
- 同一条 frontend OIDC baseline test 现在已经被同时用于 Firefox host-native 与 WebKit distrobox-hosted 证据

**迁移**：

1. 无需修改任何 TS import path。
2. 如果你的测试或文档曾暗示 `distrobox` 应成为全部浏览器的统一 baseline，现在应改成显式的双 policy 词汇。
3. 如果你的文档过去把 host-native 与 distrobox-hosted 证据压成单一 Linux 事实，现在应按 authority 角色拆开：host-native 可以继续作为 primary authority 或 host truth，而 distrobox-hosted 则作为 canonical recovery path。

**理由**：

第 132 轮把 execution-baseline policy 本身变成了 browser harness 的正式 owner contract，而不再只是围绕 harness 的散文说明。

### 2026-04-22 第三浏览器 bring-up —— WebKit 现已采用 distrobox-hosted canonical execution baseline，但没有新增 TS 导出

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**变更**：

本轮没有新增 TypeScript public export，因此不需要更新 `public-surface-inventory.json`。

但浏览器 harness 能力和已验证环境基线发生了五点重要变化：

- WebKit 不再被压成单一 Linux 结论：harness 现在同时报告 executable baseline（`system-executable` 或 `playwright-managed`）和 execution baseline（`host-native` 或 `distrobox-hosted`）
- 对 Linux 非 Debian/Ubuntu 宿主，WebKit 的 host-native 运行在运行时启动 probe 观察到 MiniBrowser 缺少宿主依赖时，仍会被正式记为 `host-dependencies-missing`
- repo 预置的 `distrobox` `playwright-env` 现已成为这类宿主上 WebKit 的 canonical Ubuntu execution baseline
- 在这条 distrobox-hosted baseline 中，Playwright 托管的 WebKit runtime 已是 `available`，并且 `frontend-oidc.callback.redirect` 已经取得一条真实 verified callback 结果
- Playwright 托管浏览器的 capability detection 现在来自 Playwright runtime 的 executable discovery 与 repo-level executable override，而不是私有缓存扫描
- `playwright.config.ts` 继续从同一 owner 派生 project，而 `PLAYWRIGHT_INCLUDE_BLOCKED_PROJECTS=1` 仍可用于显式采集 host-native blocked 证据

**迁移**：

1. 无需修改任何 TS import path。
2. 如果你的浏览器侧测试或文档过去把 WebKit 写成单一的 host-blocked 终点，现在应改成拆分后的 baseline 词汇：host-native blocked 证据仍然有效，但对 Linux 非 Debian/Ubuntu 宿主，canonical bring-up path 已改为 distrobox-hosted Ubuntu execution。
3. 如果你需要在本地走 canonical WebKit 路径，应进入 repo 预置的 `distrobox` `playwright-env` 后再运行 Playwright。
4. 如果你需要在本地为 host-native blocked 浏览器补证据，可在运行 `playwright test --project=<browser>` 前设置 `PLAYWRIGHT_INCLUDE_BLOCKED_PROJECTS=1`。
5. browser-specific divergence 继续保持权威：Chromium 与 Firefox 仍共享 verified 的 no-cached-credentials Basic Auth 高层结论，而 WebKit 现在已有一条 distrobox-hosted verified callback 场景，但还没有完整矩阵。

**理由**：

第 131 轮把浏览器 harness 从“最小双浏览器已验证基线”推进到了“第三浏览器双路径基线”：host-native WebKit blocked 证据仍被正式保留，但 repo 的 canonical 路径现在继续进入 distrobox-hosted Ubuntu execution，并在其中拿到一条真实 WebKit callback verified 结果，同时没有引入新的 TS SDK public export。

### 2026-04-22 第二浏览器已验证基线 —— Firefox 接入 Playwright harness，但没有新增 TS 导出

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**变更**：

本轮没有新增 TypeScript public export，因此不需要更新 `public-surface-inventory.json`。

但浏览器 harness 能力和已验证环境基线发生了三点重要变化：

- Firefox 现在通过 Playwright 托管可执行文件发现路径检测到，并报告为可用，`detectionSource: "playwright-managed"`
- 全部 10 个 auth-flow 场景（2 个 basic-auth + 8 个 frontend-oidc）现已在 Firefox 和 Chromium 上同时验证通过
- `playwright.config.ts` 现在从 harness owner 生成多浏览器项目，在 Chromium 和 Firefox 上同时运行所有 e2e 测试

**迁移**：

1. 无需修改任何 TS import path。
2. Basic Auth challenge 错误模式在不同浏览器间存在差异：Chromium 产生 `ERR_INVALID_AUTH_CREDENTIALS`，Firefox 产生 `NS_ERROR_NET_EMPTY_RESPONSE`。测试现在使用浏览器感知的匹配模式。
3. Popup relay 时序在不同浏览器间存在差异：popup 关闭前的 `waitForURL` 已被移除，因为 Firefox 关闭 popup 的速度快于 callback URL 观察完成。测试现在仅等待 popup 关闭事件。

**理由**：

第 130 轮将浏览器 harness 从单浏览器推进到多浏览器已验证基线，但没有引入任何新的 TS SDK public export。

### 2026-04-22 文档与 consumer 同步 —— 浏览器 harness 能力报告已产品化，但没有新增 TS 导出

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**变更**：

本轮没有新增 TypeScript public export，因此不需要更新 `public-surface-inventory.json`。

但 browser harness 的 authority boundary 发生了重要变化：

- `apps/webui/e2e/support/browser-harness.ts` 现在是浏览器 harness 能力和已验证环境基线的权威 owner
- 该 owner 正式报告哪些 Playwright 浏览器可用、哪些不可用及原因、哪些 auth-flow 场景在哪个浏览器上已验证，并明确区分 browser-native 与 harness-backed 路径
- `basic-auth` 和 `frontend-oidc` 两个 e2e 测试套件现在直接消费该 owner 并断言已验证环境基线
- `playwright.config.ts` 从同一 owner 派生浏览器检测逻辑，不再维护独立的可执行文件检测代码
- 第二浏览器基线（Firefox/WebKit）正式标记为不可用，而非静默省略

**迁移**：

1. 无需修改任何 TS import path。
2. 如果你的 e2e 测试套件需要断言浏览器可用性或 auth-flow 场景覆盖，请消费 `browser-harness.ts` owner，而不是自行维护独立的浏览器检测逻辑。
3. 不要把当前仅 Chromium 可用的环境写成通用多浏览器已验证；Firefox/WebKit 场景正式报告为 `browser-unavailable`。

**理由**：

iteration 129 改变的是浏览器 harness 能力报告的 authority boundary 与 consumer 行为，而不是新的 TS SDK export surface。ledger 需要把这层区别显式写清楚。

### 2026-04-22 文档与 consumer 同步 —— Basic Auth authenticated logout evidence 现已补出正式 Chromium harness，但没有新增 TS 导出

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**变更**：

本轮没有新增 TypeScript public export，因此不需要更新 `public-surface-inventory.json`。

但 reference-app 的 browser evidence 发生了三点重要变化：

- `apps/webui` 现在把 verified browser baseline、browser-specific observed behavior 和 remaining unknowns 分开表达
- reference app 现在拥有一条依赖正式 `Authorization` header harness 的 Chromium authenticated logout sequence
- 当前本地 Playwright 环境仍只检测到 Chromium，因此本轮不宣称已验证的第二浏览器 baseline

**迁移**：

1. 无需修改任何 TS import path。
2. 如果你的 host UI 要描述 Basic Auth logout 行为，请区分浏览器自己管理的 credential replay 与 harness 显式注入的 credential replay。
3. 不要把新的 authenticated logout sequence 写成通用浏览器 cache eviction 证明；它证明的是 Chromium harness path，并且明确记录了第二浏览器 baseline 仍缺失。

**理由**：

iteration 128 改变的是 Basic Auth logout 行为的 browser evidence 边界，而不是新的 TS SDK export surface。ledger 需要把这层区别显式写清楚。

### 2026-04-22 文档与 consumer 同步 —— Basic Auth browser evidence 现已区分 protocol guarantee 与 Chromium-observed behavior，但没有新增 TS 导出

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**变更**：

本轮没有新增 TypeScript public export，因此不需要更新 `public-surface-inventory.json`。

但 reference-app 的 browser authority 发生了两点重要变化：

- `apps/webui` 的 Basic Auth playground 现在会把 protocol guarantee 与 browser-observed state 分开渲染，而不再把两者混写在同一段说明里
- reference app 现在拥有 browser-e2e 证据，证明 Chromium 在没有 cached credentials 时会把显式 `/basic/login` 导航升级成 browser auth error，而 `/basic/logout` 仍是不带 `WWW-Authenticate` 的 plain `401`

**迁移**：

1. 无需修改任何 TS import path。
2. 如果你的浏览器侧文档或 host UI 要描述 Basic Auth challenge 行为，请把 protocol guarantee 与 browser-specific observed outcome 分开表达。
3. 不要把 Chromium 的 auth-error navigation 行为写成通用协议保证；logout 之后的 credential-cache eviction 仍是明确保留的 cross-browser debt。

**理由**：

iteration 127 改变的是 Basic Auth 行为的 browser evidence 与 host authority，而不是新的 TS SDK export surface。ledger 需要把这层区别显式写清楚。

### 2026-04-22 文档与 consumer 同步 —— Basic Auth protocol exception 现已成为显式 baseline，但没有新增 TS 导出

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**变更**：

本轮没有新增 TypeScript public export，因此不需要更新 `public-surface-inventory.json`。

但 Basic Auth failure 的 authority boundary 发生了两点重要变化：

- `securitydept-basic-auth-context` 现在拥有显式的 Basic Auth protocol-specific response contract，用于 challenge、plain unauthorized 与 logout-poison response
- `apps/webui` 现在通过专用 consumer helper 区分带 `WWW-Authenticate` 的 challenge response 与 plain unauthorized / logout-poison `401`，而不再把所有 `401` 都当作普通 shared-envelope failure

**迁移**：

1. 无需修改任何 TS import path。
2. 如果你的 app-local browser 代码要处理 Basic Auth boundary response，请显式区分 challenge / poison / plain unauthorized 语义，而不要假设所有 `401` 都应走 shared server error envelope 解析路径。
3. 不要再尝试把 Basic Auth challenge 或 poison response retrofit 到 `ServerErrorEnvelope`；它们现在已被文档明确为 protocol-specific exception baseline。

**理由**：

iteration 126 改变的是 Basic Auth protocol exception 的 server/browser authority contract，而不是新的 TS SDK export surface。ledger 需要把这层区别显式写清楚。

### 2026-04-22 文档与 consumer 同步 —— reference-app auth path 现已保住 browser/server error symmetry，但没有新增 TS 导出

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**变更**：

本轮没有新增 TypeScript public export，因此不需要更新 `public-surface-inventory.json`。

但 reference-app consumer boundary 发生了两点重要变化：

- `apps/webui` 的 frontend-mode config projection fetch 现在会把结构化 server envelope 保留为 `ClientError`，不再塌缩成 app-local `Error` 字符串
- `apps/webui` 的 dashboard API 调用现在通过 `ClientError.fromHttpResponse()` 消费结构化 auth envelope，而不再做 app-local status/message 解析

本轮同时也缩小了 server-side plain-response debt：propagation auth-boundary middleware response 现已迁到 shared `ServerErrorEnvelope`；但带有 Basic Auth challenge/poison 协议语义的响应仍明确保留在 baseline 之外。

**迁移**：

1. 无需修改任何 TS import path。
2. 如果你的 app-local 代码仍通过 `statusText`、plain `message` 或自定义 `ApiError` wrapper 解析 auth HTTP failure，请迁移到 `ClientError.fromHttpResponse()` + `readErrorPresentationDescriptor()`。
3. 不要把 Basic Auth challenge / logout-poison response 当作当前 shared envelope baseline 的一部分；它们仍是 protocol-specific exception。

**理由**：

iteration 125 改变的是 reference app 的真实行为与跨语言 authority，而不是新的 TS export surface。ledger 需要把这层区别显式写清楚。

### 2026-04-21 文档与 consumer 同步 —— Rust/server dual-layer error envelope 已接入，但没有新增 TS 导出

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**变更**：

本轮没有新增 TypeScript public export，因此不需要更新 `public-surface-inventory.json`。

但文档上的跨语言 error boundary 发生了两点重要变化：

- `securitydept-utils::error` 现在拥有共享的 Rust/server dual-layer HTTP error contract（`ServerErrorKind`、`ServerErrorDescriptor`、`ServerErrorEnvelope`）
- `ClientError.fromHttpResponse()` 这类 TS consumer 现在可以直接识别结构化 server error envelope，而不再只依赖扁平的 `code` / `message` / `recovery` body

**迁移**：

1. 无需修改任何 TS import path。
2. 如果你在 TypeScript 中测试 server HTTP failure，优先断言结构化 `error.kind` / `error.code` / `error.presentation` envelope，而不是只断言 plain `message` 字符串。

**理由**：

iteration 124 改变的是共享 server-facing error boundary 与 consumer 行为，而不是新的 TS export surface。ledger 需要把这层区别写清楚。

### 2026-04-21 文档权威同步 —— Rust/server auth-flow diagnosis baseline 已澄清，但没有 TS public-surface 变更

**Discipline**: `provisional-migration-required`

**Subpath**: `documentation-only authority sync`

**变更**：

本轮没有 TypeScript public surface 变化，因此不需要更新 `public-surface-inventory.json`。

但权威文档现在已明确记录：

- `securitydept-utils::observability` 拥有共享的 Rust/server auth-flow diagnosis vocabulary
- 当前已产品化的服务端 operation 为 `projection.config_fetch`、`oidc.callback`、`oidc.token_refresh`、`forward_auth.check`、`propagation.forward`
- 这条 baseline 之外的路径，除非后续单独接入，否则仍只是 plain `tracing` log

**迁移**：

1. 无需调整任何 TS import path 或 runtime 行为。
2. 当你在跨语言 auth-flow observability 上写文档或做 review 时，应把 Rust/server diagnosis vocabulary 当作共享 server contract，而不是临时 route log。

**理由**：

iteration 123 修改的是 authority boundary，而不是新的 TS public API。把这点记录在 ledger 中，可以避免把“文档权威变化”误写成“TS SDK surface 变化”。

### 2026-04-21 @securitydept/token-set-context-client/frontend-oidc-mode —— popup redirect 语义现已与真实 host-owned relay route 对齐

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/token-set-context-client/frontend-oidc-mode`

**变更**：

`FrontendOidcModeClient.popupLogin()` 现在会把 `popupCallbackUrl` 当作真实 OAuth `redirect_uri`，并允许为 opener window 额外传入可选的 `postAuthRedirectUri`。

- popup callback handling 不再假设所有成功 callback 都必须使用 `config.redirectUri`
- host-owned popup relay route 现在可以在不依赖 app-local redirect spoofing 的前提下完成真实 authorization-code flow
- canonical reference app 已通过 `/auth/token-set/frontend-mode/popup-callback` 与 browser e2e 证明这条行为，同时也在宿主层证明了 cross-tab hydrate / clear authority

**迁移**：

1. 如果你的 popup host route 已经把专用 relay page 作为 `popupCallbackUrl` 传入，就不再需要先把 callback 改写回 `config.redirectUri` 才能完成 code exchange。
2. 如果 opener window 在 popup 成功后需要回到特定页面，请显式传入 `postAuthRedirectUri`，不要继续让 `popupCallbackUrl` 同时承担两种语义。
3. 如果你的测试此前通过旧的 `authorizeUrl(postAuthRedirectUri, extraParams)` 路径来 stub `popupLogin()`，请改为匹配 popup-specific redirect 行为。

**理由**：

在 iteration 120 之前，popup API surface 虽然存在，但浏览器实际授权时仍使用非 popup 的 redirect URI，这意味着真实 app-owned popup relay route 无法诚实拥有 popup callback。这个缺口必须在 SDK owner boundary 修补，reference-app popup productization 与 browser-e2e authority 才会是真实行为，而不是模拟结果。

### 2026-04-20 @securitydept/token-set-context-client-react —— browser-owned host route 的结构化 callback failure details

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/token-set-context-client-react`

**变更**：

browser-owned callback host 不再需要解析不透明的 callback error message。

- `CallbackResumeState` 现在在既有 `error` 之外额外暴露 `errorDetails`
- `@securitydept/token-set-context-client-react` 现在导出 `CallbackResumeErrorDetails` 与 `readCallbackResumeErrorDetails(error)`
- canonical reference host route 现在基于结构化 `code` / `recovery` 渲染稳定的 callback-failure product state（`callback.unknown_state`、`callback.pending_stale`、`callback.pending_client_mismatch`、`callback.duplicate_state`），而不是继续依赖 raw message text

**迁移**：

1. 如果你的 host route 已经消费 `useTokenSetCallbackResume()`，渲染 callback failure 时优先读取 `state.errorDetails`。
2. 如果你的 host route 只拿到 `unknown` error，请改用 `readCallbackResumeErrorDetails(error)`，不要再解析 `error.message` 来推断 callback 语义。
3. callback failure 断言应改为面向稳定的 `code` / `recovery` 输出，而不是依赖英文 message 片段。

**理由**：

iteration 118 已经在 SDK core 中正式化 single-consume callback semantics，但 host route 仍要从不透明错误文本反推产品行为。iteration 119 通过在 React adapter boundary 暴露 typed callback-failure surface，并在 reference app 的 browser-owned callback route 上完成验证，补齐了这条 owner boundary 上的语义缺口。

### 2026-04-20 @securitydept/client/persistence 与 @securitydept/token-set-context-client/frontend-oidc-mode —— atomic single-consume callback state 正式下沉到 foundation persistence contract

**Discipline**: `stable-deprecation-first` 与 `provisional-migration-required`

**Subpath**: `@securitydept/client/persistence` 与 `@securitydept/token-set-context-client/frontend-oidc-mode`

**变更**：

browser-owned callback correctness contract 现在正式依赖 foundation 层的 single-consume capability，而不再建立在 app-level `load() + remove()` 近似之上。

- `RecordStore` 现在公开 `take(key)` capability，用于 store 一致性域内的 atomic read-and-remove
- 仓库内提供的内存、`localStorage` 与 `sessionStorage` store 都直接实现了这项能力
- `createEphemeralFlowStore()` 与 `createKeyedEphemeralFlowStore()` 在消费一次性 flow state 时，现已要求 `RecordStore.take()`
- `frontend-oidc-mode` 的 keyed pending callback state 现在把 duplicate replay、missing state、stale state 与 client mismatch 视为建立在该 consume contract 之上的正式 callback semantics

**迁移**：

1. 如果你提供自定义 `RecordStore`，并把它用于 `createEphemeralFlowStore()` 或 `createKeyedEphemeralFlowStore()`，请补上 `take(key)`，以一次 store-level step 完成读取和移除。
2. 不要再在宿主代码里通过 `get()` 再 `remove()` 的方式模拟 callback / redirect state 的 single-consume。
3. 如果你过去按一个固定 key 读取 frontend OIDC pending state，请迁移到 keyed pending-state 形状（`pending:${state}`），并把重复 callback replay 视为 `callback.duplicate_state`，而不是静默 no-op。

**理由**：

iteration 118 已把 browser-owned frontend OIDC flow 收口到 keyed pending state 与 duplicate callback detection，但高层 correctness contract 仍然踩在更弱的 `load() + remove()` 近似之上。把 consume primitive 下沉到 shared persistence contract，才是在正确 owner boundary 上补齐语义缺口。

### 2026-04-19 @securitydept/token-set-context-client-react 与 ./react-query —— canonical React token-set consumer path 收口到 keyed SDK owner

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/token-set-context-client-react` 与 `@securitydept/token-set-context-client-react/react-query`

**变更**：

canonical React token-set consumer path 现已端到端收口为 keyed 且 SDK-owned：

- `@securitydept/token-set-context-client-react` 新增 `useTokenSetBackendOidcClient(clientKey)`，作为 backend-oidc-specific 行为的正式 keyed lower-level accessor
- `@securitydept/token-set-context-client-react/react-query` 的 canonical groups / entries hooks 不再要求 adopter 显式传入 `client`
- reference app 不再把 app-local `BackendOidcModeReactClient`、`getTokenSetClient()` 或 `service.client as ...` narrowing 当作 canonical consumer story

**迁移**：

1. 将这类 canonical hook 调用：
   ```ts
   useTokenSetGroupsQuery({ clientKey, client })
   useTokenSetCreateGroupMutation({ clientKey, client })
   ```
   改为 keyed-only 调用：
   ```ts
   useTokenSetGroupsQuery({ clientKey })
   useTokenSetCreateGroupMutation({ clientKey })
   ```
2. 如果 React consumer 需要 `authorizeUrl()`、`authorizationHeader()`、`refresh()`、`clearState()` 这类 backend-oidc-specific 能力，用 `useTokenSetBackendOidcClient(clientKey)` 替代 app-local `service.client as ...` narrowing。
3. 让 app-local token-set 模块只保留 bootstrap config、trace sink、provider wiring 等 adopter glue，而不是继续承担 canonical consumer contract owner。

**理由**：

iteration 115 已把 token-set React Query 写路径迁回 SDK，但 canonical React consumer story 仍依赖 app-local client owner pattern。iteration 116 通过 keyed registry / service path 正式收口 consumer contract，并把 lower-level backend-oidc accessor 移入 SDK，结束了 `apps/webui` 对 canonical consumer shape 的持有。

### 2026-04-19 @securitydept/token-set-context-client-react/react-query —— canonical mutation owner 迁入 SDK subpath

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/token-set-context-client-react/react-query`

**变更**：

React Query subpath 现在除了既有读侧 helper 之外，也拥有 canonical token-set groups / entries mutation surface。

当前它已导出：

- groups / entries query hooks
- groups / entries mutation hooks
- 这些 hooks 所使用的 token-set management entity / request / response contract
- `groups` / `group` / `entries` / `entry` 的 query-key extension
- canonical groups / entries flow 的 post-mutation invalidation 语义

这也改变了 owner boundary：`apps/webui` 不再是 token-set React Query 写语义的 canonical owner，而是 SDK-owned surface 的 consumer / authority-evidence host。

**迁移**：

1. 将 app-local token-set React Query wrapper（如 `useTokenSetQueries.ts`）替换为从 `@securitydept/token-set-context-client-react/react-query` 直接导入。
2. 将 app-local `tokenSetAppQueryKeys.*` 替换为 `tokenSetQueryKeys.groups(...)`、`tokenSetQueryKeys.group(...)`、`tokenSetQueryKeys.entries(...)`、`tokenSetQueryKeys.entry(...)`。
3. 当 mutation 需要 request-scoped transport 或 cancellation 时，通过 mutation variables 上的 `requestOptions` 传入：
    ```ts
    mutation.mutate({
       name: "Operators",
       group_ids: ["group-1"],
       requestOptions: { cancellationToken },
    });
    ```

**理由**：

iteration 114 已在 `apps/webui` 中证明真实 mutation lifecycle 与 invalidation 语义，但继续把这些语义留在 app-local 会让 reference app 处在错误的 owner 位置。iteration 115 将 canonical groups / entries 写路径、实体契约以及 query-key / invalidation policy 收回 SDK subpath，从而让 React adopter 获得完整的 SDK-owned read/write story。

### 2026-04-12 React adapter 从同包 subpath 迁移到独立 npm 包（breaking move）

**Discipline**: `provisional-migration-required`

**已移除的旧 subpath**：

| 旧导入路径 | 新导入路径 |
|---|---|
| `@securitydept/basic-auth-context-client/react` | `@securitydept/basic-auth-context-client-react` |
| `@securitydept/session-context-client/react` | `@securitydept/session-context-client-react` |
| `@securitydept/token-set-context-client/backend-oidc-mode/react` | `@securitydept/token-set-context-client-react` |

**变更**：

三大家族（BasicAuth、Session、OIDC）的框架专用代码（React、Angular 以及对应的 Router adapter）均已彻底移出核心包。
- `@securitydept/basic-auth-context-client` 不再包含任何框架适配导出
- `@securitydept/session-context-client` 不再包含任何框架适配导出
- `@securitydept/token-set-context-client` 不再包含任何框架适配或其相关 Router adapter 导出

**迁移**：

1. 安装新的独立包：
   ```
   pnpm add @securitydept/basic-auth-context-client-react
   pnpm add @securitydept/session-context-client-react
   pnpm add @securitydept/token-set-context-client-react
   ```

2. 针对 React 使用者，全局替换 `from "@securitydept/.../react"` 为新独立包：
   - `from "@securitydept/basic-auth-context-client/react"` -> `from "@securitydept/basic-auth-context-client-react"`
   - `from "@securitydept/session-context-client/react"` -> `from "@securitydept/session-context-client-react"`
   - `from "@securitydept/token-set-context-client/backend-oidc-mode/react"` -> `from "@securitydept/token-set-context-client-react"`

3. 对于 Router adapter 用户，**不要**停在中间的 token-set framework 包；请直接遵循下方 2026-04-13 小节里的专用迁移：
   - TanStack Router -> `@securitydept/client-react/tanstack-router`
   - Angular Router -> `@securitydept/client-angular`

**理由**：

React adapter 与 Angular adapter 采用一致的独立包策略。Angular adapter 因需要 `ng-packagr` APF 构建，一开始就必须是独立包；为了对齐打包策略、避免混合 `tsdown` + `ng-packagr` 的 subpath 导出形态不一致，React adapter 同步迁移到独立包。独立包还带来更清晰的 `peerDependencies` 声明与更优的 tree-shaking 边界。

---

### 2026-04-23 session shared convenience 从 adapter-local glue 上提至 core owner

**Discipline**: `stable-deprecation-first`（core）+ `provisional-migration-required`（adapter）

**涉及包**：

- `@securitydept/session-context-client`
- `@securitydept/session-context-client-react`
- `@securitydept/session-context-client-angular`

**变更**：

framework-neutral 的 session browser-shell convenience 不再先长在 React adapter 私有层。

- `SessionContextClient` 现在正式拥有 `rememberPostAuthRedirect()`、`clearPostAuthRedirect()`、`resolveLoginUrl()` 与 `logoutAndClearPendingLoginRedirect()`
- `@securitydept/session-context-client-react` 现在改为包装这些 core 方法，而不是在 adapter 内部自行组合
- `@securitydept/session-context-client-angular` 现在也通过其 DI/signal service facade 暴露同一条 convenience story

**迁移**：

1. 在 framework-neutral 的 session browser-shell flow 中优先使用新的 core convenience 方法。
2. 将 React / Angular adapter 视为这些 core 方法的 thin host wrapper。
3. adapter 内只保留 DI、signal state、provider registration 与 host state wiring。

**理由**：

这些方法并不是 React-specific 行为，而是 canonical 的 session browser-shell convenience，因此应归于 core，避免 adapter parity 再次失真。

---

### 2026-04-22 reference app 内的 session/basic-auth thin-surface parity consolidation

**Discipline**: `provisional-migration-required`

**涉及包**：

- `@securitydept/session-context-client-react`
- `@securitydept/basic-auth-context-client`
- `@securitydept/basic-auth-context-client-react`

**变更**：

reference app（`apps/webui`）不再把本地浏览器 glue 当作 session/basic-auth flow 的主要 owner。

- app-local `src/api/auth.ts` session helper 模块已删除
- app-local `src/lib/basicAuth.ts` browser-boundary helper 模块已删除
- `SessionContextProvider` / `useSessionContext()` 现在接管 `/login`、`/playground/session` 与 dashboard shell 的 session login URL 解析、pending redirect 状态、user-info 获取与 logout flow
- `BasicAuthContextClient` 与 `BasicAuthContextProvider` / `useBasicAuthContext()` 现在接管 `/login` 与 `/playground/basic-auth` 的 Basic Auth login entry wiring 与 browser boundary consumption

**迁移**：

1. 用 `SessionContextProvider` + `useSessionContext()` 替换 app-local session glue。
2. 用 `BasicAuthContextClient` 与 `BasicAuthContextProvider` 替换 app-local Basic Auth login/boundary helper。
3. 继续保持 thin family 边界：不要在其上重复实现 token-set 的 callback orchestration、token persistence 或 bearer transport ownership。

**理由**：

这两条 family 仍然刻意比 token-set 更薄，但现在已经拥有真实 adopter-facing owner surface，而不是继续依赖未正式产品化的 reference-app glue。

---

### 2026-04-10 @securitydept/basic-auth-context-client — Config validation 废弃通知（阶段 1：warn）

**Discipline**: `stable-deprecation-first`
**Subpath**: `@securitydept/basic-auth-context-client` (`.`)
**变更**: `BasicAuthContextClient` constructor 现在通过 `BasicAuthContextClientConfigSchema` 在 runtime 校验 config。在此废弃阶段，invalid config 触发 `console.warn` 但 client 仍可构造。以下输入已被废弃，将在未来 minor release 中成为硬报错：
  - `zones: []`（空数组）— 将要求至少一个 zone
  - `zonePrefix: ""`（空字符串）— 将要求非空字符串
  - `baseUrl: ""`（空字符串）— 将要求非空字符串

**迁移**: 如果你的代码用空 `zones` 数组或空 `zonePrefix` / `baseUrl` 构造 `BasicAuthContextClient`，请在下一个 minor release 前添加至少一个有效 zone config。
**理由**: `BasicAuthContextClient` 没有 zone 或空路径前缀不会有任何功能行为。显式废弃通知防止 client 静默无操作的隐式 bug。

---

### 2026-04-13 Auth 编排原语 — owner 从 token-set 迁移至 @securitydept/client

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/token-set-context-client/orchestration`（局部变更 — planner 和 route orchestrator 已删除）

**新 canonical 位置**: `@securitydept/client/auth-coordination`

**变更**:

`RequirementPlanner`、`RouteRequirementOrchestrator` 及所有相关类型（`AuthRequirement`、`RouteMatchNode`、`PlanSnapshot`、`ResolutionStatus`、`PlanStatus` 等）已从 `@securitydept/token-set-context-client/orchestration` **删除**，现在只从 `@securitydept/client/auth-coordination` 提供。

同时，`RequirementKind` named constant 对象已完全移除。`AuthRequirement.kind` 现在是 opaque `string`；各 auth-context 或 adopter 项目应自行定义 named constants。

`@securitydept/token-set-context-client/orchestration` 仍然存在，继续导出 token-set-specific 的编排层内容：`AuthSnapshot`、`AuthSourceKind`、`bearerHeader`、`mergeTokenDelta`、`createAuthStatePersistence`、`createAuthorizedTransport`、`createAuthMaterialController`、`BaseOidcModeClient` 等。

**迁移**:

1. 替换 planner 和 orchestrator 的导入位置：
   ```diff
   - import { createRequirementPlanner, PlanStatus, ResolutionStatus } from "@securitydept/token-set-context-client/orchestration";
   - import { createRouteRequirementOrchestrator } from "@securitydept/token-set-context-client/orchestration";
   + import { createRequirementPlanner, PlanStatus, ResolutionStatus } from "@securitydept/client/auth-coordination";
   + import { createRouteRequirementOrchestrator } from "@securitydept/client/auth-coordination";
   ```

2. 将 `RequirementKind.xxx` 替换为字符串字面量：
   ```diff
   - import { RequirementKind } from "@securitydept/token-set-context-client/orchestration";
   - { id: "session", kind: RequirementKind.Session }
   - { id: "api-token", kind: RequirementKind.BackendOidc }
   + { id: "session", kind: "session" }
   + { id: "api-token", kind: "backend_oidc" }
   ```
   如果项目中大量使用这些常量，可定义本地 `const MyRequirementKind = { ... } as const` 对象。

3. 框架 adapter 用户（TanStack Router、Angular Router adapter）：`AuthRequirement` 和 `RouteMatchNode` 类型由 adapter 包重新导出，避免直接导入 orchestration 层。（注意：对于 adapter 包本身的 import，请遵照下方 2026-04-13 的迁移说明改用新的 canonical owner）。

**理由**:

`RequirementPlanner` 和 `RouteRequirementOrchestrator` 是与协议无关、跨 auth-context 的共享原语。其 `RequirementKind` 词汇（session、OIDC、custom）明显跨越 token-set 边界。将这些原语放在 `token-set-context-client` 是错误归属，导致 basic-auth、session 等非 token-set adopter 不得不依赖 token-set 包才能使用共享编排能力。迁移到 `@securitydept/client`（所有 auth-context family 共享的 foundation 层）建立了正确的所有权边界。

---

### 2026-04-13 路由 adapter 归属迁移 — 从 token-set 家族迁移到共享 framework adapter owner

**Discipline**: `provisional-migration-required`

**已移除 canonical 归属的包**：
- `@securitydept/token-set-context-client-react/tanstack-router`（TanStack Router 投影）
- `@securitydept/token-set-context-client-angular`（Angular Router 投影，`TokenSetRouterAdapter`）

**新 canonical 位置**：

| 旧导入路径 | 新导入路径 | 重命名 |
|---|---|---|
| `@securitydept/token-set-context-client-react/tanstack-router` | `@securitydept/client-react/tanstack-router` | — |
| `@securitydept/token-set-context-client-angular`（路由类型） | `@securitydept/client-angular` | `TokenSetRouterAdapter` → `AuthRouteAdapter`；`TokenSetRouterAdapterOptions` → `AuthRouteAdapterOptions` |

**变更**：

将路由 adapter 的通用逻辑（将框架路由树投影为 `RouteMatchNode[]`）从 token-set 框架 adapter 包中提取，重新归属到新的共享 framework adapter owner：

- `@securitydept/client-react/tanstack-router` — canonical TanStack React Router adapter：
  - `projectTanStackRouteMatches()`（API 不变）
  - `createTanStackRouteActivator()`（API 不变）
  - `TanStackRouteMatch` / `TanStackRouterAdapterOptions`（形状不变）
  - `DEFAULT_REQUIREMENTS_KEY`（值不变）

- `@securitydept/client-angular` — canonical Angular Router adapter：
  - `AuthRouteAdapter` injectable service（原 `TokenSetRouterAdapter` 重命名）
  - `AuthRouteAdapterOptions`（原 `TokenSetRouterAdapterOptions` 重命名）
  - `RouteGuardResult`（不变）
  - `DEFAULT_ROUTE_REQUIREMENTS_KEY`（不变）

**兼容 re-export**（过渡期）：

短暂存在的兼容 re-export（`@securitydept/token-set-context-client-react/tanstack-router` 和 `@securitydept/token-set-context-client-angular` 的路由 adapter 部分）已在本次迭代中完全移除。只有新的 canonical 包保留。

**迁移**：

1. TanStack Router 用户：
   ```diff
   - import { projectTanStackRouteMatches, createTanStackRouteActivator } from "@securitydept/token-set-context-client-react/tanstack-router";
   + import { projectTanStackRouteMatches, createTanStackRouteActivator } from "@securitydept/client-react/tanstack-router";
   ```

2. Angular Router 用户：
   ```diff
   - import { TokenSetRouterAdapter } from "@securitydept/token-set-context-client-angular";
   + import { AuthRouteAdapter } from "@securitydept/client-angular";
   ```
   然后全局替换：`TokenSetRouterAdapter` → `AuthRouteAdapter`，`TokenSetRouterAdapterOptions` → `AuthRouteAdapterOptions`。

**理由**：

将框架路由树投影为 `RouteMatchNode[]` 是纯粹的 framework glue，不含任何 token-set 特有逻辑。将其放在 token-set 家族包中，会迫使只需要 auth 编排能力（session、basic-auth）的 adopter 对 token-set 产生不必要的依赖。迁移到 `@securitydept/client-react` 和 `@securitydept/client-angular` 建立了正确的所有权边界：framework adapter 包只拥有框架 glue，token-set 家族只拥有其 token-set 策略和映射逻辑。

---

### 2026-04-14 Angular Router auth canonical path：route-metadata + full-route aggregation（破坏性变更）

**规范**：`provisional-migration-required`

**受影响子路径**：
- `@securitydept/token-set-context-client-angular` — `createTokenSetAuthGuard()` 从公开接口移除；`createTokenSetRouteAggregationGuard()` 通过 `requirementPolicies` 扩展能力
- `@securitydept/client-angular` — 新增 signal 桥接工具（`bridgeToAngularSignal`、`signalToObservable`）
- `@securitydept/client` — `ReadableSignalTrait` 是 SDK signal 的 canonical contract

**变更**：

Angular Router auth canonical path 已统一为 route-metadata + full-route aggregation：

1. `createTokenSetAuthGuard()` **已从公开接口移除**。`createTokenSetRouteAggregationGuard()` 是唯一 canonical guard，通过 `requirementPolicies` 完整吸收了旧 guard 的全部能力。
2. `requirementPolicies`（以 `requirement.id` 为 key）支持 per-requirement 覆盖：
   - `selector: { clientKey }` 或 `selector: { query: ClientQueryOptions }` — 覆盖默认 kind→client 映射
   - `onUnauthenticated` — per-requirement 重定向/阻断策略（优先于 `requirementHandlers[kind]` 和 `defaultOnUnauthenticated`）
3. signal 桥接工具（`bridgeToAngularSignal`、`signalToObservable`）从 `@securitydept/token-set-context-client-angular` 迁移到 `@securitydept/client-angular`。本地的 `SdkReadableSignal` 类型已删除；canonical 类型改为 `@securitydept/client` 的 `ReadableSignalTrait`。

**迁移**：

1. 将 `createTokenSetAuthGuard` 替换为 `createTokenSetRouteAggregationGuard`：
   ```diff
   - import { createTokenSetAuthGuard } from "@securitydept/token-set-context-client-angular";
   + import { createTokenSetRouteAggregationGuard } from "@securitydept/token-set-context-client-angular";

   - createTokenSetAuthGuard({
   -   clientOptions: {
   -     selector: { clientKey: "confluence" },
   -     requirementId: "confluence-oidc",
   -     requirementKind: "frontend_oidc",
   -     onUnauthenticated: () => "/auth/confluence",
   -   },
   - })
   + createTokenSetRouteAggregationGuard({
   +   requirementPolicies: {
   +     "confluence-oidc": {
   +       selector: { clientKey: "confluence" },
   +       onUnauthenticated: () => "/auth/confluence",
   +     },
   +   },
   + })
   ```

2. 更新 signal 桥接导入：
   ```diff
   - import { bridgeToAngularSignal, signalToObservable, SdkReadableSignal } from "@securitydept/token-set-context-client-angular";
   + import { bridgeToAngularSignal, signalToObservable } from "@securitydept/client-angular";
   + import type { ReadableSignalTrait } from "@securitydept/client";
   ```

**理由**：

`createTokenSetAuthGuard` 与 `createTokenSetRouteAggregationGuard` 并存为公开路径，会让 adopter 在两条能力不对等的路线之间做选择。`requirementPolicies` 已完整覆盖旧 guard 的全部表达能力，因此旧 guard 从公开接口移除。signal 桥接工具不属于 token-set 特有能力，canonical owner 应为通用 framework 层（`@securitydept/client-angular`）。

---

### 2026-04-13 createTokenSetAuthGuard 重新设计为 planner-host 架构（已被上方迭代取代）

**纪律**: `provisional-migration-required`

**受影响的子路径**：
- `@securitydept/token-set-context-client-angular` — guard 工厂
- `@securitydept/client/auth-coordination` — 新增 planner-host 合约
- `@securitydept/client-angular` — 新增 planner-host DI providers
- `@securitydept/client-react` — 新增 planner-host Context providers（新增 `.` 根导出）

**变更**：

`createTokenSetAuthGuard()` API 已完全重新设计。旧的判别联合（`query` / `clientKey` / `fromRoute`）已被新的 `clientOptions` + `plannerHost` 架构替代：

- 旧：`createTokenSetAuthGuard({ clientKey: "main", onUnauthenticated: ... })`
- 新：`createTokenSetAuthGuard({ clientOptions: { selector: { clientKey: "main" }, requirementId: "main-auth", requirementKind: "frontend_oidc", onUnauthenticated: ... } })`

此外，现在必须提供 `PlannerHost` — 通过 Angular DI 提供（`provideAuthPlannerHost()`）或内联传入。

**迁移**：

1. 在 app 配置中添加 planner-host provider：
   ```ts
   import { provideAuthPlannerHost } from "@securitydept/client-angular";

   export const appConfig: ApplicationConfig = {
     providers: [provideAuthPlannerHost()],
   };
   ```

2. 更新 guard 调用：
   ```diff
   - createTokenSetAuthGuard({
   -   clientKey: "confluence",
   -   onUnauthenticated: (failing) => "/login",
   - })
   + createTokenSetAuthGuard({
   +   clientOptions: {
   +     selector: { clientKey: "confluence" },
   +     requirementId: "confluence-oidc",
   +     requirementKind: "frontend_oidc",
   +     onUnauthenticated: (failing) => "/login",
   +   },
   + })
   ```

3. `fromRoute` 用户：替换为每个路由的显式 `clientOptions` 声明。需求元数据（id、kind）现在在 guard 层声明，而非嵌入在 route data 中。

4. `query` 用户：在每个 `clientOption` 内使用 `selector: { query: ... }`。

**理由**：

旧 guard API 将客户端解析与认证决策混为一体。新的 planner-host 架构分离关注点：
- Client options 声明检查什么以及如何反应
- planner-host 做协调决策（选择哪个候选项执行）
- 自定义选择策略（如选择器 UI）可插拔，无需修改 guard 代码
- 框架特定的 planner host providers（Angular DI、React Context）支持基于作用域的覆盖

### 2026-04-13 Angular 构建拓扑切换为 pnpm 递归（非破坏性）

**纪律**: `provisional-migration-required`

**变更**：根 `sdks/ts` 构建脚本现在使用 `pnpm -r --filter './packages/*' run build` 替代手动的 `build:core && build:angular`。Angular workspace 依赖现在在 `devDependencies` 中镜像 `workspace:*` `peerDependencies`，使 pnpm 能自动计算正确的构建拓扑。

**迁移**：消费者无需任何变更。`build:core` 和 `build:angular` 仍作为快捷方式保留。

### 2026-04-13 @securitydept/client-react 新增根导出和 react peerDependency

**纪律**: `provisional-migration-required`

**子路径**：`@securitydept/client-react`（`.`）

**变更**：`@securitydept/client-react` 现在导出一个根入口（`.`），提供 React planner-host 集成（`AuthPlannerHostProvider`、`useAuthPlannerHost` 等）。React 现在是必需的 `peerDependency`。`./tanstack-router` 子路径继续可用，其现有的投影层 API（`projectTanStackRouteMatches`、`createTanStackRouteActivator`）保持不变；但在后续迭代中新增了完整 route-security contract（见下方）。

**迁移**：确保项目中安装了 `react >= 18.0.0`。纯投影用途的 `./tanstack-router` 用户在本次迭代中无需更改导入。

---

### 2026-04-15 @securitydept/client-react/tanstack-router — route-security contract 升级（additive + canonical 入口变更）

**纪律**：`provisional-migration-required`

**子路径**：`@securitydept/client-react/tanstack-router`

**变更**：

`./tanstack-router` 子路径已获得完整 route-security contract，与 Iteration 106 建立的 Angular `secureRouteRoot()` / `secureRoute()` 模式对等。这是一个**纯 additive** 变更 — 所有现有投影层 API 保持不变 — 但 **canonical adopter-facing 入口已经改变**：

| 变更前（Iteration 103） | 变更后（Iteration 107） |
|---|---|
| 无 canonical adopter 入口；adopter 需手动组合 `projectTanStackRouteMatches()` + 自定义 `beforeLoad` | `createSecureBeforeLoad()` 是 canonical adopter-facing beforeLoad factory |
| `withTanStackRouteRequirements()` 存在但无 router 执行 glue | child route 用 `withTanStackRouteRequirements()`，root route 用 `createSecureBeforeLoad()` |
| `createTanStackRouteSecurityPolicy()` 是最高层入口 | `createTanStackRouteSecurityPolicy()` 现为下层 primitive（headless evaluator） |

新的 canonical adopter-facing 模式：

```ts
import { redirect, createRootRoute, createRoute } from "@tanstack/react-router";
import {
  createSecureBeforeLoad,
  withTanStackRouteRequirements,
} from "@securitydept/client-react/tanstack-router";

// Root route：不可序列化 runtime policy
const rootRoute = createRootRoute({
  beforeLoad: createSecureBeforeLoad({
    redirect,                                              // TanStack Router 的 redirect()
    checkAuthenticated: (req) => authStore.isAuthenticated(req.kind),
    requirementHandlers: {
      frontend_oidc: (req) => `/login/oidc?returnTo=${req.id}`,
    },
    defaultOnUnauthenticated: () => "/login",
  }),
});

// Child routes：仅可序列化声明
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "dashboard",
  staticData: withTanStackRouteRequirements([{ id: "session", kind: "session" }]),
});
```

新增导出：
- `createSecureBeforeLoad(options)` — 根级 beforeLoad factory
- `RouteSecurityBlockedError` — 导航被 hard-block 时抛出
- `SecureBeforeLoadContext` — beforeLoad 上下文最小 shape
- `CreateSecureBeforeLoadOptions` — `createSecureBeforeLoad` 的选项类型

保持不变的现有导出（作为下层 primitive 继续可用）：
- `projectTanStackRouteMatches()` — 用于 `RouteMatchNode[]` 投影
- `createTanStackRouteActivator()` — 用于 orchestrator lifecycle bridge
- `createTanStackRouteSecurityPolicy()` — headless evaluator（用于自定义集成）
- `withTanStackRouteRequirements()` — 路由声明 helper（无变化）
- `extractTanStackRouteRequirements()` — 全路径聚合（无变化）

**迁移**：

**仅投影的用户**（只使用 `projectTanStackRouteMatches` + `createTanStackRouteActivator` 进行 `RouteRequirementOrchestrator` 集成）：**无需任何操作**。这些 API 保持不变。

**route-security adopter**（之前手动使用 `createTanStackRouteSecurityPolicy().evaluate()` 组装 `beforeLoad`）：升级到 `createSecureBeforeLoad()` 以使用 canonical 模式：

```diff
- // 旧：手动组装
- const policy = createTanStackRouteSecurityPolicy({ requirementHandlers: { ... } });
- const rootRoute = createRootRoute({
-   beforeLoad: ({ matches }) => {
-     const result = policy.evaluate(matches, checkAuthenticated);
-     if (!result.allMet && typeof result.action === "string") {
-       throw redirect({ to: result.action });
-     }
-   },
- });
+ // 新：canonical 入口
+ const rootRoute = createRootRoute({
+   beforeLoad: createSecureBeforeLoad({
+     redirect,
+     checkAuthenticated,
+     requirementHandlers: { ... },
+   }),
+ });
```

**理由**：

之前（只有 headless `createTanStackRouteSecurityPolicy()`）每个 adopter 都需要手动将 `evaluate()` 结果接入 TanStack Router 的 redirect/throw 语义，重复相同的 glue 代码。`createSecureBeforeLoad()` 将这一 wiring 封装在 SDK 层，与 Angular 的 `secureRouteRoot()` 深度对等，并建立了可测试（无需 framework mock）的正式 canonical 入口。

---

### `TokenSetClientEntry.clientFactory` 现在接受异步返回（iteration 108）

**包**：`@securitydept/token-set-context-client-angular`、`@securitydept/token-set-context-client`

**Breaking change 级别**：Minor（additive — 新增重载，旧同步用法不变）

**变更内容**：

1. `TokenSetClientEntry.clientFactory` 类型从 `() => OidcModeClient & OidcCallbackClient` 拓宽为 `() => ... | Promise<...>`
2. `TokenSetAuthRegistry.register()` 新增 TypeScript 重载：同步 factory → `TokenSetAuthService`，异步 factory → `Promise<TokenSetAuthService>`
3. 新增 readiness API：`registry.isReady(key)`、`registry.readinessState(key)`、`registry.whenReady(key)`
4. 新增 core contract：`resolveConfigProjection()`、`networkConfigSource()`、`ConfigProjectionSourceKind`、`ClientReadinessState`（位于 `@securitydept/token-set-context-client/frontend-oidc-mode`）

**迁移**：

```diff
- // 旧：编译时 config，同步 clientFactory
- clientFactory: () => createFrontendOidcModeClient({
-   issuer: environment.OIDC_ISSUER,
-   clientId: environment.OIDC_CLIENT_ID, ...
- }, runtime),

+ // 新：后端驱动 config，异步 clientFactory
+ import { resolveConfigProjection, networkConfigSource }
+   from "@securitydept/token-set-context-client/frontend-oidc-mode";
+ clientFactory: async () => {
+   const resolved = await resolveConfigProjection([
+     networkConfigSource({ apiEndpoint, redirectUri }),
+   ]);
+   return createFrontendOidcModeClient(resolved.config, runtime);
+ },
```

**主执行路径迁移**（guard、callback、interceptor）：

`createTokenSetRouteAggregationGuard` — 使用 `whenReady()` （路由 guard 阻塞直到就绪）：
```diff
- // 旧：直接 require()，client 未物化时抛出
- const entries = clientKeys.map(key => ({ service: registry.require(key), ... }));

+ // 新：等待 async factory，首次导航安全
+ const entries = await Promise.all(
+   clientKeys.map(async key => ({ service: await registry.whenReady(key), ... }))
+ );
```

`CallbackResumeService.handleCallback()` — 使用 `whenReady()` （callback 页面等待 client 就绪）：
```diff
- const service = this.registry.require(clientKey);

+ // 新：callback 页面加载时 client 如仍在初始化则等待
+ const service = await this.registry.whenReady(clientKey);
```

Bearer interceptor — **不**使用 `whenReady()`（显式放行设计）：
```
// interceptor 刻意使用 registry.get()，而非 whenReady()。
// client 尚未就绪时请求正常放行（无 Authorization header）。
// 正确设计：guard 负责强制"client 必须就绪"；interceptor 不应死锁 HTTP。
const token = key ? (registry.get(key)?.accessToken() ?? null) : registry.accessToken();
```

**理由**：

编译时硬编码的 OIDC 凭证阻止了 backend-driven config projection。异步 `clientFactory` + `resolveConfigProjection()` 将 config ownership 移交后端。readiness API（`whenReady`）为路由 guard 和 callback handler 提供正式的异步客户端物化等待机制。Interceptor 刻意使用 `get()`（而非 `whenReady`）以避免初始化阶段的 HTTP 死锁。

### Iteration 110 — 共享多客户端注册核心、React 19 产品化、原生 Web Router、多客户端懒初始化

**范围：** 跨 React / Angular / 原生 Web 的多客户端认证产品化；抽出 framework-neutral registry 核心；Navigation API 优先的路由 baseline；`primary | lazy` 客户端生命周期与 idle 预取正式化。

**稳定性：** 所有新表面以 `provisional`（provisional-migration-required）发布。

**新增公共表面**

| 包 | Subpath | 用途 |
|---|---|---|
| `@securitydept/client` | `./web-router` | 原生 Web 路由 baseline（`createNavigationAdapter`、`createWebRouter`、`isNavigationApiAvailable`、`NavigationAdapterKind`、`WebRouteDefinition`、`WebRouteMatch`、`WebRouteMatcher`、`WebRouter`、`defineWebRoute`、`extractFullRouteRequirements`、`RequirementsClientSetComposition`）。Navigation API 优先，History API + `popstate` 回退；全路径 requirement 聚合（`inherit` / `merge` / `replace` 合成）已与 Angular / TanStack Router adapter 对齐（review-1 跟进）。 |
| `@securitydept/token-set-context-client` | `./registry` | Framework-neutral 多客户端注册核心（`createTokenSetAuthRegistry`、`TokenSetAuthRegistry`、`ClientInitializationPriority`、`ClientReadinessState`、`OidcModeClient`、`OidcCallbackClient`、`ClientMeta`、`TokenSetClientEntry`、`ClientQueryOptions`）。shared managed OIDC client contract owner 现也正式落在这里，而不再由 Angular / React adapter 各自重复定义。 |
| `@securitydept/token-set-context-client-react` | `./react-query` | token-set React Query consumer subpath，覆盖 canonical groups / entries 读写 workflow（`tokenSetQueryKeys`、`useTokenSetReadinessQuery`、`useTokenSetAuthorizationHeader`、`invalidateTokenSetQueriesForClient`、query hooks、mutation hooks 以及 token-set management contract）。**非独立包**：`@tanstack/react-query` 为 optional peer。 |
| `@securitydept/token-set-context-client-react` | `.`（additive） | `TokenSetAuthService`、`TokenSetAuthProvider`、`useTokenSetAuthRegistry` / `useTokenSetAuthService` / `useTokenSetAuthState` / `useTokenSetAccessToken` / `useTokenSetCallbackResume`、`CallbackResumeState`、`CallbackResumeStatus`、`TokenSetCallbackComponent`（保留 `TokenSetCallbackOutlet` 兼容别名）。与 Angular 对等的 React 多客户端形态。Callback hook 在调用 `handleCallback()` 前 await `registry.whenReady(clientKey)`，async / lazy client 的 callback 不再被静默丢弃（review-1 跟进）。 |

**Breaking migrations**

1. **Angular `TokenSetAuthRegistry.register()` 不再接受 `DestroyRef` 参数。** Registry 在构造时通过 `inject()` 自行获取 `DestroyRef` 并绑定一次 teardown。在注入上下文之外直接实例化（单元测试）时，需要手动调用 `registry.dispose()`。
   ```diff
   - registry.register(entry, destroyRef);
   + registry.register(entry);
   ```
   `new TokenSetAuthService(client, destroyRef, autoRestore)` 同步改为 `new TokenSetAuthService(client, autoRestore)`。

2. **`ClientMeta` 新增必填字段 `priority: "primary" | "lazy"`。** 显式构造 `ClientMeta` 字面量时必须提供该字段；`register()` 调用点不受影响，默认值保持 `"primary"` 以保留 iteration-109 行为。

3. **React 19 peer uplift。** `@securitydept/*-react` 包声明 `peerDependencies: { "react": ">=19.0.0" }`。React 18 adopter 必须留在 iteration 109 或升级后再拉 iteration 110。

4. **Registry `require()` 错误字符串顺序调整。** 从 `No client registered (and ready) for key "X"` 改为 `No client registered for key "X" (and ready)`。依赖该字符串正则断言的 adopter 可能需要更新。

**生态集成策略（管理层裁决）**

React 生态集成（React Query、未来可能的 Zustand / Jotai / TanStack Query v6 桥等）**不得**以独立包发布。它们以 **subpath** 形式落在 React 主包内，对应 runtime 库以 `optional` peer dependency 声明，并在宿主包 `devDependencies` 中镜像以便类型检查。未导入 subpath 的消费者不承担任何成本。该规则对后续迭代具有约束力。

**新增证据**

- `examples/web-router-navigation-api.test.ts` —— 含 JSDOM polyfill 的 Navigation API 路径
- `examples/web-router-history-fallback.test.ts` —— History API + `popstate` 回退路径
- `examples/web-router-full-route-aggregation.test.ts` —— 嵌套路由 + `inherit` / `merge` / `replace` 合成 + 单次 `plannerHost.evaluate()` 收到完整聚合候选集（review-1 跟进）
- `examples/multi-client-lazy-init-contract.test.ts` —— framework-neutral `priority | preload | whenReady | idleWarmup | reset` 契约
- `examples/react-multi-client-registry-baseline.test.ts` —— React provider + hooks 多客户端注册与释放
- `examples/react-query-integration-evidence.test.ts` —— React Query subpath canonical query + mutation consumer 语义
- `examples/react-callback-async-readiness.test.ts` —— `useTokenSetCallbackResume` / `TokenSetCallbackComponent`（兼容别名 `TokenSetCallbackOutlet`）通过 `registry.whenReady()` 驱动 async / lazy client 物化，覆盖 pending + error 暴露（review-1 跟进）

**后续 additive 更新（iteration 121）**

- `@securitydept/client` root 现在还拥有最小 structured trace consumption primitive：`createTraceTimelineStore()` 以及 `TraceTimelineStore` / `TraceTimelineEntry` contract。该变更为 additive，继续落在既有 stable root surface 上。
- `@securitydept/token-set-context-client/frontend-oidc-mode` 现在导出 `FrontendOidcModeTraceEventType`，把 popup / callback / refresh / user-info 的 browser-flow trace taxonomy 显式化、可复用化，而不再要求 adopter 自己硬编码原始 event string。
- `apps/webui` 的 frontend-mode host 现在直接消费这条共享 trace feed，browser e2e 也通过 structured trace marker 断言 popup relay 与 cross-tab hydrate / clear，而不再只依赖 incidental status text。

**后续 additive 更新（iteration 122）**

- `@securitydept/client` root 现在还拥有共享的 host-facing error presentation contract：`ErrorPresentationDescriptor`、`ErrorPresentationTone` 与 `readErrorPresentationDescriptor()` 负责把 machine-facing runtime error 桥接为稳定的 host-facing recovery / presentation descriptor，而不再要求 adopter 解析 `error.message`。
- `@securitydept/token-set-context-client/frontend-oidc-mode` 现在导出 `describeFrontendOidcModeCallbackError()`，把 callback-specific host wording 与 restart guidance 保留在 family owner 内，同时继续建立在共享 descriptor contract 之上。
- `@securitydept/token-set-context-client-react` 现在在 `CallbackResumeErrorDetails` 上直接暴露 `presentation`，browser-owned callback host 因此可以直接渲染同一条共享 descriptor surface。
- `apps/webui` 现在已在 frontend callback route、frontend popup failure handling、backend-mode refresh / clear failure 上消费这条共享 presentation contract，browser e2e 也开始通过稳定的 `data-error-*` marker 断言这些结果，而不再只依赖页面文案。

**Reference-app authority 更新（非 breaking）**

- iteration 117 将 `apps/webui` / `apps/server` 之前笼统的 token-set 宿主路径拆成两条显式 reference mode：
   - backend mode：`/auth/token-set/backend-mode/*` 与 `/playground/token-set/backend-mode`
   - frontend mode：`/api/auth/token-set/frontend-mode/config`、`/playground/token-set/frontend-mode` 与 `/auth/token-set/frontend-mode/callback`
- `TokenSetCallbackComponent` 现在只通过 frontend-mode callback route 获得真实宿主 authority
- dashboard bearer integration 与 TanStack route security 现在同时覆盖两条 token-set mode，且没有新增任何公开的 React secure-guard surface

---

[English](../en/110-TS_SDK_MIGRATIONS.md) | [中文](../zh/110-TS_SDK_MIGRATIONS.md)
