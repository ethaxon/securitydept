# Release 自动化

本文是 SecurityDept release 自动化的详细权威文档，用于展开 [AGENTS.md](../../AGENTS.md) 中的精简规则，并定义本地 release 命令、版本约束与 GitHub workflow 的预期行为。

## 适用范围

release authority 只分成两层：

- [`securitydept-metadata.toml`](../../securitydept-metadata.toml) 是项目版本与 release-managed manifest 集合的唯一事实源。
- [`scripts/release-cli.ts`](../../scripts/release-cli.ts) 是版本变更、npm 发布、crates 发布与 Docker tag 计算的唯一支持入口。

`justfile`、pre-commit hook 与 GitHub Actions 都应调用 `release-cli` 或 `just release-*`，不应再携带第二份 release channel 或 tag 推导逻辑。

## 支持的版本形态

SecurityDept 只允许三种 release version：

- `X.Y.Z`
- `X.Y.Z-alpha.N`
- `X.Y.Z-beta.N`

以下形态会被拒绝：

- `-rc.N`
- `alpha` / `beta` 之外的 prerelease 标识
- `-beta.1.foo` 这类额外 prerelease 段
- `+build.5` 这类 build metadata

仓库通过 `release-cli version check` 和 `release-cli version set` 对这套规则进行强制约束。

## Channel 映射

release channel 由版本号自动推断，而不是手工传参。

| 版本形态 | 阶段 | npm dist-tag | Docker channel tag |
| --- | --- | --- | --- |
| `X.Y.Z-alpha.N` | 早期预发布 | `nightly` | `nightly` |
| `X.Y.Z-beta.N` | release-candidate 阶段 | `rc` | `rc` |
| `X.Y.Z` | 稳定发布 | `latest` | `latest`、`release` |

这样选择的原因是：

- `latest` 是 npm 与容器生态里最标准的稳定版本约定。
- `nightly` 能明确表达 alpha 构建仍处于快速变动阶段，不应作为默认消费版本。
- `rc` 比直接暴露 `beta` 更贴近对外发布语义，能告诉下游这是预发布但已经进入 release 验证阶段。
- 稳定容器镜像额外附带 `release`，方便人类在部署脚本中显式引用稳定别名，同时 `latest` 仍保留默认生态语义。

## Release CLI 命令

主要命令：

- `node scripts/release-cli.ts metadata sync`
- `node scripts/release-cli.ts version check`
- `node scripts/release-cli.ts version set 0.2.0-beta.3`
- `node scripts/release-cli.ts npm publish --mode=dry-run --report=temp/release/npm/dry-run-report.json`
- `node scripts/release-cli.ts npm publish --mode=publish --provenance --report=temp/release/npm/publish-report.json`
- `node scripts/release-cli.ts crates publish --mode=package --report=temp/release/crates/package-report.json`
- `node scripts/release-cli.ts crates publish --mode=package --allow-blocked --allow-dirty --report=temp/release/crates/blocked-package-report.json`
- `node scripts/release-cli.ts crates publish --mode=publish --report=temp/release/crates/publish-report.json`
- `node scripts/release-cli.ts docker publish --ref=refs/tags/v0.2.0-beta.3`
- `node scripts/release-cli.ts workflow tests-preflight --format=github-output`
- `node scripts/release-cli.ts workflow release-plan --format=github-output`

行为规则：

- `metadata sync` 会把 [`securitydept-metadata.toml`](../../securitydept-metadata.toml) 中的共享发布元信息写入 publishable Rust crate 和 publishable npm package，包括 description、author、license、Rust crate 的 categories、keywords、repository 链接以及最简 `README.md`。
- `version set` 会更新 [`securitydept-metadata.toml`](../../securitydept-metadata.toml) 中列出的所有 release-managed `package.json` 和 `Cargo.toml`。
- `version check` 也会校验 publishable Rust crate 之间的 `path` 依赖版本，并要求内部依赖使用 `=X.Y.Z[-alpha.N|-beta.N]` 这种精确版本约束。
- `version set` 也会为这些 publishable Rust 内部依赖写入精确版本约束，保证本地 package 校验与 publish 准备阶段的一致性。
- `npm publish` 默认从版本号推断 dist-tag，除非显式传 override。
- `npm publish` 在 GitHub Actions 的 tag workflow 中会自动关闭 pnpm 的 Git branch 校验，避免 detached release tag checkout 因 `publish-branch` 限制失败。
- `npm publish --mode=publish` 会先查询 npm registry，遇到已经存在的版本就直接跳过，因此在部分 package 已成功发布后重跑时，只会继续剩余的 package。
- `npm publish --report=...` 会写出 package 发布/跳过结果，供本地 release recipe 和 GitHub Actions artifact 共用。
- npm package 的 tarball manifest 清洗现在统一由仓库根级 [`/.pnpmfile.cjs`](../../.pnpmfile.cjs) 的 `hooks.beforePacking` 负责，而不是由 release script 临时改写文件。这个 hook 会把 `@securitydept/*` 的 `workspace:` 版本说明符改写成当前发布包的版本，对所有发布包移除 monorepo 专用的 `monorepo-tsc` export condition，并对 Angular 发布态额外清理不应保留的字段，例如 root-only 的 `files` 和 `devDependencies`。
- Angular SDK packages 必须从 package root 发布，并通过 `publishConfig.directory = "dist"` 指向构建产物；不要直接在 `dist` 目录里运行 `pnpm pack` 或 `pnpm publish`，因为那会在 `beforePacking` 介入前丢失 workspace resolution context。
- GitHub Actions 里的 npm publish job 使用 GitHub OIDC 走 npm trusted publishing，不再注入长期有效的 `NPM_TOKEN`；workflow 与本地正式发布入口都显式传 `--provenance`，避免 provenance 依赖隐含默认行为。
- `crates publish --allow-dirty` 只用于本地 blocked packaging 循环，解决工作树故意脏状态下的 `cargo package` 校验；CI publish 流程不应使用它。
- 默认的 `crates publish --mode=package` gate 会用一次 `cargo package --workspace` 打包所有 publishable workspace crates。这是 prerelease 内部依赖链所必需的，因为 Cargo 会在后续 crate 的校验阶段优先从临时打包 registry 解析刚刚打包的上游 crate，而不是只去 crates.io 查还没发布的新版本。
- `crates publish --mode=package` 与 `crates publish --mode=publish` 使用 Cargo 默认的 package/publish verification 行为。它们不会传 `--release`；校验编译因此使用 dev/debug target 目录，`crates-release` 只读恢复 Tests workflow debug cache，而不是 Docker release-profile cache。
- `crates publish --mode=publish` 在每个 crate upload 前都会先查询 crates.io，已经存在的版本会直接跳过，因此部分发布成功后可安全重跑。
- `temp/release/crates/package-report.json` 只保留给非 `--allow-blocked`、非 `--allow-dirty` 的真实 package gate；blocked diagnostic 必须写入独立 report，例如 `temp/release/crates/blocked-package-report.json`。
- GitHub Actions 里的 crates publish job 通过 `rust-lang/crates-io-auth-action@v1` 把 GitHub OIDC token 交换成短时 crates.io publish token，再传给 `cargo publish`；它不再读取仓库 secret 形式的 `CARGO_REGISTRY_TOKEN`。
- `docker publish` 是 Docker tag 规划的唯一权威入口，可输出 human-readable 文本、JSON 或 GitHub Actions output。

## Just Recipes

`justfile` 按功能主题分组，保证本地入口稳定可读：

- bootstrap 与环境初始化
- 本地开发
- build 任务
- lint 与维护
- release 自动化
- 测试与校验
- 工具型命令

release 块里不再显式传 `beta` 标签。当前版本号本身已经携带阶段信息，因此 `just release-npm-dry-run`、`just release-npm-publish` 之类命令都应自动推断 channel。

## GitHub Actions 规则

release 相关 workflow 必须遵循：

- active workflow 入口只保留 `.github/workflows/docs.yml`、`.github/workflows/tests.yml` 和 `.github/workflows/release.yml`。
- `tests.yml` 拥有仓库验证。它在 `main`、`release`、`v*.*.*` tag、指向 `main` 的 pull request 与 manual dispatch 上运行，并上传 `tests-workflow-report`，方便 release run 按源 SHA 审计。`release` 分支 push 的 Tests 全部成功后，由 `tests.yml` 使用 `workflow_dispatch` 调度 `.github/workflows/release.yml`，并把 source ref/SHA 与 publish toggles 显式传入。
- `release.yml` 是唯一 release/build/publish authority。它只通过 `workflow_dispatch` 进入，原因是 crates.io trusted publishing 不支持 `workflow_run` 触发事件；自动发布路径也必须经由 Tests 成功后的 dispatch，而不是直接从 `workflow_run` 请求 OIDC。
- `release.yml` 拥有 source publish gate：它通过 `release-cli workflow release-plan` 解析 source，运行 `release-cli version check`，比较 checked-in version 与 expected tag，并在任何 publish job 运行前校验 tag 或 `release` 分支 source lineage。
- `release` 分支 publish 是当前自动发布主路径。它的 expected tag policy 是 `create-after-publish`：`release-plan` 与 `validate-release-ref` 会报告 expected tag 状态，发布前允许 expected tag 缺失；如果 expected tag 已存在，则必须已经指向所选 source SHA，否则发布前失败。
- 所有被选择的 publish jobs 成功后，`release-tag` job 会为 `release` 分支 source 创建并推送 expected `vX.Y.Z[-alpha.N|-beta.N]` tag。在 release 分支路径中，tag 是发布结果与审计锚点；如需针对 tag 或其它 source 进行审计/重跑，必须手动 dispatch `release.yml` 并让同一 release gate 通过。
- `release.yml` 的 `workflow_dispatch` 只有在所选 source 通过同一 release gate 后才可发布；manual toggles 决定 npm、crates 与 Docker publish job 是否运行。
- 本地 `act` run 会由 `release-cli workflow release-plan` 通过 `ACT=true` 或 `SECURITYDEPT_LOCAL_ACTIONS=true` 识别，并输出 `local_run=true`。Workflow 保持同一 job graph，但 publish jobs 会切到本地安全行为：npm 使用 `--mode=dry-run`，crates 停在 package gate 并把 package report 复制为 publish report，Docker 只在本地 build/load runtime image，不登录也不 push。
- 本地 `act` release source validation 会保留 version/tag shape 校验，但不执行远程 `origin/release` fetch。真实 GitHub run 仍会在发布前强制校验 source 可从 `origin/release` 到达。
- npm publish 继续直接调用 `release-cli npm publish`，不暴露手工 dist-tag 选择器。
- npm publish 必须保留从 package root 发起的调用方式，这样 pnpm 才能同时应用 Angular package 的 `publishConfig.directory` 与仓库根 `.pnpmfile.cjs` 中的 `beforePacking` hook。
- 真实 npm OIDC publish 发生在 `release.yml` 内的 `npm-release` job，并使用 `npm-release` environment。npm trusted publisher 配置因此必须把 publishable packages 绑定到 `.github/workflows/release.yml` 和 `npm-release`。
- `npm-release` 是唯一允许请求 npm `id-token: write` 的 job；它从已验证 source 构建 TypeScript SDK packages，并通过 `release-cli npm publish --mode=publish --provenance --report=...` 发布。
- npm publish 依赖 GitHub Actions trusted publishing，正式 publish 路径显式传 `--provenance`。
- crates publish 调用 `release-cli crates publish`；package gate 不得带 `--allow-blocked`，publish job 不允许带 `--allow-dirty` 或 `--allow-blocked`，并通过 `rust-lang/crates-io-auth-action@v1` 使用 crates.io trusted publishing。
- 真实 crates.io OIDC publish 发生在 `release.yml` 内的 `crates-release` job，并使用 `crates-io-release` environment。crates.io trusted publisher 配置必须把 publishable crates 绑定到 `.github/workflows/release.yml` 和 `crates-io-release`。
- `crates-release` 是唯一允许请求 crates.io `id-token: write` 的 job；它先运行 `crates publish --mode=package`，再通过 `rust-lang/crates-io-auth-action@v1` 交换 GitHub OIDC，最后运行 `crates publish --mode=publish`。Package 与 publish report 会分别上传。
- Docker release publish 在单一 `docker-release` job 内采用 artifact-first：该 job 先在 Docker 外构建 `securitydept-server`、`securitydept-cli` 与 web UI，把输入整理到 `release-runtime/`，再在同一 job 内使用 `Dockerfile.runtime` 组装镜像。
- `Dockerfile.runtime` 是 release Docker path。它基于 Debian slim，以匹配 GitHub Ubuntu runner 上构建出的 GNU/glibc binary。现有 cargo-chef / Alpine `Dockerfile` 继续保留为 full-build 诊断 fallback，不是 release publish 主路径。
- Docker tag 仍由 `release-cli docker publish --format=github-output` 计算，再传给 `docker/build-push-action`。当 source 是 `refs/heads/release` 时，Docker tag 计算使用 `refs/tags/<expected-tag>`，因此 release 分支发布也会产出版本与 channel tags（`vX.Y.Z...`、`vX.Y`、`vX`、`rc` / `nightly` / `latest`）以及不可变的 `sha-*` tag。
- 单独的 npm、crates、Docker 与 common-CI workflow 不再是 active release entrypoint。后续若重新引入，必须同步更新本文档并明确迁移 trusted-publisher binding。

Cache 与 artifact 规则：

- pnpm 与 Rust setup/cache 行为由 `.github/actions/` 下的 repo-local composite actions 拥有。
- pnpm cache mode 必须显式写成 `read-write`、`read-only` 或 `none`。稳定 restore key 是 `pnpm-store-${runner.os}-${hashFiles(lockfile)}`；同一个 workflow 拓扑中，同一 key 只能有一个 read-write owner。
- Rust cache mode 同样必须显式。使用共享 key 的 read-write job 必须是该拓扑唯一 writer；后续 job 只能 read-only restore 或消费 artifact。
- Debug CI 拓扑直接放在 `.github/workflows/tests.yml`；`release.yml` 由成功的 `Tests` run 调度，不再重复同一套 debug verification graph，也不使用 crates.io 不支持的 `workflow_run` 发布入口。
- Rust shared key 应该是稳定的 branch/profile scope，例如 `securitydept-rust-${runner.os}-${branch}-debug` 与 `securitydept-rust-${runner.os}-${branch}-release`。不要在 workflow 里手写 `hashFiles(...)` 塞进 `shared-key`；`Swatinem/rust-cache` 本身已经把 Cargo manifest、lockfile、toolchain 与相关 env var 的 Rust environment hash 纳入最终 key，并且会尝试从旧 lockfile 版本恢复。
- Rust cache ownership 按 profile 与 workflow source 拆分：

	| Cache key profile | Read-write owner | Consumers | 说明 |
	| --- | --- | --- | --- |
	| `securitydept-rust-${runner.os}-${cache_scope}-debug` | Tests workflow 的 `rust-debug-cache-prime` job | clippy、Rust tests、E2E prebuild，以及 `release.yml` 中 `crates-release` 的 read-only restore | 由 debug CI 拓扑拥有；成功 Tests dispatch 出来的 release 会复用同一个 `cache_scope`；manual release dispatch 可以 restore 既有匹配 cache，但不会在 release 内创建 debug writer |
	| `securitydept-rust-${runner.os}-${cache_scope}-release` in `release.yml` | `docker-release`，仅在 `publish_docker=true` 时运行 | 同一个 `docker-release` job 内的 runtime binary build | 当前只有 Docker 消费 release-profile artifacts，因此 writer 放在唯一消费 job 内；只有未来出现多个 release-profile consumers 时才需要重新拆出 prime job |

	每一行对应的 cache key 都只有一个 read-write owner。行外 job 只能 read-only restore 或不接触该 key。这是当前实践裁决下采用的暂定优化策略，并依赖唯一 writer 拓扑；其耗时收益仍需后续通过可复现的本地 workflow benchmark 证明后再继续调优。
- Docker buildx cache 只用于 Docker layer cache。release runtime scope 不再尝试缓存 cargo 或 pnpm build，因为这些 build 已经在 Docker 外完成。
- already-published skip 语义仍由 `release-cli npm publish` 与 `release-cli crates publish` 拥有，因此部分发布成功后重跑会继续剩余 package / crate，而不是因重复版本失败。

这样可以保证以下规则只有一份实现：

- 允许的 release version 语法
- prerelease 到 channel 的映射
- stable Docker alias
- Docker 镜像的 branch / SHA / tag 命名行为

## 本地执行顺序

建议在真正发布前按这个顺序跑本地检查：

1. `mise exec --command "just fix-release-metadata"`
2. `mise exec --command "just release-version-check"`
3. `mise exec --command "just release-npm-dry-run"`
4. `mise exec --command "just release-crates-package"`
5. `mise exec --command "just release-docker-metadata v0.2.0-beta.3"`

如果需要先推进版本：

1. `mise exec --command "just release-version-set 0.2.0-beta.3"`
2. `mise exec --command "just release-version-check"`

本地 workflow 模拟时，优先使用封装好的 `just action-release-validate`、`just action-release-dry-run`、`just action-release-run`，它们会调用 `scripts/actions-cli.ts`。真实本地 run 会创建临时 MockGithub 仓库，并通过 act-js 执行 `.github/workflows/release.yml`，因此 checkout 与 artifact 行为都交给本地 mock GitHub 环境处理。由于 act 会设置 `ACT=true`，wrapper 也会设置 `SECURITYDEPT_LOCAL_ACTIONS=true`，release publish jobs 只会执行本地 dry-run/package/build，不会推送到 npm、crates.io 或 GHCR。

示例验证命令：

```bash
just action-release-validate
just action-release-dry-run
just action-release-run publish_npm=false publish_crates=false publish_docker=true
```

action recipes 同时支持 `--publish-npm=false` 这类 CLI 风格参数，以及 `publish_npm=false` 这类更适合 just 的简写参数。
Publish toggles 默认值是 `false`，与 `release.yml` manual dispatch 默认值一致；需要本地模拟某个 channel 的 package/build 时再显式开启。

`act -n` 不会真实执行 `release-plan`，因此依赖 `needs.release-plan.outputs.*` 的 jobs 在 dry-run 模式下可能不会展开。真实本地 `act workflow_dispatch` run 会从 `release-plan` 得到 `local_run=true`，并进入本地 dry-run/package/no-push 分支。

## 维护要求

当 release 规则发生变化时：

- 先改 `release-cli`
- 再改 workflow 和 `justfile`，让它们调用共享逻辑，而不是重新抄一份规则
- 最后同步更新本文档和 [AGENTS.md](../../AGENTS.md) 中的摘要规则

不要新增新的 release channel、仅在 workflow 内生效的 tag 规则，或手工的 per-command dist-tag 参数，除非同步修改共享 release policy。

---

[English](../en/008-RELEASE_AUTOMATION.md) | [中文](008-RELEASE_AUTOMATION.md)
