# Outposts 参考案例

本文档说明为什么 `/workspace/outposts` 应被视为 `securitydept` Client SDK 的一个高价值下游参考案例，以及它在近期、中期和长期分别应如何反哺 SDK 设计。

它不是 `apps/webui` 的替代品。  
`apps/webui` 仍然是第一优先级 dogfooding / reference app；`outposts` 的价值在于它代表了一个**真实下游 adopter**，而不是 SDK 自己的产品内示例。

## 为什么这个案例重要

`outposts-web` 预期承载多个后端服务，例如：

- `confluence`
- `app1`
- `app2`

这些服务未来可能分别接入不同的 OIDC client / audience / scope 组合。  
这让 `outposts` 天然具备以下验证价值：

- 同一前端宿主需要同时管理多个后端 token family / token set
- 某些前端路由区域会同时要求多个 app 的资格
- 认证流程不再只是“单 client 登录”，而是“route-level requirement orchestration”
- adopter 必须自己决定哪些步骤静默完成、哪些步骤直接跳转、哪些步骤先让用户选择

这正好能帮助我们检验：`token-set-context-client` 后续是否真的能支撑现实世界中的多资格场景，而不是只停留在单 provider / 单 callback happy path。

## 这个案例应该验证什么

近期应把 `outposts` 当成以下问题的现实验证面：

1. provider-neutral 前端 auth boundary 是否足够清晰  
   当前单 `confluence` 主链路已经切到标准 OIDC / Authentik-first baseline；接下来要验证的是这条单链路之外，前端认证能力是否还能继续保持 provider-neutral，而不是重新绑定某个 provider SDK。

2. route-level requirement orchestration 的边界应该放在哪里  
   当某个路由既需要 `app1`、又需要 `app2` 的资格时，真正困难的不是“如何拿 token”，而是：
   - 谁先拿
   - 哪些可以静默获取
   - 哪些必须交互跳转
   - 是否要先向用户展示选择界面
   - 某一个 requirement 失败时如何处理

3. 后端 Bearer / OIDC 校验是否能保持 provider-neutral  
   `confluence` 当前已经基本是 issuer + JWKS + audience + scope 校验模型。这个案例可以帮助我们确认：后端真正需要的是稳定 OIDC contract，而不是某个前端 IdP SDK 的伴随假设。

4. 本地多工作区联动开发方式是否顺畅  
   这个案例应直接使用本地指向：
   - Rust 走 `cargo` workspace `path`
   - Node 走 `pnpm` `link:`

## 不应该把这个案例验证成什么

这个案例不应被误读为：

- SDK 已经内建“多资格路由选择界面”
- SDK 已经吸收 framework router / app-level chooser / page-level auth UX
- SDK 已经完成更广 browser host semantics 或浏览器矩阵承诺
- `outposts` 将取代 `apps/webui` 成为主要 release gate

更准确的边界是：

- `securitydept` 可以为这种下游场景提供 **headless primitive / scheduler direction**
- 但 chooser UI、router policy、产品级交互流程仍然应留在 adopter 自己的 app glue 中

## 对 SDK 设计的直接影响

这个参考案例对 `token-set-context-client` 的影响最直接。

当前建议：

1. SDK 应保留对多 token family / 多 source 管理的抽象空间
2. route-level 多 requirement 编排应优先朝 **headless orchestration primitive** 演进
3. 默认推荐实现可以存在，但它应是：
   - scheduler / orchestrator 默认实现
   - 最薄的 `web` / `angular` / `react` 适配
   - reference/example UI
4. 选择界面、交互文案、失败回退策略不应直接写死在 core SDK 中

换句话说：

- **“多资格调度能力”值得进入 SDK 设计视野**
- **“多资格交互 UI”不应成为 SDK 内建职责**

## 近期计划

近期更适合做的事情：

1. 在 `outposts` 内先完成 provider-neutral auth boundary 拆分
2. 在当前标准 OIDC / Authentik-first baseline 上，优先验证：
   - callback / redirect / route preservation
   - access token 注入
   - audience / scope contract
   - `oauth-resource-server` 在真实 adopter 单链路里的 Bearer 校验基线
   - route-level requirement 调度最小原型
3. 不急着把 chooser UI 或 router glue 抽回 SDK

## 中期计划

中期更适合做的事情：

1. 从 `outposts` 的真实需求里提炼 requirement model
2. 观察哪些调度步骤足够稳定，值得上升为 SDK 的 headless orchestration primitive
3. 在 `web` / `angular` / `react` 适配层中，评估是否要提供“默认推荐调度实现”

## 长期计划

长期目标不是把 `outposts` 变成 SDK 的第二个产品内 demo，而是：

1. 让它持续充当真实 adopter 的反馈面
2. 让 SDK 的后续边界判断建立在真实项目迁移经验上
3. 明确哪些能力应该进入 SDK，哪些能力应继续留在 adopter app glue

## 本地联动开发约束

这个案例应直接采用本地工作区依赖，而不是先依赖已发布版本：

- Rust：继续使用 workspace `path` 依赖，例如 `../securitydept/packages/core`
- Node / pnpm：优先使用 `link:` 指向本地 `securitydept` TS package

原因很简单：

- 这是一个“正在共同演化”的现实 adopter 案例
- 它的价值就在于能及时验证 SDK 最新边界，而不是回头对齐已发布包

## 相关文档

- SDK 边界与当前口径：`docs/zh/007-CLIENT_SDK_GUIDE.md`
- Outposts 项目内认证方案：`/workspace/outposts/docs/zh/003-AUTH.md`

---

[English](../en/021-REFERENCE-APP-OUTPOSTS.md) | [中文](021-REFERENCE-APP-OUTPOSTS.md)
