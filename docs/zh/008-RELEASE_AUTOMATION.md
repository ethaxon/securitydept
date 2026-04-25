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
- `node scripts/release-cli.ts version set 0.2.0-beta.1`
- `node scripts/release-cli.ts npm publish --mode=dry-run`
- `node scripts/release-cli.ts npm publish --mode=publish`
- `node scripts/release-cli.ts crates publish --mode=package --report=temp/release/crates/package-report.json`
- `node scripts/release-cli.ts crates publish --mode=package --allow-blocked --allow-dirty --report=temp/release/crates/package-report.json`
- `node scripts/release-cli.ts crates publish --mode=publish --report=temp/release/crates/publish-report.json`
- `node scripts/release-cli.ts docker publish --ref=refs/tags/v0.2.0-beta.1`

行为规则：

- `metadata sync` 会把 [`securitydept-metadata.toml`](../../securitydept-metadata.toml) 中的共享发布元信息写入 publishable Rust crate 和 publishable npm package，包括 description、author、license、Rust crate 的 categories、keywords、repository 链接以及最简 `README.md`。
- `version set` 会更新 [`securitydept-metadata.toml`](../../securitydept-metadata.toml) 中列出的所有 release-managed `package.json` 和 `Cargo.toml`。
- `version check` 也会校验 publishable Rust crate 之间的 `path` 依赖版本，并要求内部依赖使用 `=X.Y.Z[-alpha.N|-beta.N]` 这种精确版本约束。
- `version set` 也会为这些 publishable Rust 内部依赖写入精确版本约束，保证本地 package 校验与 publish 准备阶段的一致性。
- `npm publish` 默认从版本号推断 dist-tag，除非显式传 override。
- GitHub Actions 里的 npm publish job 使用 GitHub OIDC 走 npm trusted publishing，不再注入长期有效的 `NPM_TOKEN`；public package 走 trusted publisher 路径时会自动生成 provenance。
- `crates publish --allow-dirty` 只用于本地 blocked packaging 循环，解决工作树故意脏状态下的 `cargo package` 校验；CI publish 流程不应使用它。
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

- npm publish 直接调用 `release-cli npm publish`，不再暴露手工 dist-tag 选择器，并依赖 GitHub Actions `id-token: write`；npm package 的 trusted publisher 配置应指向 `npm-publish.yml`（如使用环境保护，可附带 `npm-release` environment）。
- crates publish 调用 `release-cli crates publish`，publish job 不允许带 `--allow-dirty`，并通过 `rust-lang/crates-io-auth-action@v1` 使用 crates.io trusted publishing；crate 的 trusted publisher 配置应指向 `crates-publish.yml`（如使用环境保护，可附带 `crates-io-release` environment）。
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
4. `mise exec --command "just release-crates-package-blocked"`
5. `mise exec --command "just release-docker-metadata v0.2.0-beta.1"`

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