# SecurityDept 概览

本文是 SecurityDept 文档地图。README 是仓库入口页；本概览说明不同读者下一步应该看哪里，以及当前 artifact 边界是什么。

当前 release line：`0.2.0-beta.1`。

## 读者路径

### Rust Adopters

当你的集成点是 server、service mesh 边界、proxy 或本地 credential-management 工具时，使用 SecurityDept Rust crates。

- 先看 [001-ARCHITECTURE.md](001-ARCHITECTURE.md)，理解 crate 分层和所有权。
- 再看 [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)，理解 Basic Auth context、session context 与 token-set context。
- 当 route-facing errors、protocol exceptions 或 diagnostics 重要时，看 [005-ERROR_SYSTEM_DESIGN.md](005-ERROR_SYSTEM_DESIGN.md)。
- 当部署位于 trusted reverse proxies、CDNs 或 provider-specific ingress layers 后方时，看 [006-REALIP.md](006-REALIP.md)。

### TypeScript SDK Adopters

当你的集成点是 browser、React、Angular 或 host-framework code 时，使用 SDK packages。

- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) 是 package boundaries、subpaths、stability labels、adapter contracts 与 public API shape 的权威文档。
- [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) 记录 public-surface migration decisions。
- [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md) 记录下游 Angular/token-set calibration case。

### Reference App And Runtime Adopters

当你需要可执行 baseline，而不是只做 library-only integration 时，使用 reference app 与 Docker image。

- `apps/server` 是 Axum reference server。
- `apps/webui` 是 React reference UI。
- Docker image 组合 server 与 web UI output；release tags 由 `release-cli docker publish` 规划。
- [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) 是 package、image、docs-site 与 CI release 行为的权威文档。

### Contributors And Release Maintainers

修改 SecurityDept 本身时，从这些文档进入。

- [002-FEATURES.md](002-FEATURES.md) 跟踪 implemented vs planned capabilities。
- [100-ROADMAP.md](100-ROADMAP.md) 跟踪当前 release 状态、beta readiness 与 deferrals。
- [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md) 解释 `securitydept-metadata.toml`、`release-cli`、just recipes 与 publish workflows。

## Artifact 边界

### Rust Crates

可发布 Rust library line 是 `packages/*` 下的 reusable crates：

- credential、token 与 real-IP primitives
- OIDC/OAuth provider 与 resource-server 行为
- Basic Auth、session、token-set auth-context services
- `securitydept-core` 对齐 re-exports

`apps/server` 与 `apps/cli` 是 build/runtime artifacts，不是 crates.io library surfaces。

### TypeScript SDK Packages

可发布 SDK line 是 `sdks/ts/packages/*` 下的 packages，按以下方向分组：

- shared client foundation packages
- Basic Auth context client packages
- session context client packages
- token-set context client packages
- React 与 Angular framework adapters

`apps/webui/src/api/*` 下的 reference-app code 是本地 glue，不应视为 SDK API。

### Reference Applications

reference applications 用于证明跨层行为：

- multi-context login 与 logout routing
- management API authorization across session、Basic Auth、token-set modes
- bearer propagation 与 route-level error-envelope boundaries
- 通过本地和下游 adopter tests 验证 React / Angular SDK ergonomics

### Docs Site

源文档位于 `docs/en` 与 `docs/zh`。`docsite/` 下的 VitePress site 通过 symlink 引用这些源文档，并与主 app 独立构建。

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
| [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md) | Angular/token-set integration 的下游 adopter calibration |
| [100-ROADMAP.md](100-ROADMAP.md) | 当前 release 状态与 deferrals |
| [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) | TypeScript SDK migration ledger |

## 文档规则

- 面向用户的 docs 只描述当前行为或明确的未来计划。
- 历史实现细节不进入稳定 docs。
- README、overview 与 focused doc 重叠时，focused doc 拥有详细 contract。
- 中英文文档应保持含义等价；非英文文档链接优先指向同语言目录。

---

[English](../en/000-OVERVIEW.md) | [中文](000-OVERVIEW.md)
