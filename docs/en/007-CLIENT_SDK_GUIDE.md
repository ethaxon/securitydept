# Client SDK Guide

This document is the **authoritative overview** for the SecurityDept client SDK family.  
It answers three questions:

- which TypeScript public surfaces currently exist and who owns them
- which surfaces are `stable`, `provisional`, or `experimental`
- where adopters should enter and what must **not** be treated as SDK surface

It no longer tries to be the source of truth for:

- the full auth-context / mode design: see [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)
- current priorities, backlog, and deferred boundaries: see [100-ROADMAP.md](100-ROADMAP.md)
- 0.x migration and breaking-change history: see [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)

Target readers:

- human developers implementing SDK modules
- AI agents reviewing or editing SDK code/docs
- adopters who need to understand package and subpath boundaries

## Goal

The client SDK is not meant to recreate the server-side `auth-runtime`, and it is not meant to collapse every concern into one monolithic package.  
Its job is to provide:

- clear auth-context product surfaces
- an explicit framework-neutral foundation
- thin but testable browser / server / framework adapters
- public contracts that can be calibrated by both reference apps and real adopters

Current productization priority:

1. TypeScript SDK
2. Kotlin SDK (later)
3. Swift SDK (later)

## Top-Level Decisions

- client SDKs stay separate from server route-orchestration concepts
- public packages are split by auth context or capability
- root surfaces stay framework-neutral by default
- framework adapters ship as independent npm packages
- browser / server helpers ship as same-package subpaths such as `./web` and `./server`
- TypeScript packages are `ESM only`
- packages are side-effect free by default
- global polyfills are not bundled by default

## Terminology and Naming

Do not reuse `core` for the shared client base layer.  
The current terminology is:

- `client`: the user-facing foundation package
- `foundation`: the conceptual shared infrastructure layer, not the main public package name
- `basic-auth-context-client`: the Basic Auth zone-aware client family
- `session-context-client`: the cookie-session client family
- `token-set-context-client`: the token-set / OIDC-mode client family

Public protocol names still use the `Trait` style to avoid collisions with host or standard objects, for example:

- `ReadableSignalTrait`
- `WritableSignalTrait`
- `EventStreamTrait`
- `LoggerTrait`
- `CancellationTokenTrait`

For the full auth-context / zone / mode vocabulary, see [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md).

## Packaging Style

The TypeScript family is currently split by capability and auth context. The real package structure is:

- `@securitydept/client`
- `@securitydept/client/web`
- `@securitydept/client/persistence`
- `@securitydept/client/persistence/web`
- `@securitydept/basic-auth-context-client`
- `@securitydept/basic-auth-context-client/web`
- `@securitydept/basic-auth-context-client/server`
- `@securitydept/basic-auth-context-client-react`
- `@securitydept/basic-auth-context-client-angular`
- `@securitydept/session-context-client`
- `@securitydept/session-context-client/web`
- `@securitydept/session-context-client/server`
- `@securitydept/session-context-client-react`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client/backend-oidc-mode`
- `@securitydept/token-set-context-client/backend-oidc-mode/web`
- `@securitydept/token-set-context-client/frontend-oidc-mode`
- `@securitydept/token-set-context-client/orchestration`
- `@securitydept/token-set-context-client/access-token-substrate`
- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-react/react-query`
- `@securitydept/token-set-context-client-angular`
- `@securitydept/client-react`
- `@securitydept/client-react/tanstack-router`
- `@securitydept/client-angular`

The packaging rules stay the same:

- framework-neutral root surfaces must not require React / Angular
- framework adapters stay in independent packages
- framework peers stay in `peerDependencies`
- Angular adapters are built through `ng-packagr` and APF / FESM2022 output

## Recommended Repository Layout

The client SDK should stay in a dedicated library workspace instead of letting `apps/webui` dictate structure.

Current recommended layout:

```text
sdks/
  ts/
    packages/
      client/
      basic-auth-context-client/
      session-context-client/
      token-set-context-client/
      basic-auth-context-client-react/
      session-context-client-react/
      token-set-context-client-react/
      basic-auth-context-client-angular/
      session-context-client-angular/
      token-set-context-client-angular/
      client-react/
      client-angular/
      test-utils/
```

`apps/webui` is the first-priority React reference app. It is **not** the source of truth for SDK build topology.

<a id="typescript-sdk-coding-standards"></a>
## TypeScript SDK Coding Standards

The following rules apply under `sdks/ts/`.

### Enum-like String Domains

For bounded string domains, prefer:

```ts
export const Foo = {
  Bar: "bar",
  Baz: "baz",
} as const;
export type Foo = (typeof Foo)[keyof typeof Foo];
```

Avoid TypeScript `enum`.

### Named Constants for Public Contracts

Extract named constants for stable vocabulary such as public error codes, trace event names, or log scope tags.  
One-off UI copy or purely local strings should remain inline.

### API Shape: Options Object First

<a id="ts-sdk-api-shape"></a>

Public SDK functions default to **options objects** for optional parameter sets.  
A bare positional second parameter is only acceptable when the meaning is self-evident and there is clear ergonomic value.

When an existing API widens, the whole second parameter should become an options object even if that is breaking.  
`0.x` does not mean silent breakage is acceptable; widening still follows a deliberate API direction.

## Foundation Design

The `@securitydept/client` family is the shared foundation. It does not own auth-context-specific business state machines; it owns reusable cross-context primitives and contracts.

### State Primitives

Direction: snapshot-first, readonly views first, state transitions owned by clients or services.  
Public shape stays centered on `ReadableSignalTrait`, `WritableSignalTrait`, and `ComputedSignalTrait`.

### Event Primitives

Direction: a minimal shared event protocol rather than a hard dependency on one observable library.  
Public shape stays centered on `EventObserver`, `EventSubscriptionTrait`, and `EventStreamTrait`.

### Transport

The foundation defines transport protocols, not one concrete HTTP client or middleware style.  
SDK adapters may consume fetch / axios / Angular HttpClient, but foundation does not own them directly.

### Persistence

`@securitydept/client/persistence` and `@securitydept/client/persistence/web` own storage protocols and browser storage adapters.  
The rules are:

- persistence protocols are stable foundation surface
- browser storage glue lives behind the `/web` subpath
- token material or projection-cache business policy should not be scattered into adopter apps

### Auth Coordination

`@securitydept/client/auth-coordination` owns shared cross-auth-context orchestration primitives:

- requirement planner
- planner host
- matched-route-chain orchestration
- candidate selection / effective client-set composition

It is a shared capability layer and no longer a token-set-only owner.

### Configuration

The configuration system owns:

- source layering
- config normalization
- config projection
- freshness / precedence semantics

It does not own product-level route policy or business decisions.

### Scheduling and Unified Input Sources

The foundation continues to own:

- `timer`
- `interval`
- `scheduleAt`
- `fromEventPattern`
- thin browser input-source bridges such as visibility handling

These are shared scheduler/input primitives, not private implementations of one auth context.

### Internal Dependency Injection

DI exists as a capability in framework adapters or internal runtime glue.  
Angular / React DI semantics must not leak back into the foundation root surface.

## Context Client Design

The three auth-context client families have the following roles.

### `basic-auth-context-client`

Positioning: thin, zone-aware, browser/server convenience.  
Its job is not to grow into a full frontend runtime. It exists to help adopters handle:

- zone-aware `401 -> login`
- logout URLs and logout helpers
- redirect instructions in server-host scenarios

### `session-context-client`

Positioning: the client family for the cookie-session auth context.  
It owns:

- login-redirect convenience
- session user-info probing
- React / Angular provider and hook integration
- server-host helpers

It is not a mode family and does not share token-set-style internal mode splits.

### `token-set-context-client`

Positioning: the product family for the token-set auth context.  
It remains the most complete client family today, but this document now keeps only the **public-surface conclusions**. The full mode / ownership design lives in [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md).

The current formal family surface is:

- `/backend-oidc-mode`
- `/backend-oidc-mode/web`
- `/frontend-oidc-mode`
- `/orchestration`
- `/access-token-substrate`
- `/registry`
- independent React / Angular adapter packages

Core rules:

- the mode family still belongs to `token-set-context`
- shared route / framework glue has moved back to `@securitydept/client*`
- the browser-owned baseline stays clearly separate from mixed-custody / BFF themes

## SSR / Server-Side Support

In the TypeScript SDK vocabulary, SSR / server-host support means **helpers and contracts for server-hosted client code**, not the Rust backend crates themselves.

### `basic-auth-context` and `session-context`

Both families now have a dedicated `./server` helper baseline.  
The current recommended entry is:

- `basic-auth-context-client/server` for unauthorized redirect instructions and login/logout URLs
- `session-context-client/server` for cookie forwarding, user-info probing, and login/logout URLs

### `token-set-context`

`token-set-context` still does **not** include server-side token ownership in the `0.2.0` baseline.  
Browser-owned token material remains the current baseline; mixed-custody, BFF, and server-side token-set ownership remain deferred in [100-ROADMAP.md](100-ROADMAP.md).

## Error Model

The error model continues to follow:

- transport / protocol / domain layering
- explicit error codes over message-only strings
- public errors that remain interpretable instead of leaking host-internal exception shapes

## Cancellation and Disposal

The public contract still expects:

- long-running browser flows can be canceled or reset
- services / controllers / providers can release resources on teardown
- adopters should not have to manually clean up SDK-owned watchers, timers, or subscriptions

## LoggingTracingand Testing

The rules stay the same:

- the foundation provides logger / trace integration points
- reference apps may build probes, timelines, and diagnostics, but those do not automatically become SDK public surface
- real authority is maintained by inventory + evidence + release-gate

## BuildCompatibilityand Side Effects

### Output and Compatibility

The TypeScript family is ESM-first.  
Adapter packages and core packages share that direction; there is no longer a dual-track build story for legacy packaging.

### Polyfills

The SDK does not bundle global polyfills by default.  
If host capabilities must be patched, the adopter must decide explicitly.

### sideEffects / Tree Shaking

Public packages should be tree-shakeable by default.  
Any import-time side effect must be treated as serious contract pollution.

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
| `@securitydept/basic-auth-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/session-context-client` | `stable` | `session-context` | `stable-deprecation-first` |
| `@securitydept/session-context-client/web` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/session-context-client/server` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
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

The token-set family should now be read like this:

- `/backend-oidc-mode`: platform-neutral client / service / token-material entry
- `/backend-oidc-mode/web`: browser glue
- `/frontend-oidc-mode`: frontend-owned OIDC mode
- `/orchestration`: token-material lifecycle / propagation shared layer
- `/access-token-substrate`: access-token propagation vocabulary and substrate contract
- `/registry`: shared multi-client lifecycle core

#### Capability Boundary Rules

- framework route glue belongs to `@securitydept/client-react` / `@securitydept/client-angular`
- browser token-lifecycle glue belongs to the token-set family
- app-local business helpers are not SDK public surface
- reference apps are authority evidence, not default owners

#### token-set-context-client Frontend Subpath / Abstraction Split

Frontend adopters should now reason about the stack in three layers:

1. foundation / shared coordination
2. token-set mode / substrate / registry
3. framework adapters and reference-app consumption

The token-set family should no longer be read as the sole owner of every piece of frontend glue.

#### Config Projection Source Contract (`frontend-oidc-mode/config-source.ts`)

`frontend-oidc-mode` remains the projection-source authority.  
Source precedence, freshness, restore, and revalidate semantics belong there; how a host obtains config (network / bootstrap script / persisted) is handled by the mode surface plus adopter glue.

### Framework Router Adapters

Framework router adapters now live under the shared framework owner:

- `@securitydept/client-react/tanstack-router`
- `@securitydept/client-angular`

The canonical contract now is:

- matched-route-chain
- `inherit / merge / replace`
- a split between root-level runtime policy and child-route declarative metadata
- parity between Angular and TanStack Router

The token-set family no longer owns the shared router-adapter surface.

### token-set-context-client v1 Scope Baseline

The current `0.2.0` baseline remains:

- browser-owned token-set
- framework adapters plus reference-app and downstream-adopter calibration
- multi-client lifecycle / route orchestration / readiness / callback baselines

Still **outside** the baseline:

- mixed-custody
- BFF / server-side token ownership
- a heavier chooser-UI product layer
- synchronized productization of non-TS SDKs

### Adopter Checklist

#### Things that must not be treated as SDK surface

The following are not SDK public surface by default:

- app-local business helpers under `apps/webui/src/api/*`
- reference-page UI and diagnostics glue
- the adopter's own route tables, page state, or toast copy
- data-shaping helpers that exist only for one app

#### Checklist before integration

Before entering any surface, confirm:

1. which auth context you need, not which demo page you saw first
2. whether you are integrating in a browser host, framework host, or server host
3. whether you need a stable root contract or a provisional adapter
4. whether you accept the current `0.2.0` / `0.3.0` boundary

### Verified Environments / Host Assumptions

"Verified" in this document means there is focused evidence, reference-app proof, or downstream-adopter proof in the repo.  
It does **not** mean broad coverage across every mainstream host environment.

The main currently verified hosts are:

- Node / browser baseline
- React 19 host
- Angular host
- TanStack Router host
- raw Web Router baseline
- the real adopter lines through `apps/webui` and `outposts`

### Minimal Entry Paths

#### 1. Foundation entry: runtime stays explicit

When you need shared primitives, enter through the `@securitydept/client` family.  
This is the capability entry, not a product-level auth shell.

#### 2. Browser entry: `./backend-oidc-mode/web` owns browser glue

When you integrate backend-owned OIDC / token-set flows in the browser, enter through:

- `@securitydept/token-set-context-client/backend-oidc-mode/web`

This subpath owns browser-specific concerns such as redirect paths, callback resume, storage, and bootstrap semantics.

#### 3. React entry: `session-context-client-react` starts with Provider, hook wiring

React adopters should prefer the independent React adapter packages instead of hand-rolling provider glue from core roots.  
That applies equally to:

- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

#### 4. SSR / server-host entry: dedicated `./server` helpers

Server-host adopters should prefer the dedicated `./server` helpers:

- `@securitydept/basic-auth-context-client/server`
- `@securitydept/session-context-client/server`

Do not import `/web` subpaths into server-hosted code.

### Provisional Adapter Maintenance Standard

`./web`, `./server`, and the framework adapter packages continue to be maintained against a stricter `provisional` bar than stable root surfaces.

The bar is:

- stable capability boundaries
- stable import-time behavior
- ordinary usage that does not depend on reference-app glue
- focused evidence plus real dogfooding
- verified-environment statements that match actual validation scope

#### Provisional Adapter Promotion Checklist

Only consider promotion from `provisional` to `stable` when all of the following hold:

| Condition | Requirement |
|---|---|
| capability boundary is stable | no more owner reshuffles across multiple iterations |
| minimal entry is clear | can be explained independently of a full reference page |
| ordinary usage is mature | does not depend on app-local glue |
| focused evidence is complete | lifecycle / regression / import-contract guardrails exist |
| verified environments are explicit enough | host validation is not overstated |

#### Current Promotion Readiness (snapshot, not roadmap)

| Adapter / Surface | Current judgment |
|---|---|
| `@securitydept/client/web` | stable, foundation-owned browser helper surface |
| `@securitydept/client/auth-coordination` | provisional, but the matched-route-chain / planner-host contract is already established |
| `@securitydept/client/web-router` | provisional, with the raw Web baseline in place |
| `basic-auth-context-client/web` | provisional, with thin browser convenience established |
| `session-context-client/web` | provisional, with login-redirect convenience established |
| `basic-auth-context-client/server` / `session-context-client/server` | provisional, with an SSR/server-host baseline established |
| `*-react` / `*-angular` adapter family | provisional, with real reference-app / downstream-adopter proof but not yet a broad host matrix |
| `token-set-context-client-react/react-query` | provisional; read-path authority is established, while SDK-owned canonical mutation surface is still being tightened |

## Raw Web Router Baseline

**Subpath**: `@securitydept/client/web-router`

It is the standard answer for non-framework hosts:

- Navigation API first, History API fallback
- one planner-host submission per full matched-route chain
- no reimplementation of auth logic inside the router

Its shared semantics with Angular and TanStack Router are:

- full-route aggregation
- `inherit / merge / replace`
- unauthenticated policy remains candidate-owned

## Shared Client Lifecycle Contract

**Subpath**: `@securitydept/token-set-context-client/registry`

It is the shared multi-client lifecycle core for the token-set family.  
It currently owns:

- `primary` / `lazy` initialization priority
- `preload`
- `whenReady`
- `idleWarmup`
- `reset`
- keyed lookup aligned with callback/readiness behavior

React and Angular adapters must consume this shared core instead of re-implementing registry semantics separately.

## React Query Integration

**Subpath**: `@securitydept/token-set-context-client-react/react-query`

Its current meaning must stay explicit:

- it is the token-set React consumer surface
- it is not the login / refresh / runtime authority
- query state derives from registry / auth-service state, not the other way around

What is already authoritative today:

- groups / entries read paths
- readiness queries
- authorization-header derivation
- the query-key namespace

What is still being tightened:

- iteration 114 proved that reference-app-local mutation dogfooding works
- but an SDK-owned canonical mutation surface is still being brought into place
- therefore `./react-query` must still be read as a **read-side + readiness + query-key primitive layer**

## Examples and Reference Implementations

### Primary Real Reference Apps

The current first-priority reference apps / hosts are:

- `apps/server`
- `apps/webui`

Their roles are:

- `apps/server`: the real auth / propagation / route-composition semantics host
- `apps/webui`: the React / browser / multi-context auth-shell / token-set reference-page / dashboard dogfooding authority

### Downstream Reference Case: Outposts

`~/workspace/outposts` is a high-value downstream adopter for validating:

- Angular hosting
- backend-driven config projection
- route-level orchestration
- real multi-requirement integration

But its historical app-local glue is not the SDK API template.  
SDK design still needs to be driven by `securitydept`'s own domain semantics and ergonomics.

### Current Bundle / Code Split Judgment

Bundle/code-splitting is now an engineering optimization topic rather than a public-contract blocker.  
Priority continues to stay below contract freeze, authority alignment, and adopter clarity.

### Demo and OIDC Provider

Interactive demos are fine, but:

- demos and providers are not authority
- provider choice must not dictate package boundaries
- demos explain contracts; they do not replace focused evidence

## Requirements for Future Developers and AI Agents

- do not rename or rebuild the client SDK as `auth-runtime`
- do not let framework adapters pollute the foundation
- do not introduce import-time side effects or default global polyfills
- do not productize reference-app glue as SDK API
- do not smuggle mixed-custody / BFF themes back into the `0.2.0` baseline
- when public surface, docs, examples, or inventory move, move them together

[English](007-CLIENT_SDK_GUIDE.md) | [中文](../zh/007-CLIENT_SDK_GUIDE.md)
