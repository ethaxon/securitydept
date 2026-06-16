# 路线图

当前 release line 是 `0.3.x`。优先目标是将现有 reusable Rust、TypeScript 与 reference-runtime surface 收敛成可解释、可测试、可发布的 contract；在 API 稳定前接受针对性的 breaking change。

## 当前优先级

1. 保持 public Rust crate 与 TypeScript package/subpath export 显式、经过测试并有文档。
2. 完成 token-set client workflow 收敛：单一 client snapshot authority、typed final candidate、source-driven workflow input、explicit span，以及不泄漏 token material 的 event contract。
3. 保持 `apps/webui` 与 `apps/server` 作为 public contract 的 executable proof surface，但不将 application composition 升格成 SDK API。
4. 保持 Basic Auth 与 session 的 entry path 简单、可发现；token-set 仍是更丰富的 integration surface。
5. 通过声明的 toolchain 保持 release metadata、package/readme generation、Docker assembly、docs-site validation 与 cross-workspace test 可复现。

## 文档和兼容性

- `docs/en` 与 `docs/zh` 是源文档；`docsite/` 通过 symlink 渲染它们。
- `public-surface-inventory.json` 和 package export 定义 TypeScript contract boundary。
- 在 `0.x` 仍可变时，`110-TS_SDK_MIGRATIONS.md` 记录 breaking TypeScript contract change。
- `CHANGELOG.md` 记录已发布历史，不负责未来范围。

## 延期项

以下内容明确不在当前基线：

- 通用 mixed-custody 或 server-side token-set/BFF ownership
- 内置应用 chooser UI、product route semantics 或 business API wrapper
- 非 TypeScript SDK productization
- 完整 telemetry exporter/collector stack
- 除 reference propagation configuration 外的 generalized token exchange

---

[English](../en/100-ROADMAP.md) | [中文](100-ROADMAP.md)
