# 外部下游校准

SecurityDept 可以在仓库外的下游 workspace 中验证，包括非正式称为 “Outposts” 的项目。这类 workspace 能提供有价值的集成信号，但不是本仓库 source tree、release gate、public API 或可复现 test contract 的一部分。

## 外部校准能够证明什么

外部 adopter 能暴露仓库内 React reference app 未必覆盖的 integration pressure，例如：

- Angular 或其它 framework 的 dependency-injection/router lifecycle。
- 消费已发布 package export，而不是 workspace source path。
- host-specific callback routing、configuration projection 与 bearer-transport composition。
- build tool 与 linked-package compatibility。

这些是特定 adopter integration 的证据，不是新的 SDK ownership boundary。

## 它不应改变什么

外部校准不能：

- 替代 `apps/webui` 和仓库测试作为 primary in-repo proof surface；
- 将 adopter 的 route table、UI、business API wrapper、environment wiring 升格为 SDK public API；
- 为 import undocumented source path 或保留误导性 compatibility alias 提供理由；
- 将外部 workspace 的 command、cache directory、tool version 或 credential 写进 SecurityDept 的规范文档。

## 使用外部 Adopter 的方式

验证 downstream workspace 时：

1. 只使用 released package 或明确打包的 public package；
2. 记录被验证的 SDK version 或 workspace link；
3. 在 downstream issue/test evidence 中记录确切 package/subpath 和行为；
4. 将重复出现、可泛化的问题转成仓库内 contract test 与 focused documentation update；
5. 仍以 package export 与 `public-surface-inventory.json` 定义 SDK public boundary。

当前 executable baseline 仍是 `apps/server` 与 `apps/webui`。TypeScript 支持边界见 [Client SDK 指南](007-CLIENT_SDK_GUIDE.md)，当前范围见 [路线图](100-ROADMAP.md)。

---

[English](../en/021-REFERENCE-APP-OUTPOSTS.md) | [中文](021-REFERENCE-APP-OUTPOSTS.md)
