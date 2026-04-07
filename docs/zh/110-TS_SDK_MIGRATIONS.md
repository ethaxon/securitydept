# TS SDK 迁移记录

本文档是 TS SDK public-surface 变更纪律、迁移说明与 deprecation 记录的权威入口。

## 0.x 合约变更策略

TS SDK 当前处于 `0.x` 阶段。这不意味着"随便改" — 而是**允许 breaking change，但必须有纪律**。

### 按 Stability 分级的变更纪律

| Stability | Change Discipline | 含义 |
|---|---|---|
| `stable` | `stable-deprecation-first` | Breaking change 必须先经过 deprecation 周期。至少在一个 minor release 中保留已废弃 API 可用，并在本文档中记录迁移说明。 |
| `provisional` | `provisional-migration-required` | 允许 breaking change，但必须带迁移说明（记录在本文档中）和 review 可见的理由。 |
| `experimental` | `experimental-fast-break` | 预期会有 breaking change，无需提前 deprecation。建议在本文档中留简要说明，但 gate 不强制。 |

### 规则

1. **每个非 experimental 的 breaking change 必须在下方 [迁移说明](#迁移说明) 中留记录。**
2. **Stable surface**：先 deprecate，后移除。已废弃 API 至少在一个 minor release 中保持可用。
3. **Provisional surface**：允许 break，但说明必须包含理由和迁移路径。
4. **Experimental surface**：无流程要求，但建议留简要说明。
5. **Inventory 是权威**：`public-surface-inventory.json` 声明了每个 subpath 的 `changeDiscipline`。本文档是其人类可读的伴随文档。

### 如何添加迁移说明

在对非 experimental public surface 进行 breaking change 时：

1. 在下方 [迁移说明](#迁移说明) 中按以下格式新增条目。
2. 如 subpath stability 或形状有变，同步更新 `public-surface-inventory.json`。
3. 确保 `release-gate.test.ts` 通过。

条目格式：

```markdown
### [日期] package/subpath — 简要描述

**Discipline**: `stable-deprecation-first` | `provisional-migration-required`
**Subpath**: `@securitydept/package/subpath`
**变更**: breaking change 描述
**迁移**: 逐步迁移说明
**理由**: 为何必须 break（仅 provisional/stable）
```

## 迁移说明

### 2026-04-10 @securitydept/basic-auth-context-client — Config validation 废弃通知（阶段 1：warn）

**Discipline**: `stable-deprecation-first`
**Subpath**: `@securitydept/basic-auth-context-client` (`.`)
**变更**: `BasicAuthContextClient` constructor 现在通过 `BasicAuthContextClientConfigSchema` 在 runtime 校验 config。在此废弃阶段，invalid config 触发 `console.warn` 但 client 仍可构造。以下输入已被废弃，将在未来 minor release 中成为硬报错：
  - `zones: []`（空数组）— 将要求至少一个 zone
  - `zonePrefix: ""`（空字符串）— 将要求非空字符串
  - `baseUrl: ""`（空字符串）— 将要求非空字符串

**迁移**: 如果你的代码用空 `zones` 数组或空 `zonePrefix` / `baseUrl` 构造 `BasicAuthContextClient`，请在下一个 minor release 前添加至少一个有效 zone config。
**理由**: `BasicAuthContextClient` 没有 zone 或空路径前缀不会有任何功能行为。显式废弃通知防止 client 静默无操作的隐式 bug。

---

[English](../en/110-TS_SDK_MIGRATIONS.md) | [中文](../zh/110-TS_SDK_MIGRATIONS.md)
