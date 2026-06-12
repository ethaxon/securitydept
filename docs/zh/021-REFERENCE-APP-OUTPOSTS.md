# Outposts 参考案例

`~/workspace/outposts` 是 SecurityDept TypeScript SDK 当前的下游校准案例。它补充 `apps/webui`，但不替代仓库内参考应用。

由于 `outposts` 是仓库外 workspace，本文记录的是校准结果与集成压力，而不是一个可以完全公开复现的测试计划。`apps/webui` 仍是仓库内第一优先级 release-gate proof surface。

## 这个案例当前证明了什么

当前校准线证明了：

- `outposts-web -> confluence` 已改为消费 SecurityDept Angular/token-set packages，不再依赖 `angular-auth-oidc-client`。
- Callback route 适配会迁移到基于核心 token-set registry controller 的新 Angular bridge；旧 Angular drop-in callback component 不再属于 SDK surface。
- `secureTokenSetRouteRoot()` 承载 provider-neutral requirement metadata 与 next-action policy。
- `provideTokenSetClientRegistry(...)` 为 `Confluence` client 显式注册 `providerFamily`、`callbackUrl` 与 `urlPatterns`。
- Route-login integration 使用 `BaseOidcModeClient.loginWithRedirect({ postAuthRedirectUri })`；client 应已通过自身 environment 持有稳定的 page router，而不是每次调用时接收 page factory。
- 对 registry-managed browser client，`provideTokenSetClientRegistry(...)` 直接使用核心 `TokenSetClientRegistry` lifecycle；adopter 不需要为了 resume recovery 再额外包一层 client。
- `provideTokenSetClientRegistryAuthorizationInterceptor()` 可以把 authorization injection 限制到已注册 URL，不再对 unmatched URL 使用 fallback authorization。
- 短 access-token lifetime 应通过 SDK freshness barriers 恢复，而不是在存在 refresh material 时直接 redirect 或发送过期 bearer。
- Focused downstream tests 已锁住 callback preservation、provider-neutral route metadata、bearer injection boundaries 与 redirect preservation。

真实浏览器诊断和本地 Authentik 运行仍然有价值，但它们是校准证据，不替代仓库内 release gates。

## 为什么这个案例重要

`outposts` 有价值，是因为它施加了单一仓库内参考应用不足以完全覆盖的 host 压力：

- 一个 frontend host 未来可能管理多个 backend token families
- 某些 route area 可能要求多个 app 的资格
- host 拥有 user-choice flow、silent/interactive acquisition decision 与 product copy
- backend 仍需要 provider-neutral bearer/OIDC validation

这种压力能够暴露 SDK primitive 到底可复用，还是只是贴着某个参考应用形状写出来的局部解。

## 它如何影响 SDK 设计

这个案例当前强化了以下设计结论：

- Angular authorization injection 应继续由 client registry URL matching 限定，并通过 `authorizationForRequest` 支持 host-specific routing rules。
- Angular route 与 request handling 应消费 canonical replay channels：route guard 等待 `isAuthenticated`，interceptor 等待 `authorizationHeaderValue`。adopter-local 代码不应自行重拼命令式 freshness 或 bearer fallback chain。
- Browser token-set client 应默认保留 resume reconciliation；如果 adopter 明确关闭，就必须补上等价的 freshness barrier。
- Authentik 或等价 provider 配置必须让 browser-owned token-set client 拿到并保留 refresh material，包括 `offline_access` 和可用的 refresh-token lifetime/rotation。
- SDK 可以在重复 adopter pressure 被证实时提升 headless primitive，但单个 adopter 的 `AuthService` 仍只是样例，不是 public SDK API。

## 这个案例不证明什么

这个案例不证明：

- SDK 已经内建 multi-requirement chooser UI
- SDK 拥有 product route table、page copy 或 toast behavior
- adopter-local `AuthService` 应被复制进 SDK
- `outposts` 替代 `apps/webui` 成为 primary release gate
- cross-repository browser automation 属于当前产品线

正确分工保持不变：

- 当重复 adopter pressure 证明某个 headless primitive 稳定时，SecurityDept 才提升它。
- Adopter 拥有 product UX、business routes 与 local glue。
- `apps/webui` 继续作为仓库内首要 executable proof surface。

## 本地跨工作区验证约束

在 SDK 与 adopter 边界继续演化期间，这个案例仍依赖直接本地 workspace dependencies：

- Rust：使用指向本地 SecurityDept crates 的 `path` dependencies
- Node / pnpm：使用指向本地 SecurityDept TS packages 的 `link:` references

推荐本地顺序：

1. 在 `outposts` 中先启动 `just dev-confluence`，再启动 `just dev-webui`。
2. 修改 linked 的 SecurityDept SDK package 后，先重建对应 package outputs。
3. 重启 downstream web UI 前清理 `outposts/.angular/cache`，否则 Angular/Vite 可能继续提供陈旧的 linked artifact。

对本地 cross-workspace 验证，应使用 pnpm `link:` dependency，而不是 overrides。普通 TS package 可以继续 link 到 package root，但 Angular `ng-packagr` package 应 link 到构建后的 `dist/` 输出，而不是 workspace root。一个可复用的下游配置模式是：

```json
{
	"@securitydept/client": "link:../securitydept/sdks/ts/packages/client",
	"@securitydept/client-angular": "link:../securitydept/sdks/ts/packages/client-angular/dist",
	"@securitydept/token-set-context-client": "link:../securitydept/sdks/ts/packages/token-set-context-client",
	"@securitydept/token-set-context-client-angular": "link:../securitydept/sdks/ts/packages/token-set-context-client-angular/dist"
}
```

如果把 Angular package root 直接 link 给 downstream，实际消费到的是 monorepo manifest 与本地 Angular 类型安装路径，而不是面向 consumer 的 `ngc` / `ng-packagr` 产物。这就是本地 linked downstream 验证里 `Route` 双类型宇宙回归的典型触发条件。

如果 downstream 还会独立运行 Angular builder 之外的 TypeScript 检查，也要在重新运行 `tsc`、`nx test` 或 `nx build` 前，让其 Angular patch 版本继续与当前 SecurityDept SDK 工具链线保持一致。

## 相关文档

- SDK 边界与当前契约：[007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)
- Auth context 与 modes：[020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)
- Roadmap 与 release blockers：[100-ROADMAP.md](100-ROADMAP.md)

---

[English](../en/021-REFERENCE-APP-OUTPOSTS.md) | [中文](021-REFERENCE-APP-OUTPOSTS.md)
