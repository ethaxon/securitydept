# SecurityDept 概览

本文是 SecurityDept 文档地图。[README](../../README_zh.md) 是仓库入口页；本概览负责告诉不同读者下一步应该看哪里，以及各文档分别承担什么职责。

具体契约以 focused docs 为准。发布流程看 [发布自动化](008-RELEASE_AUTOMATION.md)，当前范围与延期主题看 [路线图](100-ROADMAP.md)，已执行的发布历史看 [CHANGELOG](../../CHANGELOG.md)。

## 读者路径

### Rust 使用方

当你的集成点是 server、proxy 边界、service mesh edge 或凭证管理工具时，使用 SecurityDept Rust crates。

- 先看 [001-ARCHITECTURE.md](001-ARCHITECTURE.md)，理解 crate 分层和所有权。
- 再看 [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)，理解 Basic Auth context、session context 与 token-set context。
- 当 route-facing errors、protocol exceptions 或 diagnostics 重要时，看 [005-ERROR_SYSTEM_DESIGN.md](005-ERROR_SYSTEM_DESIGN.md)。
- 当部署位于 trusted reverse proxies、CDNs 或 provider-specific ingress layers 后方时，看 [006-REALIP.md](006-REALIP.md)。

### TypeScript SDK 使用方

当你的集成点是 browser、React、Angular 或 host-framework code 时，使用 SDK packages。

- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) 是 package boundaries、subpaths、stability labels、adapter contracts 与 public API shape 的权威文档。
- [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) 记录 public-surface migration decisions。
- [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md) 记录下游 Angular/token-set calibration case，以及它的证据边界。

### 运行时使用方

当你需要可执行基线，而不是只做 library-only integration 时，使用参考运行时与 Docker image。

- `apps/server` 是 Axum 参考服务端。
- `apps/webui` 是 React reference UI。
- Docker image 组合 server 与 web UI artifacts。
- [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) 负责 tag policy、publish workflow 与 release entrypoints。

### 贡献者与发布维护者

修改 SecurityDept 本身时，从这些文档进入。

- [002-FEATURES.md](002-FEATURES.md) 跟踪 implemented vs planned capabilities。
- [100-ROADMAP.md](100-ROADMAP.md) 跟踪当前 `0.3.x` 范围与延期主题。
- [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) 解释 `securitydept-metadata.toml`、`release-cli`、just recipes 与 publish workflows。
- [CHANGELOG](../../CHANGELOG.md) 记录已经执行过的 release 工作；它不是未来规划文档。

## 文档权责

这些文档各自负责不同层次：

- [README](../../README_zh.md)：仓库入口、产品定位与贡献者入口。
- `000` 概览：文档地图与权责边界。
- [001-ARCHITECTURE.md](001-ARCHITECTURE.md)：Rust/runtime 分层与 artifact 边界。
- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)：TypeScript SDK package 与 adapter contract。
- [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md)：release 规则、workflow 行为与 version/channel policy。
- [100-ROADMAP.md](100-ROADMAP.md)：当前产品范围、release constraints 与延期主题。
- [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)：public-surface migration ledger。
- [CHANGELOG](../../CHANGELOG.md)：已执行的 release 历史。

如果两份文档发生重叠，以更聚焦的文档为详细 contract 的唯一所有者。

## Artifact 边界

### Rust Crates

可发布 Rust library line 是 `packages/*` 下的 reusable crates：

- credential、token 与 real-IP primitives
- OIDC/OAuth provider 与 resource-server 行为
- Basic Auth、session、token-set auth-context services
- `securitydept-core` 对齐 re-exports

`apps/server` 与 `apps/cli` 是 runtime artifacts，不是 crates.io library surfaces。

### TypeScript SDK Packages

可发布 SDK line 是 `sdks/ts/packages/*` 下的 packages，按以下方向分组：

- shared client foundation packages
- Basic Auth context client packages
- session context client packages
- token-set context client packages
- React 与 Angular framework adapters

`apps/webui/src/api/*` 下的 reference-app code 是本地 glue，不应视为 SDK API。

### Reference Runtime

reference runtime 主要用于证明跨层行为：

- multi-context login 与 logout routing
- management API authorization across session、Basic Auth、token-set modes
- bearer propagation 与 route-level error-envelope boundaries
- 通过仓库内 proof 和 focused downstream calibration 验证 React / Angular SDK ergonomics

### 文档站点

源文档位于 `docs/en` 与 `docs/zh`。`docsite/` 下的 VitePress site 通过 symlink 渲染这些源文档；它是展示层，不是第二套内容权威来源。

## 权威文档

| 文档 | 用途 |
| --- | --- |
| [001-ARCHITECTURE.md](001-ARCHITECTURE.md) | 分层、crate ownership 与 runtime boundaries |
| [002-FEATURES.md](002-FEATURES.md) | implemented vs planned capability status |
| [005-ERROR_SYSTEM_DESIGN.md](005-ERROR_SYSTEM_DESIGN.md) | safe public errors、protocol exceptions 与 internal diagnostics |
| [006-REALIP.md](006-REALIP.md) | trusted-peer-aware client IP resolution |
| [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) | TypeScript SDK package boundaries、adapters 与 public contracts |
| [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) | release metadata、package publishing、Docker tags 与 docs-site workflow |
| [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md) | Basic Auth、session、token-set auth-context design |
| [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md) | Angular/token-set calibration 与 host-pressure notes |
| [100-ROADMAP.md](100-ROADMAP.md) | 当前 release 范围与延期主题 |
| [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) | TypeScript SDK migration ledger |
| [CHANGELOG](../../CHANGELOG.md) | 已执行的 release 历史 |

## 文档规则

- 面向用户的 docs 只描述当前行为或明确的未来计划。
- 历史实现细节与发布时间线进入 [CHANGELOG](../../CHANGELOG.md)，不进入稳定 focused docs。
- README、overview 与 focused doc 重叠时，focused doc 拥有详细 contract。
- `outposts` 这类下游案例可以为设计和 ergonomics 提供证据，但不能替代仓库内发布验证。
- 中英文文档应保持含义等价；非英文文档链接优先指向同语言目录。

---

[English](../en/000-OVERVIEW.md) | [中文](000-OVERVIEW.md)
