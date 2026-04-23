# Outposts 参考案例

`~/workspace/outposts` 是 SecurityDept TypeScript SDK 当前的 downstream adopter calibration case。它补充 `apps/webui`，但不替代 `apps/webui`。

`apps/webui` 仍是仓库内第一优先级 reference app 与 release-gate 证据面。`outposts` 的价值在于它是真实 consuming workspace，拥有自己的 Angular host、backend service、route table 与部署约束。

## 当前状态

迭代 150 已关闭第一条真实 adopter calibration line：

- `outposts-web -> confluence` 已改为消费 SecurityDept Angular/token-set packages，不再使用 `angular-auth-oidc-client`。
- `angular-auth-oidc-client` 已从 downstream package manifest 移除。
- Callback route 由 SDK `TokenSetCallbackComponent` 承担。
- `secureRouteRoot()` 承载 provider-neutral requirement metadata 与 next-action policy。
- `provideTokenSetAuth(...)` 注册 `Confluence` client，并使用 `providerFamily: "authentik"`、`callbackPath: "/auth/callback"` 与 Confluence API endpoint 的 URL patterns。
- `provideTokenSetBearerInterceptor({ strictUrlMatch: true })` 将 bearer injection 限制到命中已注册 `urlPatterns` 的 URL，不再对 unmatched URL 使用 single-client fallback。
- Downstream focused tests 锁住 callback path preservation、provider-neutral route metadata、bearer injection boundaries 与 redirect preservation。
- `confluence` service 既有 backend tests 锁住 issuer/JWKS/audience/scope 行为，包括 optional-audience 与 missing-scope rejection。

## 为什么这个案例重要

`outposts` 是有价值的 calibration case，因为它代表一个可能不止一个 backend service 的 host：

- 一个 frontend host 未来可能管理多个 backend token families
- 某些 route area 可能要求多个 app 的资格
- host 拥有 user-choice flow、silent/interactive acquisition decision 与 product copy
- backend 仍需要 provider-neutral bearer/OIDC validation

这种压力能暴露 SDK primitive 到底可复用，还是只是按仓库内 reference app 形状写出的局部解。

## 这个案例应该验证什么

近期验证范围：

1. 通过 SecurityDept packages 完成 Angular host integration。
2. 通过 `link:` / `path` dependencies 验证 backend-driven config projection 与本地多 workspace 开发。
3. Provider-neutral route requirements 与 callback preservation。
4. 不向第三方 URL 泄露 token 的 strict bearer-header injection。
5. Backend-side audience/scope/issuer validation。
6. 真实 adopter glue 中出现的候选 SDK ergonomics 缺口。

## 不应该把这个案例验证成什么

这个案例不证明：

- SDK 已经内建 multi-requirement chooser UI
- SDK 拥有 product route table、page copy 或 toast behavior
- `outposts` app-local `AuthService` 应被复制进 SDK
- `outposts` 替代 `apps/webui` 成为 primary release gate
- cross-repository browser automation 属于当前产品线

正确分工是：

- 当重复 adopter pressure 证明某个 headless primitive 稳定时，SecurityDept 可以将其提升。
- Adopter 拥有 product UX、business routes 与 local glue。
- `apps/webui` 保持仓库内 primary reference app 与 release evidence owner。

## 对 SDK 设计的直接影响

当前影响：

- Angular bearer injection 已拥有显式 `BearerInterceptorOptions.strictUrlMatch` 选项。
- 多 backend 或存在 third-party traffic 的 Angular host 应启用 `strictUrlMatch: true`。
- SDK 应为 keyed token-set state projection helper 保留空间，但当前 `outposts` `AuthService` 仍只是单 adopter 样本，不是 SDK API。
- Framework route adapter 应保持 provider-neutral，只表达 requirements，而不表达 provider SDK 细节。

## 近期计划

在把 `0.2.0-beta.1` 视为可进入 release execution 之前，只把这个案例作为证据与 backlog input：

1. 继续把当前单 `Confluence` path 锁定为 downstream proof。
2. 不因为一个 downstream host 的本地 glue 就新增 SDK capability。
3. 只有当 ergonomics 在多个 adopter，或同时在 `apps/webui` 与 `outposts` 中重复出现时，才记录为更高优先级候选。
4. 对任何 multi-backend 或 third-party traffic 的 Angular adopter，继续推荐 strict bearer injection。

## 中期计划

下一条有价值的 adopter evidence 是 `outposts` 中出现第二个 backend 或第二个 route requirement。这会验证当前 route-orchestration primitive 在 multi-requirement 压力下是否仍然顺手。

## 长期计划

保持 `outposts` 作为真实 feedback surface，而不是第二个仓库内 demo。它的价值在于可以与 reference app 不同，并暴露真实 host 约束。

## 本地联动开发约束

在 SDK 与 adopter 边界共同演化期间，这个案例应继续使用直接本地 workspace dependencies：

- Rust：使用指向本地 SecurityDept crates 的 `path` dependencies
- Node / pnpm：使用指向本地 SecurityDept TS packages 的 `link:` references

## 相关文档

- SDK 边界与当前契约：[007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)
- Auth context 与 modes：[020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)
- Roadmap 与 release blockers：[100-ROADMAP.md](100-ROADMAP.md)

---

[English](../en/021-REFERENCE-APP-OUTPOSTS.md) | [中文](021-REFERENCE-APP-OUTPOSTS.md)
