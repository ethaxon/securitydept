# 路线图

本文是 SecurityDept 当前 planning authority，负责描述当前 stable release line、`0.2.x` backlog，以及延期到 `0.3.0` 的主题。

它不解释完整 auth-context model 或 SDK package map。auth context / mode 设计见 [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)，TypeScript SDK adopter guide 见 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)，public-surface migration guidance 见 [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)。

## 当前发布目标

当前已发布基线是当前 stable line。

详细的 release execution record 现在放在 CHANGELOG.md 和 [008-RELEASE_AUTOMATION.md](008-RELEASE_AUTOMATION.md)。这个 roadmap 只保留 stable line 上仍然有效的 release 约束，以及未来延期主题。

## 0.2.x Active Track

`0.2.x` 主线是让已有栈变得可解释、可测试、可发布：

1. 通过 `public-surface-inventory.json`、release-gate tests、evidence files、docs anchors 与 `110` migration entries，让 TypeScript SDK freeze 保持可执行。
2. 继续把 `apps/webui` 作为 browser、React、dashboard、route policy、shared error、diagnosis 与 browser harness evidence 的首要仓库内 reference app。
3. 继续把 `outposts` 作为 Angular hosting、backend-driven config projection、strict bearer injection、callback preservation、provider-neutral route metadata 的下游 adopter calibration case。
4. 完成 Rust crates、npm packages、Docker images 与 docs site 的 release packaging readiness，不新增 auth feature。
5. 保持当前 auth-context parity baseline：basic-auth 与 session 有意比 token-set 更 thin，但入口路径必须可发现、可测试。

## TypeScript SDK Product Boundary

TypeScript 仍是 `0.2.x` 唯一 active SDK productization language。

当前 baseline 包含：

- `@securitydept/client` 中的 stable foundation helpers
- stable root basic-auth 与 session clients
- provisional browser/server/framework adapters
- provisional browser-owned token-set modes、registry、orchestration 与 React Query integration
- 来自 `apps/webui` 的真实 reference proof
- 来自 `outposts` 的真实 downstream proof

当前 baseline 不包含：

- built-in chooser UI
- product-flow copy
- app-specific route tables
- reference-app business API wrappers
- 非 TS SDK 产品化

## Rust Product Boundary

可复用 Rust package line 是 `packages/*` 下的 workspace library crates。`apps/server` 与 `apps/cli` 是 build/image readiness 的 release artifacts，不是 crates.io library publish targets。

历史上的 `[patch.crates-io] openidconnect` packaging blocker 已关闭：当前 workspace 已回到 `openidconnect = "4"`。后续 release execution 仍应继续对每个 publishable crate 执行真实 `cargo package` check，不得把 `--allow-dirty` 或 `--no-verify` 当通过证据。

## Docker Product Boundary

Docker image 是 reference server 加 web UI output 的 runtime artifact。当前 release 约束要求：

- toolchain versions 与 `mise.toml` / `rust-toolchain.toml` 对齐，或显式记录偏差
- web UI output copy path 与真实 Vite build output 一致
- pre-release tag（例如 `vX.Y.Z-beta.N`）不发布 `latest`
- labels、cache、provenance、platform decisions 达到 release baseline

## Docs Product Boundary

`docs/en` 与 `docs/zh` 继续作为 source docs。`docsite/` 是 VitePress source root；它应通过 `docsite/docs` symlink 暴露 `docs/`，并只对 root README / LICENSE 入口页保留链接接入，不复制内容。

项目文档按以下方式阅读：

- `000` overview 与 doc index
- `001` architecture 与 crate boundaries
- `002` capability matrix
- `005` error system design
- `006` real-IP strategy
- `007` client SDK adopter guide 与 public-surface snapshot
- `020` auth context / mode design
- `021` downstream reference case
- `100` roadmap 与 release blockers
- `110` TS SDK migration guide

## 延期到 0.3.0 的主题

以下主题仍然真实存在，但不属于当前 active release line：

- mixed-custody token ownership
- stateful BFF / server-side token-set ownership
- built-in chooser UI 或 router-level product-flow semantics
- 更重的 OTel / DI 主题
- 完整 Rust-side structured-observability/exporter stack
- 在 TS contract 收稳前推进 Kotlin / Swift SDK productization

---

[English](../en/100-ROADMAP.md) | [中文](100-ROADMAP.md)
