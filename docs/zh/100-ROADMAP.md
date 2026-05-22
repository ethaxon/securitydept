# 路线图

本文定义 SecurityDept 当前 `0.3.x` 产品范围，以及延期到该版本线之后的主题。

它不重复 release procedure、SDK package map 或迁移时间线。发布流程看 [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md)，TypeScript SDK 契约看 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)，auth-context 设计看 [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)，public-surface 变更看 [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)。

## 当前发布目标

当前 active release target 是 `0.3.x` 线。

已执行的发布历史看 [CHANGELOG](../../CHANGELOG.md)，实际 publish workflow 规则看 [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md)。本路线图只保留当前范围、release constraints 与延期主题。

## 0.3.x 优先事项

`0.3.x` 主线是在允许必要 breaking change 的前提下，让已有栈变得可解释、可测试、可发布，并改善 host ergonomics 与长期可维护性：

1. 通过 `public-surface-inventory.json`、release-gate tests、docs anchors 与 `110` migration entries，让 TypeScript SDK public surface 保持显式且可执行。
2. 继续把 `apps/webui` 作为 browser、React、route policy、error handling 与 browser-harness evidence 的首要仓库内 proof surface。
3. 继续把 `outposts` 作为 Angular hosting、backend-driven config projection、strict bearer injection、callback preservation 与 provider-neutral route metadata 的补充性下游 calibration case。
4. 完成 Rust crates、npm packages、Docker images 与 docs site 的 release packaging readiness，不扩张 auth feature 集。
5. 保持当前 auth-context parity baseline：basic-auth 与 session 有意比 token-set 更薄，但入口路径必须继续可发现、可测试。

## 产品边界

### TypeScript SDK

TypeScript 仍是 `0.3.x` 唯一 active SDK productization language。

当前 baseline 包含：

- `@securitydept/client` 中的 stable foundation helpers
- stable root basic-auth 与 session clients
- provisional browser/server/framework adapters
- provisional browser-owned token-set modes、registry、orchestration 与 React Query integration
- 来自 `apps/webui` 的真实仓库内证据
- 来自 `outposts` 的聚焦型下游校准证据

当前 baseline 不包含：

- built-in chooser UI
- product-flow copy
- app-specific route tables
- reference-app business API wrappers
- 非 TS SDK 产品化

### Rust Libraries

可复用 Rust package line 是 `packages/*` 下的 workspace library crates。`apps/server` 与 `apps/cli` 是 runtime 与 image readiness 的 release artifacts，不是 crates.io library publish targets。

release readiness 仍要求对每个 publishable crate 执行真实 `cargo package` check；`--allow-dirty` 与 `--no-verify` 不是 release evidence。

### Runtime 与 Docker

Docker image 是 reference server 加 web UI output 的 runtime artifact。当前 release 约束要求：

- toolchain versions 与 `mise.toml` / `rust-toolchain.toml` 对齐，或显式记录偏差
- 通过 `Dockerfile.runtime` 从预构建 server、CLI 与 web UI artifacts 组装 runtime image
- web UI output copy path 与真实 Vite build output 一致
- prerelease tag（例如 `vX.Y.Z-beta.N`）不发布 `latest`
- labels、cache、provenance、platform decisions 达到 release baseline

### 文档

`docs/en` 与 `docs/zh` 继续作为 source docs。`docsite/` 是 VitePress 渲染层，应通过 symlink 暴露 source docs，而不是维护第二套内容管线。

文档权责有意拆分为：

- README 与 `000` 负责入口与导航
- `007` 负责 SDK 契约
- `008` 负责 release 规则
- `100` 负责当前范围与延期主题
- `110` 负责迁移历史
- [CHANGELOG](../../CHANGELOG.md) 负责已执行的发布历史

## 延期到 0.3.x 之后的主题

以下主题仍然真实存在，但不属于当前 active release line：

- mixed-custody token ownership
- stateful BFF / server-side token-set ownership
- built-in chooser UI 或 router-level product-flow semantics
- 更重的 OTel / DI 主题
- 完整 Rust-side structured-observability/exporter stack
- 在 TS contract 收稳前推进 Kotlin / Swift SDK productization

---

[English](../en/100-ROADMAP.md) | [中文](100-ROADMAP.md)
