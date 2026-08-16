# Outposts 外部参考应用

[Outposts](https://github.com/ethaxon/outposts) 是 SecurityDept Angular OIDC
与 Rust resource-server 集成的一个维护中的外部参考应用。它提供有价值的下游
证据，但不属于本仓库的 source tree、release gate、public API 或可复现的 test
contract。

## 依赖基线

Outposts 使用已发布的 SecurityDept package，而不是本地 workspace link。
应用、SDK 与 toolchain 的准确版本以 Outposts 的 manifest 和 lockfile 为准；
复现集成时应检查所选 Outposts revision。npm 与 Rust 依赖可以分别升级。

| Surface | Outposts dependency |
| --- | --- |
| Angular 浏览器 foundation | `@securitydept/client` |
| Angular framework bridge | `@securitydept/client-angular` |
| 前端 OIDC 与 registry | `@securitydept/token-set-context-client` |
| Angular OIDC adapter | `@securitydept/token-set-context-client-angular` |
| Rust server entry point | `securitydept-core` |

Confluence backend 启用 core 的 `oauth-resource-server`、`creds` 与
`token-set-context` feature。Angular、Nx 与 TypeScript 的版本是 adopter 细节，
并非 SecurityDept 的 toolchain 要求。

## 此参考应用覆盖的集成

Outposts 为下列已发布 contract 提供具体证据：

- `provideEnvironment(...)` 将 Angular routing 与 native-web environment
  组合。展平的 `routerForAngularCreateOptions` 提供浏览器 `location`、
  `history`、`navigation` 与 `window`：in-app navigation 经 Angular Router
  分发，外部 OIDC authorization URL 则经 native-web 进行整页跳转。
- `provideTokenSetClientRegistry(...)` 拥有 Confluence frontend OIDC client。
  它按以下顺序解析公开配置：server-injected Realm projection、持久化的浏览器
  cache、Confluence public config endpoint。
- `secureTokenSetRouteRoot(...)` 保护 Angular 的 `/confluence` route，
  `TokenSetFrontendCallbackComponent` 处理 `/auth/callback`；host callback wrapper
  在处理成功后导航到 `postAuthRedirectUri`。
- frontend OIDC 配置采用 `refreshErrorPolicy: "revokeAsUnauthenticated"`，
  确认 refresh token 被撤销后，受保护路由仍可重新发起登录。
- registry authorization interceptor 仅向配置的 Confluence API origin/path
  附加 Bearer token，并排除用于初始化 client 的 public config endpoint。
- 根作用域 `AuthService` 订阅 registry 的 non-replay `errors` 流，将原始
  `ClientError` 交给 overlay service。registry 统一聚合 client operation 与
  factory/materialization error；订阅不会触发 lazy client 初始化。
- overlay service 使用 `readErrorPresentationDescriptor()` 生成最终 Sonner
  展示；标题可以包含 span 捕获的 client/operation 上下文，同时不会暴露
  tracing-only attribute 或 runtime diagnostic。
- Confluence Rust service 作为 SecurityDept OAuth resource server，通过
  discovery、JWKS、可选 audience validation 与配置的 scopes 校验 access token。

Outposts 也在根 `rust-toolchain.toml` 固定 Rust；mise 与 Linux amd64/arm64
GitHub build 使用同一个 authority，而不是安装另一套移动 nightly toolchain。

这是 integration reference，不是规定性的 application architecture。尤其是
Outposts 的 route table、config-projection host、UI component 和 Confluence API
都不是 SDK public API。

## 将其作为下游证据

使用 Outposts 评估 SecurityDept release 时：

1. 记录 Outposts revision 及其 manifest/lockfile 中的已安装 SDK 版本，或明确记录待验证的 packed candidate version；
2. 记录准确的 package/subpath、framework version 与观察到的行为；
3. 将重复出现且可泛化的问题转化为仓库内 contract test 与 focused documentation
   update；
4. 仍以 package export 和 `public-surface-inventory.json` 定义 SDK boundary。

本仓库的 executable baseline 仍为 `apps/server` 与 `apps/webui`。TypeScript
支持边界见 [Client SDK 指南](007-CLIENT_SDK_GUIDE.md)，当前范围见
[路线图](100-ROADMAP.md)。

---

[English](../en/021-REFERENCE-APP-OUTPOSTS.md) | [中文](021-REFERENCE-APP-OUTPOSTS.md)
