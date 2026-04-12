# 路线图

本路线图与当前项目目标保持一致：将 SecurityDept 转变为面向网格的认证和授权工具包，`apps/server` 作为试验场。

## 阶段 1：底层验证和提供者层

1. 完成并加强底层 creds 验证
   - 基础认证
   - 静态令牌
   - RFC 9068
   - JWT 和 JWE 助手
2. 完成并加强共享提供者运行时
   - 发现刷新
   - JWKS 刷新
   - 内省复用
   - 严格元数据解析行为

状态：

- 大部分已实现

## 阶段 2：令牌获取和验证层

3. 加强 `securitydept-oidc-client`
   - 回调流程
   - 刷新
   - 声明规范化
   - 下游认证上下文模式的可复用接口
4. 加强 `securitydept-oauth-resource-server`
   - JWT/JWE/不透明验证
   - 策略配置
   - 共享提供者复用
   - 显式主体提取

状态：

- 大部分已实现

## 阶段 3：认证上下文模式

5. 实现基础认证区域模式
   - 后端路由助手
   - 文档化流程
   - 轻量客户端 helper，用于 zone-aware 的 `401 -> login` 跳转与 logout URL 处理
6. 实现 cookie-session 模式
   - 可复用后端认证上下文提取
   - 规范化主体形状
   - 可选重定向助手 SDK
7. 实现无状态 token-set 模式
   - token snapshot / delta 与 metadata snapshot / delta
   - 前端令牌生命周期规则
   - 多提供者令牌管理
   - 同资源转发的 bearer 传播策略
   - 可选的未来令牌交换钩子

状态：

- 基础认证区域：已文档化，未完全产品化
- cookie-session：参考实现已存在；可复用提取主体已在 `securitydept-session-context`，route-facing service（`SessionAuthServiceTrait` / `OidcSessionAuthService` / `DevSessionAuthService`）已通过 `service` feature 直接归属于该 crate
- 无状态 token-set 模式：服务端与共享 crate 已落地；`securitydept-auth-runtime` 已解散，mode-specific 与 substrate-specific service 已全部回到 `securitydept-token-set-context`；`frontend-oidc` 已拥有正式 `Config / ResolvedConfig / ConfigSource / Runtime / Service / ConfigProjection`；跨 preset 共享的 OIDC 协议级 principal extraction 已下沉到 `securitydept-oidc-client::auth_state`；`backend-oidc` 已统一为单一 capability framework，并通过 preset/profile 表达不同能力组合；mixed-custody / BFF / server-side token-set 继续留在后续范围

## 阶段 4：前端 SDK

8. 提供轻量级 TypeScript SDK
   - 基础认证区域 helper，用于 zone 边界识别、`401 -> login` 跳转与 logout 重定向
   - cookie-session 重定向助手
   - 无状态 token-set SDK 用于令牌存储、头注入、后台刷新和登录重定向

状态：

- TypeScript 客户端 SDK 已不再只是架构草案；foundation、auth-context roots、`./web` adapter、React adapter 与 reference app dogfooding 基线都已落地
- 当前已具备 external-consumer scenario、token-set web focused lifecycle baseline、以及最小 React adapter focused test
- 当前阶段的重点不再是“是否开始实现 SDK”，而是冻结 `stable / provisional / experimental` 语义、明确 token-set v1 scope baseline，并继续积累 adopter-facing clarity
- mixed-custody、stateful BFF、server-side token-set、OTel / DI 等更高复杂度主题继续放在后续阶段，而不是当前前端 SDK 主线

参考：

- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

## 当前优先级队列

上面的阶段划分仍然有价值，但它已经不再完整描述项目当前真正的瓶颈。  
现在最大的风险不再是“还差一个功能没做”，而是 public SDK contract、adopter 预期、以及 reference app 验证之间的方向漂移。

因此，当前应按下面这个优先级队列来读 roadmap：

### 优先级 0：把 TypeScript SDK 的冻结语义变成可执行的 release gate

为什么排第一：

- 仓库里已经有真实的 TS SDK 代码、adapter 和 adopter-facing 文档
- 当前最大的剩余风险不是实现量，而是 surface drift
- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) 已经定义了 `stable / provisional / experimental`，但 roadmap 层还没有把它变成足够明确的执行标准

当前仍然缺少：

- 一份覆盖 root exports 与 subpath 的 authoritative public-surface inventory
- 由 public-surface tests、example coverage 与 docs 对齐共同支撑的 promotion / freeze gate
- 面向 TS SDK contract 的轻量 0.x breaking-change / migration discipline

### 优先级 1：用真实下游 adopter 验证 SDK，而不只依赖仓库内 demo

为什么排第二：

- `apps/webui` 是有价值的 dogfooding，但它仍然是仓库内 reference app
- 项目已经承认 `outposts` 是高价值的真实 adopter case，但这一点在 roadmap 里还没有被足够强地表达
- 接下来的很多决策都依赖真实 adopter 证据：multi-integration 布局、route-level auth orchestration、browser/runtime 假设、以及 owner 边界

这条优先级应验证：

- 单宿主 / 多后端 token family
- route-level requirement orchestration 及 failure policy 边界
- SDK primitives 与 adopter app glue 的更清晰分界
- Angular / React framework adapter 应由 `securitydept` 自己的领域语义与 ergonomics 主导，而不是照搬 adopter 现有 auth 模块形状

### 优先级 2：先收口 browser-owned token-set v1 baseline，再讨论扩大范围

为什么它仍是高优先级：

- 文档已经明确当前 token-set 方向是 browser-owned v1 baseline
- 在本次重审后，只有 mixed-custody / BFF / server-side token ownership 继续明确延期到 `0.3.0`
- popup login baseline、cross-tab lifecycle hardening 与 matched-route 多 provider orchestration baseline 均已实现；当前更真实的剩余工作是框架级 adapter、真实 provider integration 与下游 adopter 校准
- 如果 roadmap 层不持续强调，真正的 `0.3.0` 延期项与仍需在 `0.2.0` 内补齐的 backlog 很容易在日常实现讨论里重新混淆

这里仍需补强的是：

- 当前 token-set baseline 还需要哪些证据，才能被当作 v1-ready external contract
- 哪些剩余 hardening topic 仍属于 browser-owned baseline 内
- 哪些相邻主题属于 `0.2.0` backlog，哪些才是明确延期到 `0.3.0`
- 真实 framework adapter 与 downstream integration proof 应如何进入 authority，而不是只停留在 guide / adopter 层

### 优先级 3：恢复三个 auth-context mode 之间的产品面对齐

为什么这是当前的规划空洞：

- token-set SDK 的推进速度已经明显快于另外两条 auth-context client surface
- roadmap 仍提到 basic-auth 和 cookie-session helper，但没有把它作为“当前存在的不平衡”明确提出
- 如果继续放任不管，项目会很容易演变成：一个 TS product surface 很完整，另外两个只是“文档已写但未同等产品化”

当前应持续观察的 parity gap：

- `basic-auth-context-client` 虽然应保持 thin，但仍需要一个更清晰的 productized baseline
- `session-context-client` 在 root contract 层已经稳定，但 adopter-facing helper story 仍明显轻于 token-set

### 优先级 4：把 public-surface governance 和 release discipline 正式写进项目文档

为什么这条独立于优先级 0：

- 优先级 0 关注的是 SDK freeze 作为执行 gate
- 这里关注的是让未来的决策者和实施者能够持续读懂项目

当前在文档层仍然缺少：

- 一段紧凑、可引用的 roadmap-level current strategic priorities 声明
- 对“已实现”“已可对外解释”“可晋升 stable”三者更清晰的区分
- 项目级预期：roadmap、SDK guide、examples 和 exported surface 必须一起移动

### 优先级 5：在 TS surface 尚未收稳前，明确压住非 TS 扩张

为什么这条需要直接写出来：

- Kotlin 与 Swift 仍在文档中作为未来 SDK 方向存在
- 这作为长期架构方向没有问题
- 但在 TypeScript surface 尚未冻结到足以充当 reference contract 前，不应让跨语言扩张分散 roadmap 注意力

当前经验法则：

- TypeScript 继续作为唯一 active SDK productization track
- Kotlin / Swift 继续作为后续工作，等 TS external contract 足够清晰后再推进

## 0.2.0 发布前 backlog（基于 CLIENT_SDK_GUIDE 重审）

除非某个主题在下方被**明确延期到 0.3.0**，否则 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) 中仍被写为产品目标、但尚未完成的内容，现都应视为 **0.2.0 release backlog**，而不再是模糊的“以后再说”。

这里对 `0.2.0` 的要求不是“完全做满”，而是：

- 至少有基础实现
- adopter-facing shape 已可解释
- 至少存在一条有意义的验证路径（测试、example 或 reference app 证据）

当前 0.2.0 backlog 优先级如下：

1. **TS SDK 冻结与 release-gate 纪律**
   - ~~authoritative public-surface inventory~~（已实现：`public-surface-inventory.json` 覆盖全部 package、subpath、stability、evidence、docs anchor）
   - ~~与 docs、examples、public-surface tests 绑定的 promotion / freeze gate~~（已实现：`release-gate.test.ts` 校验 export 对齐、evidence 存在、docs anchor、stability、完整性）
   - ~~面向 0.x contract 的轻量 breaking-change / migration discipline~~（已实现：inventory 中 `changeDiscipline` 字段、`110-TS_SDK_MIGRATIONS.md` 迁移记录、gate 校验 discipline/stability 对齐与 ledger 存在性）

2. **验证抽象与输入/runtime 完整度**
   - ~~不再只停留在 guide 规则层的 `@standard-schema`，而是要有真实 SDK-level adoption~~（已实现：`createSchema` / `validateWithSchema` 在 `@securitydept/client` 中；真实 adoption 在 `session-context-client.fetchMe()`、`frontend-oidc-mode.parseConfigProjection()`、`BasicAuthContextClient` config validation、`parseBackendOidcModeCallbackBody` / `parseBackendOidcModeRefreshBody`）
   - ~~在现有 raw scheduler abstraction 之上，补出最小 unified input-source / scheduling baseline~~（已实现：`timer`、`interval`、`scheduleAt`、`fromEventPattern` 在 `@securitydept/client` 中；`fromVisibilityChange` 在 `@securitydept/client/web` 中；真实 adoption 在 `FrontendOidcModeClient`）

3. **login-trigger convenience 收口**
   - ~~`session-context-client`：补最小 redirect-trigger convenience~~（已实现：`loginWithRedirect()` 在 `session-context-client/web` 中）
   - ~~token-set browser entry：补最小 redirect-trigger convenience~~（已实现：`loginWithBackendOidcRedirect()` 在 `backend-oidc-mode/web` 中，`FrontendOidcModeClient.loginWithRedirect()`）
   - ~~`backend-oidc-mode` / `frontend-oidc-mode` 的 popup login baseline~~（已实现：共享 infra 在 `@securitydept/client/web`，`loginWithBackendOidcPopup`，`FrontendOidcModeClient.popupLogin()`）

4. **真实多资格编排 baseline**
   - ~~让多 OIDC / 多资格路由编排从"边界讨论"进入最小实现~~（已实现：`createRequirementPlanner()` 在 `@securitydept/client/auth-coordination` 中）
   - ~~在 0.2.0 GA 前至少交付一个 headless primitive / pending-requirement model~~（已实现：顺序 planner，含 `AuthRequirement`、`PlanStatus`、`ResolutionStatus`、`PlanSnapshot`；`kind` 为 opaque `string`，不再导出 `RequirementKind` 常量）
   - ~~补出 matched-route-chain route orchestration baseline，并完成 cross-tab / visibility readiness sweep~~（已实现：`createRouteRequirementOrchestrator()` 在 `@securitydept/client/auth-coordination` 中、`createCrossTabSync()`、`createVisibilityReconciler()` 以及对应 focused baselines）
   - ~~`@tanstack/react-router` 与 Angular Router 的 framework-specific adapter~~（已实现：`@securitydept/client-react/tanstack-router` 与 `@securitydept/client-angular` 独立包；TanStack Router 现已拥有与 Angular 对等的完整 route-security contract：`createSecureBeforeLoad()` 作为 canonical adopter-facing beforeLoad factory，`withTanStackRouteRequirements()` 用于 child route 可序列化声明，`extractTanStackRouteRequirements()` 支持 `merge` / `replace` / `inherit` 组合语义的全路径聚合；下层 primitive `projectTanStackRouteMatches()` / `createTanStackRouteActivator()` 继续保留；parity 审计已文档化于 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md#framework-router-adapters)）
   - ~~Angular 集成家族拆包为独立 npm 包~~（已实现：`@securitydept/basic-auth-context-client-angular`、`@securitydept/session-context-client-angular`、`@securitydept/token-set-context-client-angular` 三个独立包，使用 `ng-packagr` 生成 APF / FESM2022 输出，支持真实 `@Injectable()` decorator；`token-set-context-client-angular` 实现 multi-client registry contract）
   - ~~React adapter 拆包为独立 npm 包~~（已实现：`@securitydept/basic-auth-context-client-react`、`@securitydept/session-context-client-react`、`@securitydept/token-set-context-client-react` 三个独立包，使用 `tsdown` 构建；原有核心包的 `./react` 子路径已移除，见迁移记录 [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)）
   - ~~planner-host 协调 baseline~~（已实现：`createPlannerHost()` 支持可插拔 `CandidateSelector`、`RequirementsClientSetComposition`（inherit/merge/replace）、`resolveEffectiveClientSet()` 在 `@securitydept/client/auth-coordination`；Angular DI 集成在 `@securitydept/client-angular`；React Context 集成在 `@securitydept/client-react`）
   - ~~createTokenSetAuthGuard 重构为 planner-host 架构~~（已实现：新 `clientOptions` + `plannerHost` API 替代旧 `query`/`clientKey`/`fromRoute` 判别联合；旧 API 完全移除）
   - ~~Angular Router auth canonical path：route-metadata + full-route aggregation~~（已实现：`secureRouteRoot()` / `secureRoute()` 成为 adopter-facing Angular Router 路径；route metadata 具备 `merge` / `replace` 组合语义，root-level runtime policy 保持非序列化，并通过 `createTokenSetRouteAggregationGuard()` 为 `canActivate` + `canActivateChild` 一次性评估整条路由链；`createTokenSetAuthGuard()` 已从包中移除；signal 桥接工具（`bridgeToAngularSignal`、`signalToObservable`）迁至 `@securitydept/client-angular`）
   - ~~Angular 构建拓扑切换为 pnpm 递归 build~~（已实现：Angular workspace 依赖在 `devDependencies` 中镜像 `workspace:*` `peerDependencies`；根构建使用 `pnpm -r` 实现自动拓扑排序）
   - 剩余差距：
     - ~~`outposts` 代码库从 `angular-auth-oidc-client` 到 SDK Angular adapter 包的实际迁移~~（进行中：`outposts-web` 现已使用 SDK 的 `provideTokenSetAuth()` + async `clientFactory` + `resolveConfigProjection([networkConfigSource(...)])`；编译时 OIDC 凭证已移除；`confluence` 后端提供 `/api/auth/config` 投影端点；route guard、callback service 已通过 `whenReady()` 接入 readiness contract）
     - 剩余 projection source 差距（后续迭代）：
       - ~~`persisted` source restore + 重验证（热启动优化）~~（已实现：`persistedConfigSource()` + `RecordStore` 抽象、`persistConfigProjection()` 写回、`scheduleIdleRevalidation()` 基于 `maxAge` + `timestamp` 新鲜度感知）
       - ~~`bootstrap_script` source（服务端注入 config）~~（已实现：`bootstrapScriptSource()` 读取 `window.__OUTPOSTS_CONFIG__` 多来源兼容 payload；生产宿主：bun-injector sidecar + nginx，通过 docker-compose 共享卷）
       - ~~多 client 懒初始化（空闲预取）~~（iteration 110 已实现：`@securitydept/token-set-context-client/registry` 中的 `ClientInitializationPriority = "primary" | "lazy"`；`preload(key)`、`whenReady(key)`、`idleWarmup()` 使用 `requestIdleCallback` + `setTimeout` 回退；Angular `provideTokenSetAuth({ idleWarmup: true })`；React `TokenSetAuthProvider idleWarmup`）
       - ~~React adapter `useTokenSetAuth()` 的异步 readiness 等价机制~~（iteration 110 已实现：`@securitydept/token-set-context-client-react` 中 `TokenSetAuthProvider` + `useTokenSetAuthRegistry` / `useTokenSetAuthService` / `useTokenSetAuthState` / `useTokenSetAccessToken` / `useTokenSetCallbackResume`，以及 `TokenSetCallbackOutlet`；React Query consumer subpath `/react-query` 中 `useTokenSetReadinessQuery` 作为异步 readiness 桥梁；review-1 跟进：callback 路径在调用 `handleCallback()` 前 await `registry.whenReady(clientKey)`，并通过 `CallbackResumeStatus = "idle" | "pending" | "resolved" | "error"` 暴露状态机，证据见 `examples/react-callback-async-readiness.test.ts`）
       - ~~原生 Web 路由全路径聚合与 Angular / TanStack 对齐~~（iteration 110 review-1 已实现：`@securitydept/client/web-router` 支持嵌套 `WebRouteDefinition.children` + `composition: "inherit" | "merge" | "replace"`，通过 `WebRouteMatch.chain` 暴露完整 root→leaf 链路，并通过 `extractFullRouteRequirements(chain)` 单次向 `plannerHost.evaluate()` 提交完整聚合候选集；证据见 `examples/web-router-full-route-aggregation.test.ts`）

5. **SSR / 服务端宿主 baseline 清晰化**
   - ~~`basic-auth-context` 与 `session-context` 都应拥有一个不止停留在 redirect 概念描述层的最小 SSR / server-host story~~（已实现：`createBasicAuthServerHelper()` 在 `./server`，`createSessionServerHelper()` 在 `./server`）
   - ~~如果 0.2.0 前不交付 dedicated SSR-oriented helper baseline，就应同步收窄 `CLIENT_SDK_GUIDE`，避免继续夸大服务端支持~~（已交付：dedicated `./server` subpath + host-neutral helper）
   - `token-set-context` 的 server-side ownership 继续排除在 `0.2.0` baseline 外；mixed-custody / BFF 继续留在 `0.3.0` 主题

6. **auth-context 产品面对齐**
   - 缩小 token-set client surface 与 basic-auth / session client surface 之间的成熟度差距
   - 在应保持 thin 的前提下，避免另外两条线继续处于"文档已写但产品面仍偏轻"的状态
   - ~~`./web` browser convenience 对齐：`basic-auth-context-client/web` 与 `session-context-client/web` 现均导出 `loginWithRedirect()` 及命名 `LoginWithRedirectOptions` 合约~~（已实现）
   - ~~`-react` 独立包 context value 可发现性：`SessionContextValue` 现为命名导出类型~~（已实现）
   - 剩余 gap：这些 surface 有意保持 thinner than token-set；当前 parity 目标是命名合约可发现性，而非功能对等

## 阶段 5：本地凭证操作

9. 继续发展 `securitydept-creds-manage`
   - 简单基础认证和静态令牌管理
   - 操作支持场景，如 Docker 注册表登录管理

状态：

- 已实现且已有用

## 阶段 6：参考应用验证

10. 保持 `apps/server` 作为组合场景的试验场
    - 底层验证原语
    - 基础认证区域模式
    - cookie-session 模式
    - 无状态 token-set 模式
    - creds-manage 集成

当前现实角色：

- 验证环境
- 私有 Docker 注册表镜像场景的认证入口
- cookie-session、基础认证区域和无状态 token-set 流程的集成试验场

## 跨领域优先事项

- 定义共享认证主体抽象
- 保持 `oidc-client` 和 `oauth-resource-server` 分离
- 保持认证上下文模式在底层之上
- 清晰记录 bearer 转发边界
- 随着新模式的实现添加更多集成测试

## 延期到 0.3.0 的主题

这些主题依然真实存在，但在本次重审后，它们是当前最明确应留在 `0.2.0` 目标之外的内容：

- mixed-custody token ownership
- stateful BFF / server-side token-set ownership
- 建立在未来 orchestration primitive 之上的内建 chooser UI 或 router-level product flow semantics
- 更重的 OTel / DI 主题
- 在 TS contract 仍未收稳前推进 Kotlin / Swift SDK productization

---

[English](../en/100-ROADMAP.md) | [中文](100-ROADMAP.md)
