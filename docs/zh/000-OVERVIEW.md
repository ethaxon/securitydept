# SecurityDept 文档

SecurityDept 是可复用的认证与授权栈，交付为三个层次：

- 用于服务端验证、provider 集成、认证上下文和 host 配置的 Rust crates。
- 用于浏览器、框架和宿主运行时认证集成的 TypeScript packages。
- 用 Axum server 和 React WebUI 验证同一契约的参考应用。

仓库 [README](../../README_zh.md) 是入口。本页只说明每类主题的权威文档，不重复 package API reference。

## 按使用场景进入

### 集成 Rust

先读 [架构](001-ARCHITECTURE.md) 理解 crate 边界，再读 [认证上下文和模式](020-AUTH_CONTEXT_AND_MODES.md) 理解产品模型。每个已发布 crate 的 API 以 rustdoc 为准。

### 集成 TypeScript

读 [Client SDK 指南](007-CLIENT_SDK_GUIDE.md)。它定义 package family、显式环境契约、lifecycle 约定，以及 public trait 与内部 RxJS 组合之间的边界。

### 运行参考系统

可执行基线是 `apps/server` 与 `apps/webui`。从根 README 和 `config.example.toml` 开始；[能力矩阵](002-FEATURES.md) 列出它证明的 routes 与能力。

### 维护仓库

- [发布自动化](008-RELEASE_AUTOMATION.md) 负责版本、metadata sync、package publishing 和 release evidence。
- [TS SDK 迁移记录](110-TS_SDK_MIGRATIONS.md) 记录仍在生效的 breaking public-contract changes。
- [路线图](100-ROADMAP.md) 负责当前范围和明确延期项。
- [CHANGELOG](../../CHANGELOG.md) 记录已发布历史。

## 文档职责

| 主题 | 权威来源 |
| --- | --- |
| 仓库入口和本地开发 | [README](../../README_zh.md) |
| runtime 与 crate 分层 | [架构](001-ARCHITECTURE.md) |
| 能力可用性 | [能力矩阵](002-FEATURES.md) |
| auth-context 术语和 ownership | [认证上下文和模式](020-AUTH_CONTEXT_AND_MODES.md) |
| TypeScript package 与 host contract | [Client SDK 指南](007-CLIENT_SDK_GUIDE.md) |
| 错误响应与信息披露 | [错误系统设计](005-ERROR_SYSTEM_DESIGN.md) |
| client-IP policy | [Real-IP 策略](006-REALIP.md) |
| 发布 | [发布自动化](008-RELEASE_AUTOMATION.md) |
| 兼容性变更 | [TS SDK 迁移记录](110-TS_SDK_MIGRATIONS.md) |

## 源文档和渲染层

`docs/en` 与 `docs/zh` 是源文档；`docsite/` 通过 symlink 将其作为 VitePress 渲染层，不应再维护第二份内容。使用 `just build-docs` 验证站点。

package README 由 `release-cli metadata sync` 生成。package 的具体契约应写在 rustdoc、TypeScript exports 和上述 focused docs；除非同时修改生成器，否则不要直接编辑生成的 README。

## 文档规则

- 只描述当前行为或明确标注的未来计划，不写内部历史叙述。
- 链接到拥有该 contract 的 public package/subpath 或 crate。
- 不把 reference-app route 和 composition code 写成 SDK contract。
- 修改用户可见文档时同步英文和中文源文档。

---

[English](../en/000-OVERVIEW.md) | [中文](000-OVERVIEW.md)
