# 路线图

本文是 SecurityDept 当前 planning authority，负责描述 `0.2.0-beta.3` readiness line、`0.2.x` backlog，以及延期到 `0.3.0` 的主题。

它不解释完整 auth-context model 或 SDK package map。auth context / mode 设计见 [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)，TypeScript SDK adopter guide 见 [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)，public-surface migration guidance 见 [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)。

## 当前发布目标

当前已发布基线是 `0.2.0-beta.3`。

这个 beta 不是新的 auth context milestone。它是当前 reusable Rust crates、TypeScript SDK packages、Docker image 与 static docs site 的 packaging、documentation、downstream-adopter router correctness 与 release-readiness line。

当前仓库侧的目标不再是“证明能不能发布”，而是保持 release automation、authority docs 与已发布事实一致，为下一次 release execution 继续提供可复用路径。当前 release-pipeline hardening 主线只保留 `docs.yml`、`tests.yml` 和一个受保护的 `release.yml` workflow 作为 active automation，并由 `release.yml` 统一拥有 npm、crates.io 与 Docker publish。

## 0.2.0-beta.3 Release Record And Remaining Work

版本权威已推进到 `0.2.0-beta.3`。发布执行前后必须持续保持以下 release-readiness 事实一致：

- publishable Rust crates 版本、metadata、dependency order 与默认 `cargo package` report 必须对齐到 `0.2.0-beta.3`
- root `[patch.crates-io] openidconnect` 已移除，workspace 已回到 `openidconnect = "4"`
- `apps/server` 与 `apps/cli` 已明确为 `publish = false` 的 application artifacts
- publishable TS SDK packages 已切到 `0.2.0-beta.3`，internal utility packages 保持 private
- `release.yml` 内的 npm 与 crates publish jobs 已切到 GitHub OIDC trusted publishing
- Angular 与 TanStack Router auth redirect helpers 会保留 attempted-route `postAuthRedirectUri`，并在启动整页外部 redirect 后避免 settle framework guard result
- token-set TypeScript SDK 的 bearer injection 已具备 freshness-aware 语义：expired access token 会先通过 coalesced barrier refresh，再发送 protected request；无法刷新时会清理/进入 unauthenticated，而不是继续向 downstream 发送 expired bearer

当前仍需持续维护的事项是下一次 release execution 的可重复性，而不是 alpha-era blocker：

| Area | 当前状态 | 下一步要求 |
|---|---|---|
| Rust crates publish | `release.yml` 现在在 `crates-release` job 内完成 package 与 publish，并使用 `crates-io-release` environment、OIDC trusted publishing 与 already-published crate version skip 语义 | release run 必须保留 package / publish report artifact，保持 trusted publisher binding 与 `release.yml` 一致，并继续禁止在 publish path 使用 `--allow-dirty` / `--allow-blocked` |
| npm publish | `release.yml` 现在在 `npm-release` job 内构建 TypeScript SDK packages 并发布，使用 `npm-release` environment、OIDC trusted publishing、`--provenance` 与 npm report artifact | 后续继续保持 package-root publish 语义、trusted publisher binding 与 `release.yml` 一致，并保留 publish report |
| Docker | image publish 归 `release.yml`；runtime artifacts 在 Docker 外构建，再通过 Debian-slim `Dockerfile.runtime` 组装 | 继续保持 runtime artifact path、ABI/base image 选择、tags、labels 与 docs 口径一致 |
| Release workflow benchmark | release-profile cache prime 目前是实践裁决下采用的暂定优化，并具备唯一 writer 拓扑，但不是已完成的耗时证明 | 等 `pretend-act` 或等价本地 workflow benchmark 能提供可复现测量后，再基于数据调整 release cache/build 拆分 |
| Docs and roadmap authority | source docs 现在描述当前 release 与 SDK 事实 | 后续 release 不要把历史 blocker 重新写回 current-status docs |
| Docsite | `docsite/` 已是 VitePress source root，根内容通过最小链接改写接入 | 继续保持链接规则与 source docs 同步，不引入新的 staging pipeline |
| Downstream Angular bearer freshness | `outposts` 暴露了 stale bearer failure mode：expired JWT 到达 Confluence 后被后端正确以 `ExpiredSignature` 拒绝；现在 SDK core 拥有 freshness check、refresh coalescing 与 no-stale-header 行为，供 Angular/React/transport 调用 | 后续把 outposts validation 留在 release evidence loop 中；若 SDK bearer path 再出现 `ExpiredSignature`，应按 refresh-material 或 barrier regression 处理 |

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

pre-beta 阶段的 `[patch.crates-io] openidconnect` packaging blocker 已关闭：当前 workspace 已回到 `openidconnect = "4"`。后续 release execution 仍应继续对每个 publishable crate 执行真实 `cargo package` check，不得把 `--allow-dirty` 或 `--no-verify` 当通过证据。

## Docker Product Boundary

Docker image 是 reference server 加 web UI output 的 runtime artifact。Beta readiness 要求：

- toolchain versions 与 `mise.toml` / `rust-toolchain.toml` 对齐，或显式记录偏差
- web UI output copy path 与真实 Vite build output 一致
- pre-release tag（例如 `v0.2.0-beta.3`）不发布 `latest`
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
- `110` TS SDK migration guide

## 延期到 0.3.0 的主题

以下主题仍然真实存在，但不属于 `0.2.0-beta.3` 与 `0.2.x` active release line：

- mixed-custody token ownership
- stateful BFF / server-side token-set ownership
- built-in chooser UI 或 router-level product-flow semantics
- 更重的 OTel / DI 主题
- 完整 Rust-side structured-observability/exporter stack
- 在 TS contract 收稳前推进 Kotlin / Swift SDK productization

---

[English](../en/100-ROADMAP.md) | [中文](100-ROADMAP.md)
