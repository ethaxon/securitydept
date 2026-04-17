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
