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

这些不是当前 beta line 的迁移目标：

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
