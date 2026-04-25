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
- `node scripts/release-cli.ts version set 0.2.0-beta.2`
- `node scripts/release-cli.ts npm publish --mode=dry-run`
- `node scripts/release-cli.ts npm publish --mode=publish --provenance`
- `node scripts/release-cli.ts crates publish --mode=package --report=temp/release/crates/package-report.json`
- `node scripts/release-cli.ts crates publish --mode=package --allow-blocked --allow-dirty --report=temp/release/crates/blocked-package-report.json`
- `node scripts/release-cli.ts crates publish --mode=publish --report=temp/release/crates/publish-report.json`
- `node scripts/release-cli.ts docker publish --ref=refs/tags/v0.2.0-beta.2`

行为规则：

- `metadata sync` 会把 [`securitydept-metadata.toml`](../../securitydept-metadata.toml) 中的共享发布元信息写入 publishable Rust crate 和 publishable npm package，包括 description、author、license、Rust crate 的 categories、keywords、repository 链接以及最简 `README.md`。
- `version set` 会更新 [`securitydept-metadata.toml`](../../securitydept-metadata.toml) 中列出的所有 release-managed `package.json` 和 `Cargo.toml`。
- `version check` 也会校验 publishable Rust crate 之间的 `path` 依赖版本，并要求内部依赖使用 `=X.Y.Z[-alpha.N|-beta.N]` 这种精确版本约束。
- `version set` 也会为这些 publishable Rust 内部依赖写入精确版本约束，保证本地 package 校验与 publish 准备阶段的一致性。
- `npm publish` 默认从版本号推断 dist-tag，除非显式传 override。
- `npm publish` 在 GitHub Actions 的 tag workflow 中会自动关闭 pnpm 的 Git branch 校验，避免 detached release tag checkout 因 `publish-branch` 限制失败。
- `npm publish --mode=publish` 会先查询 npm registry，遇到已经存在的版本就直接跳过，因此在部分 package 已成功发布后重跑时，只会继续剩余的 package。
- npm package 的 tarball manifest 清洗现在统一由仓库根级 [`/.pnpmfile.cjs`](../../.pnpmfile.cjs) 的 `hooks.beforePacking` 负责，而不是由 release script 临时改写文件。这个 hook 会把 `@securitydept/*` 的 `workspace:` 版本说明符改写成当前发布包的版本，对所有发布包移除 monorepo 专用的 `monorepo-tsc` export condition，并对 Angular 发布态额外清理不应保留的字段，例如 root-only 的 `files` 和 `devDependencies`。
- Angular SDK packages 必须从 package root 发布，并通过 `publishConfig.directory = "dist"` 指向构建产物；不要直接在 `dist` 目录里运行 `pnpm pack` 或 `pnpm publish`，因为那会在 `beforePacking` 介入前丢失 workspace resolution context。
- GitHub Actions 里的 npm publish job 使用 GitHub OIDC 走 npm trusted publishing，不再注入长期有效的 `NPM_TOKEN`；workflow 与本地正式发布入口都显式传 `--provenance`，避免 provenance 依赖隐含默认行为。
- `crates publish --allow-dirty` 只用于本地 blocked packaging 循环，解决工作树故意脏状态下的 `cargo package` 校验；CI publish 流程不应使用它。
- 默认的 `crates publish --mode=package` gate 会用一次 `cargo package --workspace` 打包所有 publishable workspace crates。这是 prerelease 内部依赖链所必需的，因为 Cargo 会在后续 crate 的校验阶段优先从临时打包 registry 解析刚刚打包的上游 crate，而不是只去 crates.io 查还没发布的新版本。
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

- npm publish 必须保留从 package root 发起的调用方式，这样 pnpm 才能同时应用 Angular package 的 `publishConfig.directory` 与仓库根 `.pnpmfile.cjs` 中的 `beforePacking` hook。
- npm publish 直接调用 `release-cli npm publish`，不再暴露手工 dist-tag 选择器，并依赖 GitHub Actions `id-token: write`；正式 publish 路径应显式传 `--provenance`，npm package 的 trusted publisher 配置应指向 `npm-publish.yml`（如使用环境保护，可附带 `npm-release` environment）。
- crates publish 调用 `release-cli crates publish`；默认 package gate 不得带 `--allow-blocked`，publish job 不允许带 `--allow-dirty`，并通过 `rust-lang/crates-io-auth-action@v1` 使用 crates.io trusted publishing；crate 的 trusted publisher 配置应指向 `crates-publish.yml`（如使用环境保护，可附带 `crates-io-release` environment）。
- Docker build 通过 `release-cli docker publish --format=github-output` 计算 tags/labels，并把结果直接传给 `docker/build-push-action`。

这样可以保证以下规则只有一份实现：

- 允许的 release version 语法
- prerelease 到 channel 的映射
- stable Docker alias
- Docker 镜像的 branch / SHA / tag 命名行为

## 本地执行顺序

建议在真正发布前按这个顺序跑本地检查：

1. `mise exec --command "just release-metadata-sync"`
2. `mise exec --command "just release-version-check"`
3. `mise exec --command "just release-npm-dry-run"`
4. `mise exec --command "just release-crates-package"`
5. `mise exec --command "just release-docker-metadata v0.2.0-beta.2"`

如果需要先推进版本：

1. `mise exec --command "just release-version-set 0.2.0-beta.2"`
2. `mise exec --command "just release-version-check"`

## 维护要求

当 release 规则发生变化时：

- 先改 `release-cli`
- 再改 workflow 和 `justfile`，让它们调用共享逻辑，而不是重新抄一份规则
- 最后同步更新本文档和 [AGENTS.md](../../AGENTS.md) 中的摘要规则

不要新增新的 release channel、仅在 workflow 内生效的 tag 规则，或手工的 per-command dist-tag 参数，除非同步修改共享 release policy。

---

[English](../en/008-RELEASE_AUTOMATION.md) | [中文](008-RELEASE_AUTOMATION.md)