# External Downstream Calibration

SecurityDept may be exercised against external downstream workspaces, including projects informally referred to as "Outposts". Those workspaces are useful integration signals, but they are not part of this repository's source tree, release gate, public API, or reproducible test contract.

## What External Calibration Can Prove

An external adopter can expose integration pressure that the in-repository React reference app does not cover, such as:

- Angular or another framework's dependency-injection and router lifecycle.
- Consumption of the published package exports rather than workspace source paths.
- Host-specific callback routing, configuration projection, and bearer-transport composition.
- Build-tool and linked-package compatibility.

Treat these as evidence for a concrete adopter integration, not as a new SDK ownership boundary.

## What It Must Not Change

External calibration does not:

- replace `apps/webui` and repository tests as the primary in-repo proof surface;
- promote an adopter's route table, UI, business API wrapper, or environment wiring into SDK public API;
- justify importing an undocumented source path or retaining a misleading compatibility alias;
- add the external workspace's commands, cache directories, tool versions, or credentials to SecurityDept's normative documentation.

## Working With An External Adopter

When checking a downstream workspace:

1. use only released or explicitly packed public packages;
2. pin the SDK version or workspace link being evaluated;
3. record the exact package/subpath and observed behavior in the downstream issue or test evidence;
4. turn a repeated, generalizable finding into an in-repository contract test and focused documentation update;
5. keep the SDK public boundary defined by package exports and `public-surface-inventory.json`.

The current executable baseline remains `apps/server` plus `apps/webui`. See [Client SDK Guide](007-CLIENT_SDK_GUIDE.md) for the supported TypeScript boundary and [Roadmap](100-ROADMAP.md) for scope.

---

[English](021-REFERENCE-APP-OUTPOSTS.md) | [中文](../zh/021-REFERENCE-APP-OUTPOSTS.md)
