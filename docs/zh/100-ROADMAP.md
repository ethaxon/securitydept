# 路线图

本文是 SecurityDept 当前 planning authority，负责描述 `0.2.0-beta.1` readiness line、`0.2.x` backlog，以及延期到 `0.3.0` 的主题。

它不解释完整 auth-context model 或 SDK package map。auth context / mode 设计见 [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)，TypeScript SDK adopter guide 见 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)，public-surface migration history 见 [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)。

## 当前发布目标

当前 release-preparation 目标是 `0.2.0-beta.1`。

这个 beta 不是新的 auth capability milestone。它是当前 reusable Rust crates、TypeScript SDK packages、Docker image 与 static docs site 的第一条 packaging / documentation readiness line。

本轮 prep 非目标：

- 不推 tag
- 不执行 crates.io publish
- 不执行 npm publish
- 不推 GHCR image
- 不创建 release
- 不提交 generated docsite output
- 不推进 mixed-custody / BFF / server-side token ownership

## 0.2.0-beta.1 Blockers

进入 release execution 前，必须解决或显式接受以下 beta 限制：

| Area | 当前 blocker | 必要裁决 |
|---|---|---|
| Rust crates | workspace crates 仍是 `0.2.0-alpha.4`；缺少 crates.io metadata（`license`、`description`、`repository`、`readme`、`keywords`、`categories`） | publish matrix 必须标出 publishable crates、app crates、dependency order 与 metadata fixes |
| Rust packaging | workspace 使用 `[patch.crates-io] openidconnect` 指向 Git branch | 必须通过真实 `cargo package` checks 证明影响，并记录是否阻塞 beta publish |
| Rust apps | `apps/server` 与 `apps/cli` 是 application artifacts，不是 library crates | 标记 `publish = false` 或记录等价 release-policy decision |
| npm packages | SDK packages 仍是 `0.1.0`；publishable packages 目标为 `0.2.0-beta.1` | package matrix 必须区分 publishable SDK 与 internal utilities |
| npm internal utilities | `@securitydept/e2e-utils` 与 `@securitydept/test-utils` 不是 beta npm target | 标为 `publish = no` / internal，不把 pack output 当 publish evidence |
| Angular packages | APF exports warning 与 dist export alignment 需要分类 | 若阻塞 beta 则修复；否则记录为接受的 beta limitation |
| Docker | Dockerfile/toolchain/tag behavior 必须匹配 beta release policy | 修复 stale build facts；确认 beta tag 不推 `latest` |
| Docs | source docs 必须与 code/test facts 一致，current-status docs 不写历史流水账 | 完成 docs audit 并保持 EN/ZH parity |
| Docsite | Pages 发布目前只能依赖脆弱的 `docs/site` symlink 包装层 | 将站点根迁到 `docsite`，暴露 `docsite/docs -> ../docs`，并把链接重写缩减为显式且最小的规则 |

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

进入 beta release execution 前，每个 publishable crate 都需要真实 `cargo package` check，不得使用 `--allow-dirty` 或 `--no-verify` 当通过证据。`[patch.crates-io] openidconnect` 在被证明无影响前，应按 likely packaging blocker 对待。

## Docker Product Boundary

Docker image 是 reference server 加 web UI output 的 runtime artifact。Beta readiness 要求：

- toolchain versions 与 `mise.toml` / `rust-toolchain.toml` 对齐，或显式记录偏差
- web UI output copy path 与真实 Vite build output 一致
- pre-release tag（例如 `v0.2.0-beta.1`）不发布 `latest`
- labels、cache、provenance、platform decisions 达到 beta baseline

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
- `110` TS SDK migration ledger

## 延期到 0.3.0 的主题

以下主题仍然真实存在，但不属于 `0.2.0-beta.1` 与 `0.2.x` active release line：

- mixed-custody token ownership
- stateful BFF / server-side token-set ownership
- built-in chooser UI 或 router-level product-flow semantics
- 更重的 OTel / DI 主题
- 完整 Rust-side structured-observability/exporter stack
- 在 TS contract 收稳前推进 Kotlin / Swift SDK productization

---

[English](../en/100-ROADMAP.md) | [中文](100-ROADMAP.md)
