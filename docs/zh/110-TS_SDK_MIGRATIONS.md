# TypeScript SDK 迁移指南

本文是 `sdks/ts/public-surface-inventory.json` 的人类可读伴随文档。它记录当前迁移规则和仍然对 adopter 有意义的迁移说明，不再以实现时间线作为稳定文档结构。

## 0.x 合约变更策略

SDK 仍处于 `0.x`，但 public-surface changes 必须保持有纪律。

| Stability | Change Discipline | 含义 |
| --- | --- | --- |
| `stable` | `stable-deprecation-first` | Breaking change 必须先经过 deprecation 周期。已废弃 API 至少在一个 minor release 中保持可用，并在本文记录迁移说明。 |
| `provisional` | `provisional-migration-required` | 允许 breaking change，但必须记录迁移路径和理由。 |
| `experimental` | `experimental-fast-break` | 预期会有 breaking change。简短记录有价值，但不是 release gate。 |

规则：

- `public-surface-inventory.json` 是 package/subpath stability 与 evidence 的 machine-readable authority。
- 本文是 adopter-readable migration companion。
- 非 experimental breaking changes 必须同时更新 inventory 与本指南。
- Additive changes 如果需要 adopter 主动启用更安全行为，也应记录在这里。

## 当前迁移说明

### Client Environment 与 Backend-OIDC Web Host 边界

Packages：

- `@securitydept/client`
- `@securitydept/client/web`
- `@securitydept/token-set-context-client/backend-oidc-mode/web`

变更：

- Framework-neutral host capability resolution 现在由 client foundation 通过 typed `ClientEnvironment`、`WebClientEnvironment`、`PageClientEnvironment` 对象拥有。
- `ClientRuntime` 仍是 core client 消费的 capability bundle；client environment 包含 canonical runtime，并可暴露同源 mirror 方便 helper 使用。
- Web host preset 是面向 browser page、browser worker、service worker、browser-extension background 的显式 factory entry，不是 automatic host detection。
- Context 与 adapter public helper 使用同一边界。Backend-OIDC web helper、basic-auth/session redirect helper，以及 framework adapter convenience helper 不得各自重复声明或猜测 transport/store/scheduler/clock/page dependencies。
- Backend-OIDC web helper 按 host boundary 拆分：page-only helper 使用 page-explicit 命名；worker-safe helper 必须使用 host-injected environment/capability 或 restore-only 行为。

迁移：

- 在 host composition root 创建一个 environment，并把 `environment.runtime` 传给 core client。
- Real page/tab/popup callback flow 使用 `createBrowserPageClientEnvironment(options)`。
- Worker-like host 使用 `createBrowserWorkerClientEnvironment(options)`、`createServiceWorkerClientEnvironment(options)` 或 `createBrowserExtensionBackgroundClientEnvironment(options)`；需要 persistence/session store 时必须显式注入。
- 不要在 service worker 或 extension background 中执行 page callback bootstrap。那里只运行 restore/token-state API；callback capture 只在 real page/popup document 中运行，或在测试中显式传入 fake page/callback-fragment capability。
- 将 ambiguous page-global helper 名称迁移到已经改名的 page-explicit 名称，例如 `currentPageLocationAsPostAuthRedirectUri()`、`buildAuthorizeUrlReturningToCurrentPage()`、`bootstrapBackendOidcModePageClient()` 与 `captureBackendOidcModePageCallbackFragment()`。
- 将既有 redirect/popup helper（`loginWithBackendOidcRedirect()`、`loginWithBackendOidcPopup()`、`relayBackendOidcPopupCallback()`）视为 page-only helper，虽然历史名称保持不变；测试或 host wrapper 中应传入显式 page capability（`PageLocationHistoryCapability`）或携带 page capability 的 `environment`。
- 将会读取或写入 `window.location` 的 basic-auth/session `/web` redirect helper 视为 page helper；要么留在 real page context，要么注入显式 navigation capability。
- Framework provider/DI registration function 可以持有完整 environment composition；普通 hook、guard、interceptor、service 或 convenience helper 不应各自接受一整套分散 dependency bag。
- 不要通过 `globalThis.location` 推断 page capability；page helper 需要 `window.location` 与 `window.history.replaceState`。

理由：

- 非 client-bound helper 已经开始重复 dependency bag 并隐藏读取 `window.*` default。Typed client environment 在保持 core runtime 显式 wiring 的同时，为 helper 提供共享、可测试、按 host 划分的 capability boundary。

### Token-Set Event-Driven Auth Flow

Packages：

- `@securitydept/client/events`
- `@securitydept/token-set-context-client/orchestration`
- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-angular`
- `@securitydept/token-set-context-client-react`

变更：

- Token-set client 现在暴露 `authEvents` 与 `ensureAuthForResource(options)`，作为 route/request/resume 的 canonical async barrier。
- `ensureFreshAuthState()` 与 `ensureAuthorizationHeader()` 仍是 compatibility wrapper；新的 adapter 代码应显式传入 `route_guard`、`resume`、`http_interceptor` 或 `authorized_transport` 等 source。
- Authorization-header event 可以包含 opaque temporary token handle descriptor，但不得包含 raw access、refresh 或 ID token value。

迁移：

- Route admission 与 resume recovery 优先使用 `ensureAuthForResource({ source, forceRefreshWhenDue: true })`。
- Protected HTTP request 前优先使用 `ensureAuthForResource({ source, needsAuthorizationHeader: true, forceRefreshWhenDue: true })`。
- 需要 lifecycle telemetry 时订阅 `authEvents`，不要从 redirect、throw error 或 raw token value 反推 auth flow state。

理由：

- 短 access-token lifetime 需要 restore、resume、route、interceptor、generic transport 与 React Query 共享同一个 refresh barrier，而不是继续堆 adapter-local freshness patch。

### Angular Token-Set Bearer Interceptor：`strictUrlMatch`

Package：`@securitydept/token-set-context-client-angular`

变更：

- `provideTokenSetBearerInterceptor()` 接受 `options?: BearerInterceptorOptions`。
- `createTokenSetBearerInterceptor(registry, options?)` 接受同一 options object。
- `BearerInterceptorOptions.strictUrlMatch` 控制未匹配 URL 是否获得 single-client fallback token。

迁移：

```ts
provideTokenSetBearerInterceptor({ strictUrlMatch: true });
```

Angular host 如果存在 multiple backends、multiple audiences，或任何第三方 HTTP traffic，应启用 `strictUrlMatch: true`。这样当 request URL 不匹配任何已注册 token-set client `urlPatterns` 时，不会注入 bearer。

单 backend host 如果有意依赖 convenience fallback，可以继续使用无参形式。

### Shared Authenticated Principal

Packages：

- `@securitydept/client`
- `@securitydept/session-context-client`
- `@securitydept/token-set-context-client`

变更：

- `@securitydept/client` 拥有共享 `AuthenticatedPrincipal` contract。
- Session 与 token-set user-info projection 对齐到同一个 principal shape。
- Resource-token facts 保持独立，不是 authenticated human-principal data 的别名。

迁移：

- 对 incoming principal data 优先使用 `normalizeAuthenticatedPrincipal()` 或 `normalizeAuthenticatedPrincipalWire()`。
- 对 host-facing current-user display data 优先使用 `projectAuthenticatedPrincipal()`。
- 确保 session principal data 包含稳定 `subject`。
- 不要把 resource-token facts 当作 human-principal substitute。

### Operation Tracing And Error Presentation

Package：`@securitydept/client`

变更：

- shared client foundation 拥有 reference apps 和 adapters 使用的 operation correlation primitives 与 error-presentation reader helpers。
- Host UI 应消费稳定 `code` / `recovery` data，而不是解析 raw message text。

迁移：

- 使用 SDK helpers 读取 `ErrorPresentation`-compatible response data。
- 基于 `UserRecovery` values 分支 product recovery UI。
- App-local copy、toast 与 routing decisions 留在 host app。

### Token-Set React Query

Package：`@securitydept/token-set-context-client-react/react-query`

变更：

- React Query integration 是 React package 的 subpath，不是独立 package。
- 当 read/write helpers 表达可复用 token-set groups / entries 行为时，由 SDK 拥有。
- App-specific mutation composition 仍是 app glue。

迁移：

- 从 `./react-query` subpath 导入 React Query helpers。
- 不要依赖 `apps/webui/src/hooks/*` 作为 public API。
- 只有导入该 subpath 的 host 需要安装 TanStack Query optional peer dependency。

### Route Security And Matched Route Chains

Packages：

- `@securitydept/client`
- `@securitydept/client-react`
- `@securitydept/client-angular`

变更：

- Route requirements 从 matched route chains 计算。
- Child routes 继承 parent requirements，除非 adapter contract 明确 replace 或 merge。
- Framework adapters 应保持 provider-neutral，只表达 auth requirements，不表达 provider SDK 细节。

迁移：

- 将 protected routes 建模为 route-chain requirements，而不是 flat per-leaf checks。
- 避免跳过 parent requirements 的 app-local route guards。
- Product routing 与 chooser UI 留在 host app。

### Token-Set Callback And Readiness

Packages：

- `@securitydept/token-set-context-client`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

变更：

- Callback handling 是 keyed 且 readiness-aware 的。
- Duplicate、stale、missing、client-mismatch callback states 都是正式 callback outcomes。
- Hosts 应展示 typed callback failures，而不是解析 raw text。

迁移：

- 在 callback route 消费 state 前注册 token-set clients。
- 优先使用 framework callback components / guards。
- Failure UI 通过 structured code 与 recovery data 路由。

## 当前非目标

这些不是当前 SDK baseline 的迁移目标：

- mixed-custody token ownership
- full BFF / server-side token-set ownership
- SDK 内建 chooser UI
- app-specific business API wrappers
- product copy、toast policy 或 route table ownership
- 非 TypeScript SDK productization

## 添加新迁移说明

未来非 experimental breaking changes 使用以下结构：

```markdown
### Package Or Subpath: Short Description

Package: `@securitydept/example`

变更：

- What changed.

迁移：

- What adopters must do.

理由：

- Why the break is necessary.
```

同时更新 `sdks/ts/public-surface-inventory.json` 以及证明新 contract 的 focused evidence tests。

---

[English](../en/110-TS_SDK_MIGRATIONS.md) | [中文](110-TS_SDK_MIGRATIONS.md)
