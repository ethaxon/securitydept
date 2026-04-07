# TS SDK Migration Ledger

This document is the authoritative entry for TS SDK public-surface change discipline, migration notes, and deprecation records.

## 0.x Contract Change Policy

The TS SDK is currently at `0.x`. This does not mean "break anything freely" — it means **breaking changes are allowed under explicit discipline**.

### Change Discipline by Stability Level

| Stability | Change Discipline | Meaning |
|---|---|---|
| `stable` | `stable-deprecation-first` | Breaking changes require a deprecation period. Removal only after at least one minor release with the deprecated API still available and a migration note in this ledger. |
| `provisional` | `provisional-migration-required` | Breaking changes are allowed but must be accompanied by a migration note in this ledger and a review-visible justification. |
| `experimental` | `experimental-fast-break` | Breaking changes are expected and may happen without prior deprecation. A brief note in this ledger is recommended but not enforced by the gate. |

### Rules

1. **Every non-experimental breaking change must have a migration note** in the [Migration Notes](#migration-notes) section below.
2. **Stable surface**: deprecate first, remove later. The deprecated API must remain functional for at least one minor release.
3. **Provisional surface**: break is allowed, but the note must include the justification and the migration path.
4. **Experimental surface**: no process required, but a brief note is appreciated.
5. **The inventory is the authority**: `public-surface-inventory.json` declares the `changeDiscipline` for each subpath. This ledger is the human-readable companion.

### How to Add a Migration Note

When making a breaking change to a non-experimental public surface:

1. Add a new entry under [Migration Notes](#migration-notes) with the format shown below.
2. Update `public-surface-inventory.json` if the subpath stability or shape changed.
3. Ensure `release-gate.test.ts` passes.

Entry format:

```markdown
### [date] package/subpath — short description

**Discipline**: `stable-deprecation-first` | `provisional-migration-required`
**Subpath**: `@securitydept/package/subpath`
**Change**: description of the breaking change
**Migration**: step-by-step migration instructions
**Justification**: why this break was necessary (provisional/stable only)
```

## Migration Notes

### 2026-04-10 @securitydept/basic-auth-context-client — Config validation deprecation (phase 1: warn)

**Discipline**: `stable-deprecation-first`
**Subpath**: `@securitydept/basic-auth-context-client` (`.`)
**Change**: `BasicAuthContextClient` constructor now validates config at runtime via `BasicAuthContextClientConfigSchema`. In this deprecation phase, invalid configs produce a `console.warn` but the client still constructs. The following inputs are deprecated and will become hard errors in a future minor release:
  - `zones: []` (empty array) — will require at least one zone
  - `zonePrefix: ""` (empty string) — will require non-empty string
  - `baseUrl: ""` (empty string) — will require non-empty string

**Migration**: If your code constructs `BasicAuthContextClient` with an empty `zones` array or empty `zonePrefix` / `baseUrl`, add at least one valid zone config with non-empty strings before the next minor release.
**Justification**: A `BasicAuthContextClient` with zero zones or empty path prefixes has no functional behavior. Making this an explicit deprecation prevents subtle bugs where the client silently does nothing.

---

[English](../en/110-TS_SDK_MIGRATIONS.md) | [中文](../zh/110-TS_SDK_MIGRATIONS.md)
