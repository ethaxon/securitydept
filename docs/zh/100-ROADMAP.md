# 路线图

本路线图只负责描述：

- 当前优先级
- `0.2.0` backlog
- 延期到 `0.3.0` 的主题
- 哪些方向应继续投入、哪些方向当前不应抢主线

它**不**负责：

- 解释 auth context / mode 的概念分层：见 [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)
- 罗列当前 TS public package / subpath capability 快照：见 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)
- 记录具体迁移史：见 [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)

本路线图与当前项目目标保持一致：将 SecurityDept 转变为面向网格的认证和授权工具包，`apps/server` 作为试验场。

## 阶段 1：底层验证和提供者层

1. 完成并加强底层 creds 验证
   - 基础认证
   - 静态令牌
   - RFC 9068
   - JWT / JWE 助手
2. 完成并加强共享 provider runtime
   - discovery refresh
   - JWKS refresh
   - introspection reuse
   - 严格的 metadata 解析行为

状态：

- 大部分已实现

## 阶段 2：令牌获取和验证层

3. 加强 `securitydept-oidc-client`
   - callback flow
   - refresh
   - claims normalization
   - 面向下游 auth-context mode 的可复用接口
4. 加强 `securitydept-oauth-resource-server`
   - JWT / JWE / opaque 验证
   - policy 配置
   - 共享 provider 复用
   - 显式 principal extraction

状态：

- 大部分已实现

## 阶段 3：认证上下文模式

5. 实现 basic-auth zone mode
   - 后端路由 helper
   - 文档化 flow
   - 轻量 client helper，用于 zone-aware `401 -> login` redirect 与 logout URL 处理
6. 实现 cookie-session mode
   - 可复用的后端 auth-context extraction
   - 规范化 principal shape
   - 可选 redirect helper SDK
7. 实现无状态 token-set mode
   - token snapshot / delta 与 metadata snapshot / delta
   - 前端 token lifecycle 规则
   - 多 provider token 管理
   - same-resource forwarding 的 bearer propagation policy
   - 可选的未来 token-exchange hook

状态：

- basic-auth zone：已文档化，但尚未完全产品化
- cookie-session：reference implementation 已存在；可复用核心已位于 `securitydept-session-context`；route-facing services（`SessionAuthServiceTrait` / `OidcSessionAuthService` / `DevSessionAuthService`）现已通过 `service` feature 直接归属于该 crate
- stateless token-set mode：核心 server 与 shared crate 已就位；`securitydept-auth-runtime` 已解散；mode-specific 与 substrate-specific service 已归入 `securitydept-token-set-context`；`frontend-oidc` 现已拥有正式的 `Config / ResolvedConfig / ConfigSource / Runtime / Service / ConfigProjection`；跨 preset 共享的 OIDC 协议级 principal extraction 已位于 `securitydept-oidc-client::auth_state`；`backend-oidc` 已统一为单一 capability framework，不同能力组合通过 preset / profile 表达；mixed-custody / BFF / server-side token-set 仍留在后续范围

## 阶段 4：前端 SDK

8. 提供轻量 TypeScript SDK
   - basic auth zone helper，用于 zone 边界识别、`401 -> login` redirect 和 logout redirect
   - cookie-session redirect helper
   - stateless token-set SDK，用于 token storage、header injection、后台 refresh 和 login redirect

状态：

- TypeScript SDK 已不再只是架构草案；foundation packages、auth-context roots、`./web` adapter、React adapter 与 reference-app dogfooding baseline 均已实现
- 仓库内已经具备 external-consumer scenario、token-set web-focused lifecycle baseline，以及最小 React-adapter-focused test
- 当前阶段不再是“开始实现 SDK”，而是对 `stable / provisional / experimental` 进行 contract freeze、明确 token-set v1 scope，并收紧 adopter-facing status
- mixed-custody、stateful BFF、server-side token-set，以及更重的 OTel / DI 主题，仍属于后续阶段，而不是当前前端 SDK 主线

参考：

- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

## 当前优先级队列

上面的阶段划分仍然有价值，但它已经不再准确描述项目当前真正的瓶颈。当前最大的风险不再是“还差一个功能没做”，而是 public SDK contract、adopter 预期与 reference-app 验证之间的方向漂移。

因此，当前优先级应按以下方式理解：

### 优先级 0：把 TypeScript SDK 的冻结语义变成可执行的 release gate

为什么排第一：

- 仓库里已经有真实的 TS SDK 代码、adapter 与 adopter-facing docs
- 当前最大的剩余风险不是实现量，而是 surface drift
- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) 已定义 `stable / provisional / experimental`，但 roadmap 层的执行标准此前不够明确

这里曾经缺少、但现在已经基本收口的是：

- 覆盖 root export 与 subpath 的 authoritative public-surface inventory
- 由 public-surface tests、example coverage 与 docs alignment 支撑的 promotion / freeze gate
- 面向 TS SDK contract 的轻量 0.x breaking-change / migration discipline

### 优先级 1：用真实下游 adopter 验证 SDK，而不只依赖仓库内 demo

为什么排第二：

- `apps/webui` 是有价值的 dogfooding，但它仍然是仓库内 reference app
- 项目已经承认 `outposts` 是高价值的真实 adopter case，但这点过去在 roadmap 中表达得不够强
- 很多后续决策都依赖真实 adopter 证据：multi-integration layout、route-level auth orchestration、browser/runtime 假设、以及 owner boundary

这条优先级应验证：

- single-host / multi-backend token family
- route-level requirement orchestration 与 failure policy 边界
- SDK primitives 与 adopter app glue 的更清晰分界
- Angular / React framework adapter 应由 `securitydept` 自己的领域语义与 ergonomics 主导，而不是照抄 adopter 当前 auth module 的形状

### 优先级 2：先收口 browser-owned token-set v1 baseline，再讨论扩大范围

为什么它仍是高优先级：

- 文档已经明确当前 token-set 方向是 browser-owned v1 baseline
- 经重审后，只有 mixed-custody / BFF / server-side token ownership 被明确延期到 `0.3.0`
- popup login、cross-tab lifecycle hardening，以及 matched-route 多资格 orchestration baseline 现在都已实现；更真实的剩余工作是 framework-level adapter、真实 provider integration 与下游 adopter 校准
- 如果 roadmap 层不持续提醒，这些真正延期到 `0.3.0` 的项与仍需纳入 `0.2.0` 的 backlog 很容易在日常实现讨论中重新混淆

这里需要继续明确：

- 在当前 token-set baseline 被视为 v1-ready external contract 之前，还需要哪些证据
- 哪些剩余 hardening topic 仍属于 browser-owned baseline
- 哪些相邻主题属于 `0.2.0` backlog，哪些才是明确延期到 `0.3.0`
- 真实 framework adapter 与 downstream integration proof 应如何进入 authority layer，而不是只停留在 guide 或 adopter 代码中

### 优先级 3：恢复三条 auth-context client surface 的产品面对齐

为什么这是当前规划中的空洞：

- token-set SDK 的推进速度明显快于另外两条 auth-context client surface
- roadmap 仍提 basic-auth 与 cookie-session helper，但没有把这件事明确成“当前存在的不平衡”
- 如果持续放任，项目会很容易演变成：一条 TS product surface 很完整，另外两条只是“文档已写但未同等产品化”

当前需要持续观察的 parity gap：

- `basic-auth-context-client` 虽然应保持 thin，但仍需要更清晰的 productized baseline
- `session-context-client` 在 root contract 层已稳定，但 adopter-facing helper story 仍明显轻于 token-set

### 优先级 4：把 public-surface governance 与 release discipline 正式写进项目文档

为什么这条独立于优先级 0：

- 优先级 0 关注的是 SDK freeze 作为执行 gate
- 这里关注的是让未来的决策者与实施者仍能持续读懂整个项目

文档层需要明确：

- 一段紧凑、可引用的 roadmap-level current strategic priorities 声明
- 对“已实现”“可对外解释”“可晋升 stable”三者的更清晰区分
- 项目级预期：roadmap、SDK guide、examples 与 exported surface 必须一起移动

### 优先级 5：在 TS surface 尚未收稳前，明确压住非 TS 扩张

为什么这条需要直接写出来：

- Kotlin 与 Swift 仍在文档中作为未来 SDK 方向存在
- 这作为长期架构方向没有问题
- 但在 TypeScript surface 尚未冻结到足以承担 reference contract 之前，不应让跨语言扩张分散 roadmap 注意力

当前经验法则：

- TypeScript 继续作为唯一 active SDK productization track
- Kotlin / Swift 继续作为后续工作，等 TS external contract 足够清晰后再推进

## 0.2.0 发布 backlog（基于 Client SDK 重审）

除非某个主题在下方被**明确延期到 `0.3.0`**，否则 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) 中仍被写为产品目标、但尚未完成的内容，都应视为 **`0.2.0` release backlog**，而不再是模糊的“以后再说”。

这里对 `0.2.0` 的要求不是“绝对做满”，而是：

- 至少有基础实现
- adopter-facing 形状可解释
- 至少存在一条有意义的验证路径（测试、example 或 reference-app 证据）

当前 `0.2.0` backlog 优先级如下：

1. **TS SDK 冻结与 release-gate 纪律**
   - ~~authoritative public-surface inventory~~（已实现：`public-surface-inventory.json` 覆盖所有 package、subpath、stability、evidence 与 docs anchor）
   - ~~与 docs、examples、public-surface tests 绑定的 promotion / freeze gate~~（已实现：`release-gate.test.ts` 校验 export 对齐、evidence 存在、docs anchor、stability 与完整性）
   - ~~轻量 0.x breaking-change / migration discipline~~（已实现：inventory 中的 `changeDiscipline` 字段、`110-TS_SDK_MIGRATIONS.md` 迁移记录，以及 gate 对 discipline/stability 对齐与 ledger 存在性的校验）

2. **验证抽象与输入/runtime 完整性**
   - ~~真实 SDK 级别的 `@standard-schema` 采用，而不只是 guide 偏好~~（已实现：`createSchema` / `validateWithSchema` 位于 `@securitydept/client`；真实采用体现在 `session-context-client.fetchUserInfo()`、`frontend-oidc-mode.parseConfigProjection()`、`BasicAuthContextClient` config validation、`parseBackendOidcModeCallbackBody` / `parseBackendOidcModeRefreshBody`）
   - ~~在当前 raw scheduler abstraction 之上补出最小 unified input-source / scheduling baseline~~（已实现：`timer`、`interval`、`scheduleAt`、`fromEventPattern` 位于 `@securitydept/client`；`fromVisibilityChange` 位于 `@securitydept/client/web`；真实采用见 `FrontendOidcModeClient`）

3. **login-trigger convenience 收口**
   - ~~`session-context-client`：从 URL-only helper 前进到最小 redirect-trigger convenience~~（已实现：`session-context-client/web` 中的 `loginWithRedirect()`）
   - ~~token-set browser entry：补出最小 redirect-trigger convenience~~（已实现：`backend-oidc-mode/web` 中的 `loginWithBackendOidcRedirect()`，以及 `FrontendOidcModeClient.loginWithRedirect()`）
   - ~~`backend-oidc-mode` / `frontend-oidc-mode` 的 popup login baseline~~（已实现：`@securitydept/client/web` 中的共享基础设施、`loginWithBackendOidcPopup`、`FrontendOidcModeClient.popupLogin()`）

4. **真实 multi-requirement orchestration baseline**
   - ~~让多 OIDC / 多资格 route orchestration 走出“边界讨论”~~（已实现：`@securitydept/client/auth-coordination` 中的 `createRequirementPlanner()`）
   - ~~在 `0.2.0` GA 前至少交付一条 headless primitive / pending-requirement model~~（已实现：顺序 planner，含 `AuthRequirement`、`PlanStatus`、`ResolutionStatus`、`PlanSnapshot`；`kind` 为 opaque `string`，不再导出 `RequirementKind` 常量）
   - ~~补出 matched-route-chain route orchestration baseline，并完成 cross-tab / visibility readiness sweep~~（已实现：`@securitydept/client/auth-coordination` 中的 `createRouteRequirementOrchestrator()`、`createCrossTabSync()`、`createVisibilityReconciler()` 及对应 focused baselines）
   - ~~`@tanstack/react-router` 与 Angular Router 的 framework-specific adapter~~（已实现：`@securitydept/client-react/tanstack-router` 与 `@securitydept/client-angular` 包；TanStack Router 现已拥有与 Angular 对等的完整 route-security contract：`createSecureBeforeLoad()`、`withTanStackRouteRequirements()`、`extractTanStackRouteRequirements()`；较低层 primitive `projectTanStackRouteMatches()` / `createTanStackRouteActivator()` 仍保留；parity 审计见 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md#framework-router-adapters)）
   - ~~Angular integration family 拆成独立 npm 包~~（已实现：`@securitydept/basic-auth-context-client-angular`、`@securitydept/session-context-client-angular`、`@securitydept/token-set-context-client-angular`；使用 `ng-packagr` 生成 APF / FESM2022 输出，并支持真实 `@Injectable()` decorator）
   - ~~React adapter 拆成独立包~~（已实现：React framework adapter 与 TanStack Router adapter 已为独立 npm 包；见迁移记录）
   - ~~planner-host coordination baseline~~（已实现：`@securitydept/client/auth-coordination` 中的 `createPlannerHost()`，含可插拔 `CandidateSelector`、`RequirementsClientSetComposition`（inherit/merge/replace）、`resolveEffectiveClientSet()`；Angular DI 集成位于 `@securitydept/client-angular`；React Context 集成位于 `@securitydept/client-react`）
   - ~~createTokenSetAuthGuard 重构为 planner-host 架构~~（已实现：新 `clientOptions` + `plannerHost` API 替代旧 `query` / `clientKey` / `fromRoute` 判别联合；旧 API 已完全移除）
   - ~~Angular Router auth canonical path：route-metadata + full-route aggregation~~（已实现：`secureRouteRoot()` / `secureRoute()` 成为 adopter-facing Angular Router 入口；route metadata 支持 `merge` / `replace`；root-level runtime policy 保持非序列化；通过 `createTokenSetRouteAggregationGuard()` 在 `canActivate` + `canActivateChild` 中一次性评估整条路由链；`createTokenSetAuthGuard()` 已移除；signal bridge 工具迁入 `@securitydept/client-angular`）
   - ~~Angular build topology 切换为 pnpm recursive build~~（已实现：Angular workspace 依赖通过 `devDependencies` 镜像 `workspace:*` `peerDependencies`；根构建使用 `pnpm -r` 自动拓扑排序）
   - 剩余差距：
     - ~~`outposts` 从 `angular-auth-oidc-client` 迁到 SDK Angular adapter packages 的真实迁移~~（进行中：`outposts-web` 现已使用 SDK 的 `provideTokenSetAuth()`，配合 async `clientFactory` 与 `resolveConfigProjection([networkConfigSource(...)])`；编译时 OIDC 凭证已移除；`confluence` 后端提供 `/api/auth/config` projection endpoint）
     - 剩余 projection source 差距（后续迭代）：
       - ~~`persisted` source restore + revalidation（热启动优化）~~（已实现：`persistedConfigSource()` 与 `RecordStore` abstraction、`persistConfigProjection()` 写回、以及基于 `maxAge` + `timestamp` 的 `scheduleIdleRevalidation()`）
       - ~~`bootstrap_script` source（服务端注入 config）~~（已实现：`bootstrapScriptSource()` 读取 `window.__OUTPOSTS_CONFIG__`；生产宿主为 bun-injector sidecar + nginx + docker-compose shared volume）
       - ~~multi-client lazy initialization（非 primary client 的 idle prefetch）~~（iteration 110 已实现：`@securitydept/token-set-context-client/registry` 中的 `ClientInitializationPriority = "primary" | "lazy"`；`preload(key)`、`whenReady(key)`、`idleWarmup()`；Angular `provideTokenSetAuth({ idleWarmup: true })`；React `TokenSetAuthProvider idleWarmup`）
       - ~~React adapter 的 async readiness 等价机制~~（iteration 110 已实现：`TokenSetAuthProvider`、`useTokenSetAuthRegistry` / `useTokenSetAuthService` / `useTokenSetAuthState` / `useTokenSetAccessToken` / `useTokenSetCallbackResume`、`TokenSetCallbackOutlet`；React Query subpath `/react-query` 中的 `useTokenSetReadinessQuery`；review-1 跟进后 callback path 在调用 `handleCallback()` 前会 await `registry.whenReady(clientKey)`，并暴露 `CallbackResumeStatus = "idle" | "pending" | "resolved" | "error"`，证据见 `examples/react-callback-async-readiness.test.ts`）
       - ~~raw Web router full-route aggregation 与 Angular / TanStack 对齐~~（iteration 110 review-1 已实现：`@securitydept/client/web-router` 支持嵌套 `WebRouteDefinition.children` + `composition: "inherit" | "merge" | "replace"`，通过 `WebRouteMatch.chain` 暴露完整 root→leaf 路径，并通过 `extractFullRouteRequirements(chain)` 单次向 `plannerHost.evaluate()` 提交完整聚合候选集；证据见 `examples/web-router-full-route-aggregation.test.ts`）
       - ~~`apps/webui` React canonical path 真实采用~~（iteration 111 已实现：TanStack Router route tree 迁到 `createSecureBeforeLoad()` + `withTanStackRouteRequirements()` canonical path；authenticated layout route 统一 protected routes；app-local `requireAuthenticatedRoute()` 已移除；`apps/webui` 成为 React reference-app dogfooding authority）
       - ~~`apps/webui` React Query canonical read-path 采用~~（iteration 113 已实现：token-set groups / entries 读路径从 imperative fetch / cancellation / setState 迁到 `@securitydept/token-set-context-client-react/react-query` hooks；`./react-query` 从 package/examples authority 前进到 first-priority reference-app authority）
       - ~~`apps/webui` reference-app mutation dogfooding~~（iteration 114 已实现：create-group 写路径通过 app-local `useMutation` wrapper `useCreateGroupMutation` 与声明式 `onSuccess` invalidation 复用 `tokenSetAppQueryKeys`；约 100 行 imperative CancellationTokenSource + MutationStatus enum 已替换；这是 reference-app-local 实现 —— `./react-query` subpath 不导出 mutation helper，仍是 consumer-only read-side primitive layer）
       - ~~`apps/webui` multi-context auth shell 收口~~（iteration 114 review 后续已实现：`/login` 现为稳定 chooser；Token Set 登录已成为真实 `/auth/token-set/login` OIDC 入口；token-set reference page 已迁到 `/playground/token-set`；session callback 显式对齐到 `/auth/session/callback`；dashboard 的 route gating、current-user/logout、groups/entries CRUD 均按持久化的 `AuthContextMode` 分流）

5. **SSR / server-host baseline clarity**
   - ~~`basic-auth-context` 与 `session-context` 都应拥有超越概念描述的最小 SSR / server-host story~~（已实现：`./server` 中的 `createBasicAuthServerHelper()` 与 `createSessionServerHelper()`）
   - ~~如果未交付 dedicated SSR-oriented helper baseline，就收窄 guide，避免 `CLIENT_SDK_GUIDE` 夸大服务端支持~~（已交付：dedicated `./server` subpath 与 host-neutral helper）
   - `token-set-context` 的 server-side ownership 继续排除在 `0.2.0` baseline 外；mixed-custody / BFF 继续留在 `0.3.0`

6. **auth-context 产品面对齐**
   - 缩小更成熟的 token-set client surface 与更轻的 basic-auth / session client surface 之间的差距
   - 在应保持 thin 的前提下，不再让另外两条线继续处于“文档已写但产品面过轻”的状态
   - ~~`./web` browser convenience 对齐：`basic-auth-context-client/web` 与 `session-context-client/web` 均已导出 `loginWithRedirect()` 与命名 `LoginWithRedirectOptions` contract~~（已实现）
   - ~~`-react` package 的 context value discoverability：`SessionContextValue` 现已是命名导出类型~~（已实现）
   - 剩余 gap：这些 surface 仍有意保持 thinner than token-set；当前 parity 目标是命名 contract discoverability，而不是 feature 等量齐观

## 阶段 5：本地凭证操作

9. 继续发展 `securitydept-creds-manage`
   - 简单 Basic Auth 与 static token 管理
   - 面向 Docker registry login 管理等场景的运维支持

状态：

- 已实现且已经有实际用途

## 阶段 6：参考应用验证

10. 保持 `apps/server` 作为组合场景的试验场
    - 底层验证原语
    - basic auth zone mode
    - cookie-session mode
    - stateless token-set mode
    - creds-manage 集成

当前现实角色：

- 验证环境
- 私有 Docker registry mirror 场景的认证入口
- cookie-session、basic-auth 与 stateless token-set flow 的集成试验场

## 跨领域优先事项

- 定义共享的 authenticated-principal abstraction
- 保持 `oidc-client` 与 `oauth-resource-server` 分离
- 保持 auth-context mode 架构位于底层能力层之上
- 清晰记录 bearer forwarding boundary
- 随着新 mode 落地，补充更多 reference-app 集成测试

## 延期到 0.3.0 的主题

这些主题依然真实存在，但在当前重审后，它们是最明确应留在 `0.2.0` 目标之外的内容：

- mixed-custody token ownership
- stateful BFF / server-side token-set ownership
- 建立在未来 orchestration primitive 之上的内建 chooser UI 或 router-level product flow semantics
- 更重的 OTel / DI 主题
- 在 TS contract 尚未收稳前推进 Kotlin / Swift SDK productization

---

[English](../en/100-ROADMAP.md) | [中文](100-ROADMAP.md)
