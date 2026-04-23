# Client SDK Guide

This guide is the adopter-facing authority for the current TypeScript SDK surface. It explains package boundaries, stable entry points, runtime responsibilities, and the `0.2.0` / `0.3.0` scope split.

It does not carry roadmap history or implementation chronology. Use [100-ROADMAP.md](100-ROADMAP.md) for release backlog and deferred work, [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) for public-surface migration decisions, and [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md) for the downstream adopter case.

## Goal

The SDK gives browser, React, Angular, and server-host adopters explicit auth-context entry points without turning reference-app glue into public API. The current baseline is browser-owned token-set auth plus thin basic-auth/session helpers; mixed-custody, BFF, and server-side token ownership remain outside the `0.2.0` line.

## Current Scope and Boundaries

Current authority:

- `@securitydept/client` owns foundation runtime primitives, persistence, cancellation, tracing, and shared auth coordination.
- `@securitydept/basic-auth-context-client` and `@securitydept/session-context-client` own thin auth-context helpers for browser and server hosts.
- `@securitydept/token-set-context-client` owns browser-owned token-set modes, registry lifecycle, access-token substrate vocabulary, and OIDC mode entries.
- `@securitydept/client-react` / `@securitydept/client-angular` own shared framework-router glue.
- context-specific React / Angular packages own provider, hook, DI, and signal integration for their families.

Non-authority:

- `apps/webui/src/api/*`, pages, copy, route tables, and diagnostics UI are reference-app glue.
- `~/workspace/outposts` is downstream calibration evidence, not an SDK API template.
- provider choice, chooser UI, product flow semantics, and app-local failure copy remain adopter responsibilities.

## Top-Level Decisions

- TypeScript is the only active SDK productization track for `0.2.x`.
- Framework adapters stay thin and consume shared core owners rather than becoming first owners of framework-neutral behavior.
- Public surface changes move together with inventory, evidence, docs anchors, and migration ledger entries.
- `0.2.0-beta.1` release preparation is packaging and documentation readiness work; it does not add auth capability.

## Terminology and Naming

- **auth context**: a deployment-oriented family such as basic-auth, session, or token-set.
- **mode**: a concrete operating shape inside an auth context, such as `frontend-oidc` or `backend-oidc`.
- **runtime capability**: host-supplied dependency such as transport, storage, clock, scheduler, trace sink, or router.
- **adapter**: a framework-specific host integration layer.
- **reference app**: proof and example, not default owner.

## Packaging Style

Packages are small, explicit, and side-effect-light. Root exports carry stable family contracts where possible. `/web`, `/server`, framework, and router subpaths carry host-specific glue and remain provisional until wider evidence exists.

## Recommended Repository Layout

Adopters should keep SDK usage close to the auth boundary:

```text
src/auth/
  runtime.ts
  tokenSet.ts
  routes.ts
  api.ts
```

Do not copy `apps/webui` folders as a product template. Lift only the SDK entry shapes that match your host.

## TypeScript SDK Coding Standards

### Enum-like String Domains

Use `export const Foo = { ... } as const` plus `export type Foo = (typeof Foo)[keyof typeof Foo]` for public string domains.

### Named Constants for Public Contracts

Repeated telemetry, storage, route, or error vocabulary used across packages must have named constants.

### API Shape: Options Object First

Public functions use an `options` object for optional parameters. A positional second argument is acceptable only when it is uniquely ergonomic and unlikely to widen. If a public API widens, convert the whole second argument to options even when that is a breaking change.

## Foundation Design

The foundation layer is not an auth product shell. It exists so family packages can share runtime-safe contracts.

### State Primitives

State primitives are explicit, host-owned, and framework-neutral. Framework adapters may expose convenience hooks or signals, but the shared state contract remains in foundation or family owners.

### Event Primitives

Events should describe machine-facing lifecycle facts. User-facing presentation belongs to the host.

### Transport

Transport is always injected or selected by the host. SDK packages must not assume a global fetch policy beyond the documented browser/server entry.

### Persistence

`@securitydept/client/persistence` owns `RecordStore` semantics, including single-consume callback state through `take()`. `@securitydept/client/persistence/web` owns browser persistence adapters.

### Auth Coordination

`@securitydept/client/auth-coordination` owns planner-host and requirement orchestration primitives. It is headless: it may decide required actions, but it does not own chooser UI, route copy, or product flow semantics.

### Configuration

Read configuration in three layers:

1. runtime/foundation capabilities
2. auth-context config
3. adapter/host registration glue

Do not flatten these into one global config DSL for the current baseline.

### Scheduling and Unified Input Sources

Scheduling, cancellation, abort interop, visibility, storage, and promise/signal helpers live in foundation and web subpaths. They are shared primitives, not a stream DSL.

### Internal Dependency Injection

DI is an adapter concern. Core packages expose explicit constructors/functions; Angular DI and React Context live in their adapter packages.

## Context Client Design

### `basic-auth-context-client`

Stable root surface for basic-auth boundary helpers. The `/web` and `/server` entries provide thin host helpers, and React/Angular adapters remain host wrappers.

### `session-context-client`

Stable root surface for session login URL, post-auth redirect, user-info, logout, and browser-shell convenience. Framework adapters consume this owner rather than duplicating session semantics.

### `token-set-context-client`

Provisional token-set family for browser-owned OIDC/token material flows. It owns `backend-oidc-mode`, `frontend-oidc-mode`, `orchestration`, `access-token-substrate`, and `registry` entries.

## SSR / Server-Side Support

### `basic-auth-context` and `session-context`

Server-host adopters should use the dedicated `/server` helper entries for host-neutral request/response coordination.

### `token-set-context`

Server-side token ownership, BFF, and mixed-custody are deferred to `0.3.0`. The current SDK baseline is browser-owned token-set.

## Error Model

SDK errors expose machine-facing codes and host-facing recovery hints where relevant. Host copy and UI state remain adopter-owned. Do not parse opaque `Error.message` strings for control flow.

## Cancellation and Disposal

`@securitydept/client/web` owns browser cancellation interop, including AbortSignal bridges. Long-lived hosts should wire cancellation and disposal explicitly.

## Logging, Tracing, and Testing

`@securitydept/client` owns the minimal trace event and operation-correlation primitives used by SDK flows. `@securitydept/test-utils` remains experimental and is not a `0.2.0-beta.1` npm publish target.

## Build, Compatibility, and Side Effects

### Output and Compatibility

Packages target modern ESM hosts and TypeScript project references. Angular packages are built with `ng-packagr`; non-Angular SDK packages are built with `tsdown`.

### Polyfills

SDK packages must not silently install global polyfills. Adopters own runtime polyfill decisions.

### sideEffects / Tree Shaking

Packages should remain import-safe and side-effect-light. Registration side effects belong to explicit provider/adapter functions.

## API Stability

### Current 0.x Freeze Semantics

The canonical meaning is now:

| Stability | Meaning | Change discipline |
|---|---|---|
| `stable` | frozen adopter-facing surface | `stable-deprecation-first` |
| `provisional` | public and usable, but still allowed to evolve under migration discipline | `provisional-migration-required` |
| `experimental` | allowed to move quickly with no stability promise | `experimental-fast-break` |

### Current Contract Snapshot

The table below is the current TS SDK public-surface authority snapshot. It must remain aligned with `public-surface-inventory.json`.

| Surface | Stability | Owner | Change discipline |
|---|---|---|---|
| `@securitydept/client` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/persistence` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/persistence/web` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/web` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/auth-coordination` | `provisional` | `foundation` | `provisional-migration-required` |
| `@securitydept/client/web-router` | `provisional` | `foundation` | `provisional-migration-required` |
| `@securitydept/basic-auth-context-client` | `stable` | `basic-auth-context` | `stable-deprecation-first` |
| `@securitydept/basic-auth-context-client/web` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/basic-auth-context-client/server` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/basic-auth-context-client-react` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/session-context-client` | `stable` | `session-context` | `stable-deprecation-first` |
| `@securitydept/session-context-client/web` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/session-context-client/server` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-react` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/backend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/backend-oidc-mode/web` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/orchestration` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/access-token-substrate` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/registry` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/test-utils` | `experimental` | `foundation` | `experimental-fast-break` |
| `@securitydept/basic-auth-context-client-angular` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-angular` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react/react-query` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-angular` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/client-react` | `provisional` | `shared-framework` | `provisional-migration-required` |
| `@securitydept/client-react/tanstack-router` | `provisional` | `shared-framework` | `provisional-migration-required` |
| `@securitydept/client-angular` | `provisional` | `shared-framework` | `provisional-migration-required` |

#### How To Read `token-set-context-client` Subpaths

- `/backend-oidc-mode`: platform-neutral client/service/token-material entry.
- `/backend-oidc-mode/web`: browser redirect, callback, storage, and bootstrap glue.
- `/frontend-oidc-mode`: browser-owned OIDC client mode and config projection materialization.
- `/orchestration`: protocol-agnostic token lifecycle and route requirement primitives.
- `/access-token-substrate`: access-token propagation vocabulary and substrate contract.
- `/registry`: shared multi-client lifecycle core.

#### Capability Boundary Rules

- Framework router glue belongs to shared framework adapters.
- Browser token-lifecycle glue belongs to the token-set family.
- App-local business API wrappers are not SDK public surface.
- Reference apps provide evidence; they do not define package ownership by themselves.

#### token-set-context-client Frontend Subpath / Abstraction Split

Frontend adopters should reason in layers: foundation coordination, token-set mode/substrate/registry, then framework adapter. The token-set family is not the sole owner of every frontend helper.

#### Config Projection Source Contract (`frontend-oidc-mode/config-source.ts`)

`frontend-oidc-mode` owns projection-source precedence, validation, freshness, restore, and revalidation. `createFrontendOidcModeBrowserClient()` owns browser materialization; the host owns config endpoint wiring and page routes.

#### Reference-App Host Evidence (`apps/webui` / `apps/server`)

`apps/webui` and `apps/server` prove the current reference-app baseline: backend-mode and frontend-mode host splits, keyed callback/readiness, React Query token-set management flows, route security, dashboard bearer access, browser harness reporting, and shared error/diagnosis consumption.

### Framework Router Adapters

Framework router adapters are owned by:

- `@securitydept/client-react/tanstack-router`
- `@securitydept/client-angular`

Canonical semantics: full matched-route chain aggregation, `inherit` / `merge` / `replace`, child-route serializable metadata, root-level runtime policy, and no product chooser UI in the SDK.

### token-set-context-client v1 Scope Baseline

The current `0.2.0` baseline is browser-owned token-set with framework adapters, registry lifecycle, route orchestration, readiness, callback handling, reference-app proof, and downstream adopter calibration.

Outside the baseline: mixed-custody, BFF, server-side token ownership, heavier chooser UI, and non-TS SDK productization.

### Adopter Checklist

#### Things that must not be treated as SDK surface

- reference-app page components and UI copy
- `apps/webui/src/api/*` business wrappers
- adopter route tables and page state
- one-off data shaping for a single app

#### Checklist before integration

1. Pick the auth context first.
2. Pick browser, framework, or server-host entry second.
3. Confirm whether the entry is stable, provisional, or experimental.
4. Accept the current `0.2.0` / `0.3.0` boundary before depending on token-set behavior.

### Verified Environments / Host Assumptions

Verified means focused evidence, reference-app proof, or downstream-adopter proof exists. It does not mean broad coverage across every host.

Current evidence covers Node/browser foundation behavior, React 19, Angular, TanStack Router, raw Web Router, `apps/webui`, and `outposts`. Host support should be described through ECMAScript requirements, adapter capabilities, and real evidence.

### Minimal Entry Paths

#### 1. Foundation entry: runtime stays explicit

Use `@securitydept/client` for shared primitives. It is not a product-level auth shell.

#### 2. Browser entry: `./backend-oidc-mode/web` owns browser glue

Use `@securitydept/token-set-context-client/backend-oidc-mode/web` for backend-owned OIDC/token-set browser flows.

#### 3. React entry: dedicated adapter packages own Provider and hook wiring

Use:

- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

Provider config follows the three-layer model: auth-context config, runtime capabilities where applicable, and host registration glue.

#### 4. Angular entry: thin DI wrappers preserve canonical owner boundaries

Use:

- `@securitydept/basic-auth-context-client-angular`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client-angular`

Layering rules:

- `provideBasicAuthContext({ config })`: auth-context config only.
- `SessionContextService.client`: auth-context behavior; Angular DI owns host registration and transport injection.
- `provideTokenSetAuth({ clients, idleWarmup })`: Angular host registration; each client entry still owns auth-context config and runtime composition.
- `provideTokenSetBearerInterceptor(options?)` / `createTokenSetBearerInterceptor(registry, options?)`: bearer-header injection using the SDK options-object API form. `BearerInterceptorOptions.strictUrlMatch` controls unmatched URL behavior:
  - default `strictUrlMatch: false`: keeps the single-client convenience fallback that injects `registry.accessToken()` for unmatched URLs; use only when the host calls exactly one registered backend.
  - `strictUrlMatch: true`: unmatched URLs receive no `Authorization` header.
  - multi-backend, multi-audience, or third-party-traffic Angular adopters MUST use `strictUrlMatch: true`.
  - `TOKEN_SET_BEARER_INTERCEPTOR_OPTIONS` is exported for advanced DI/test overrides.

#### 5. SSR / server-host entry: dedicated `./server` helpers

Use:

- `@securitydept/basic-auth-context-client/server`
- `@securitydept/session-context-client/server`

Do not import `/web` subpaths into server-hosted code.

### Provisional Adapter Maintenance Standard

`./web`, `./server`, and framework packages are maintained at a stricter provisional bar: stable boundaries, safe import-time behavior, ordinary usage without reference-app glue, focused evidence, real dogfooding, and accurate verified-environment claims.

#### Provisional Adapter Promotion Checklist

| Condition | Requirement |
|---|---|
| capability boundary is stable | no owner reshuffle across multiple iterations |
| minimal entry is clear | explainable without a full reference page |
| ordinary usage is mature | no app-local glue dependency |
| focused evidence is complete | lifecycle, regression, and import-contract guardrails exist |
| verified environments are explicit | host validation is not overstated |

#### Current Promotion Readiness (snapshot, not roadmap)

| Adapter / Surface | Current judgment |
|---|---|
| `@securitydept/client/web` | stable foundation-owned browser helper surface |
| `@securitydept/client/auth-coordination` | provisional; planner-host and matched-route-chain contract established |
| `@securitydept/client/web-router` | provisional; raw Web baseline established |
| `basic-auth-context-client/web` | provisional; thin browser convenience established |
| `session-context-client/web` | provisional; login redirect convenience established |
| `basic-auth-context-client/server` / `session-context-client/server` | provisional; SSR/server-host baseline established |
| `*-react` / `*-angular` adapter family | provisional; real reference-app/downstream proof exists, broad host matrix does not |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | provisional; keyed pending-state and single-consume callback semantics formalized |
| `token-set-context-client-react/react-query` | provisional; canonical token-set groups/entries consumer path established |

## Raw Web Router Baseline

**Subpath**: `@securitydept/client/web-router`

The raw Web Router baseline is for non-framework hosts. It uses Navigation API first, History API fallback, and one planner-host submission per full matched-route chain.

## Shared Client Lifecycle Contract

**Subpath**: `@securitydept/token-set-context-client/registry`

The registry owns `primary` / `lazy` initialization priority, `preload`, `whenReady`, `idleWarmup`, `reset`, and keyed lookup aligned with callback/readiness behavior. React and Angular adapters consume this shared core.

## React Query Integration

**Subpath**: `@securitydept/token-set-context-client-react/react-query`

This is the token-set React consumer surface. It owns groups/entries read and write hooks, readiness queries, keyed hook ergonomics, authorization-header derivation, query-key namespace, and canonical invalidation for token-set management flows. It is not the login, refresh, or runtime authority.

## Examples and Reference Implementations

### Primary Real Reference Apps

- `apps/server`: auth, propagation, route composition, server error/diagnosis proof.
- `apps/webui`: React/browser/multi-context auth shell, token-set reference page, dashboard, browser harness report, and SDK dogfooding proof.

### Downstream Reference Case: Outposts

`~/workspace/outposts` validates the real Angular adopter path. After iteration 150 it uses `provideTokenSetAuth(...)` plus `provideTokenSetBearerInterceptor({ strictUrlMatch: true })`, proving strict URL-prefix bounded bearer injection against a downstream `confluence` backend. Its app-local auth service remains adopter glue, not an SDK API template.

### Current Bundle / Code Split Judgment

Bundle and code-splitting are engineering optimization topics, not public-contract blockers for `0.2.0-beta.1`.

### Demo and OIDC Provider

Demos explain contracts. Provider choice and demo pages do not define package boundaries or replace focused evidence.

## Requirements for Future Developers and AI Agents

- Do not rename or rebuild the client SDK as `auth-runtime`.
- Do not let framework adapters pollute foundation packages.
- Do not introduce import-time side effects or default global polyfills.
- Do not productize reference-app or adopter glue as SDK API.
- Do not move mixed-custody / BFF / server-side token ownership into the `0.2.0` baseline.
- Move public surface, docs, examples, inventory, and migration notes together.

[English](007-CLIENT_SDK_GUIDE.md) | [中文](../zh/007-CLIENT_SDK_GUIDE.md)
