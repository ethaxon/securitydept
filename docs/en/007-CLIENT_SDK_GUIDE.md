# Client SDK Guide

This guide is the adopter-facing reference for the current TypeScript SDK surface. It explains package boundaries, stable entry points, environment/controller responsibilities, and the current `0.3.x` scope boundary.

It does not carry roadmap history or implementation chronology. Use [100-ROADMAP.md](100-ROADMAP.md) for release backlog and deferred work, [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) for public-surface migration decisions, and [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md) for the downstream adopter case.

## Goal

The SDK gives browser, React, Angular, and server-host adopters explicit auth-context entry points without turning reference-app glue into public API. The current `0.3.x` baseline is browser-owned token-set auth plus thin basic-auth/session helpers; mixed-custody, BFF, and server-side token ownership remain outside the SDK baseline.

## Current Scope and Boundaries

What the SDK owns:

- `@securitydept/client` owns foundation environment primitives, persistence, cancellation, tracing, and shared auth coordination.
- `@securitydept/basic-auth-context-client` and `@securitydept/session-context-client` own thin auth-context helpers for browser and server hosts.
- `@securitydept/token-set-context-client` owns browser-owned token-set modes, registry lifecycle, access-token substrate vocabulary, and OIDC mode entries.
- `@securitydept/client-react` / `@securitydept/client-angular` own shared framework-router glue; `@securitydept/client-react` additionally owns the only SDK React Context and the shared signal/event bridge.
- Context-specific React / Angular packages bridge their family contracts; React packages now export injection tokens, provider factories, and explicit callback/component helpers instead of domain-specific React Context / Provider / `useXxxContext()` APIs.

What stays outside the SDK:

- `apps/webui/src/api/*`, pages, copy, route tables, and diagnostics UI are reference-app glue.
- `~/workspace/outposts` is a downstream calibration case, not an SDK API template.
- provider choice, chooser UI, product flow semantics, and app-local failure copy remain adopter responsibilities.

## Top-Level Decisions

- TypeScript is the only active SDK productization track for `0.3.x`.
- Framework adapters stay thin and consume shared core owners rather than becoming first owners of framework-neutral behavior.
- Public surface changes move together with the inventory, focused verification tests, docs anchors, and migration ledger entries.
- The current `0.3.x` release-preparation line is packaging, documentation, downstream-adopter correctness, and release readiness work; it does not add a new auth context.

## Terminology and Naming

- **auth context**: a deployment-oriented family such as basic-auth, session, or token-set.
- **mode**: a concrete operating shape inside an auth context, such as `frontend-oidc` or `backend-oidc`.
- **environment**: a host composition-root dependency object. It carries transport, stores, clock, scheduler, logging/tracing, and host capabilities such as page location/history. Core client constructor dependencies are also an environment; they are not a separate runtime object.
- **capability**: the narrowest structural view a helper needs from an environment or host object, such as `PageLocationCapability` or `PageLocationHistoryCapability`.
- **client**: a protocol/domain object that performs auth, session, OIDC, token, or resource operations.
- **registry**: a multi-client owner for registration, readiness/lazy lifecycle, keyed lookup, URL/callback discrimination, and route/resource orchestration.
- **controller**: a framework-neutral state-machine or flow-orchestration owner. It owns state/signals, in-flight coalescing/dedupe, disposal, and commands such as `resume()`, `refresh()`, or `logout()`.
- **service**: a host/framework facade or broader application service entry. A service may wrap a controller, but it must not redefine the controller's state-machine semantics.
- **adapter**: a framework-specific host integration layer.
- **reference app**: proof and example, not default owner.

Naming rule: dependency objects use `Environment` or a narrower `Capability` suffix; state/flow owners use `Controller`; framework facades use `Service`; protocol objects use `Client`; multi-client lifecycle owners use `Registry`. Do not introduce new public `XxxRuntime` names for dependency bags or state owners.

## Packaging Style

Packages are small, explicit, and side-effect-light. Root exports carry stable family contracts where possible. `/web`, `/server`, framework, and router subpaths carry host-specific glue and remain provisional until the host matrix and verification coverage are broader.

## Recommended Repository Layout

Adopters should keep SDK usage close to the auth boundary:

```text
src/auth/
  environment.ts
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

The foundation layer is not an auth product shell. It exists so family packages can share environment-safe contracts.

### State Primitives

State primitives are explicit, host-owned, and framework-neutral. Framework adapters may expose convenience hooks or signals, but the shared state contract remains in foundation or family owners.

### Event Primitives

Events should describe machine-facing lifecycle facts. User-facing presentation belongs to the host.

`@securitydept/client/events` exposes the foundation event-stream traits and operator facade used by token-set lifecycle telemetry. Family packages should emit SecurityDept event traits as their public contract; RxJS is an implementation and interop detail, not the shape adapters must expose.

### Transport

Transport is always injected or selected by the host. SDK packages must not assume a global fetch policy beyond the documented browser/server entry.

### Persistence

`@securitydept/client/persistence` owns `RecordStore` semantics, including single-consume callback state through `take()`. `@securitydept/client/persistence/web` owns browser persistence adapters.

### Auth Coordination

`@securitydept/client/auth-coordination` owns planner-host and requirement orchestration primitives. It is headless: it may decide required actions, but it does not own chooser UI, route copy, or product flow semantics.

### Configuration

Read configuration in three layers:

1. foundation environments/capabilities
2. auth-context config
3. adapter/host registration glue

Do not flatten these into one global config DSL for the current baseline.

### Scheduling and Unified Input Sources

Scheduling, cancellation, abort interop, visibility, storage, and promise/signal helpers live in foundation and web subpaths. They are shared primitives, not a stream DSL.

### Unified Dependency Injection

`@securitydept/client/injection` is now the framework-neutral DI authority. `SecuritydeptInjectorTrait` is the minimal read-side contract and only expresses `get()`; consumers, React Context, and third-party injector adapters work against that duck type. `SecuritydeptInjector` is the SDK runtime/facade that owns `resolveAndCreate()`, `fromParentInjector()`, explicit provider resolution, parent inheritance, overrides, and side-effect-free `has()` diagnostics.

React is allowed exactly one SDK Context, all in `@securitydept/client-react`: `SecuritydeptContext`, `SecuritydeptProvider`, and `useSecuritydeptContext()`. Domain React packages no longer create their own public Context/Provider/`useXxxContext()` surface. They export injection tokens, provider factories, explicit callback/component bridges, and signal/event helpers that compose with `useReadableSignal()` and `useEventStream()`.

Angular DI remains an adapter concern. Framework-neutral host capability resolution remains a foundation concern. Core clients still consume `ClientEnvironment`; non-client-bound helpers still consume explicit typed environment objects or narrower capability views created by the host composition root.

The canonical foundation model is:

- `ClientEnvironment` is the flattened foundation client dependency environment. It directly carries transport, scheduler, clock, logging/tracing, and persistence/session stores. Historical `ClientRuntime` naming is retired and not canonical vocabulary.
- `WebClientEnvironment` is the Web-capable client environment and does not imply a page document.
- `PageClientEnvironment` extends the Web environment with page-only capabilities such as `window.location` and `window.history`.
- Helpers should request the narrowest capability view they need, for example `Pick<WebClientEnvironment, "transport" | "sessionStore">` or `PageLocationHistoryCapability`, rather than accepting the full environment by default.
- `environment.runtime`, `ClientRuntime`, `createRuntime()`, `createWebRuntime()`, and `deriveClientRuntime()` are retired naming artifacts. New public API and documentation must use Environment names such as `ClientEnvironment`, `createClientEnvironment()`, or `deriveClientEnvironment()`.
- Public option keys that carry environment-like dependency sources should stay named `environment`; the required capability is expressed by the type, not by introducing parallel keys such as `pageEnvironment`.

Conceptual split:

| Concept | Owns | Does not own | Naming |
|---|---|---|---|
| Environment | host dependencies and capabilities | business lifecycle state machine | `ClientEnvironment`, `WebClientEnvironment`, `PageClientEnvironment` |
| Capability | minimal structural dependency view | unrelated host dependencies | `PageLocationCapability` |
| Client | protocol/domain operations | framework lifecycle or DI | `SessionContextClient`, `BackendOidcModeClient` |
| Registry | multi-client registration/readiness/discrimination | UI policy or framework state | `TokenSetAuthRegistry` |
| Controller | framework-neutral flow/state orchestration | framework DI facade or product UI | `TokenSetCallbackResumeController`, `SessionContextController` |
| Service | framework/host facade over clients/controllers | duplicated core state semantics | `SessionContextService`, `CallbackResumeService` |

Do not model these objects as a DI container, service locator, provider tree, global singleton, or business config DSL. Auth-context configuration such as base URLs, source keys, account binding, and product routes remains in family config or host code, not in the foundation environment.

Foundation Web presets are explicit composition templates, not automatic host detection:

| Preset factory | Returns | Default page capabilities | Default Web storage | Intended host |
|---|---|---:|---:|---|
| `createBrowserPageClientEnvironment(options)` | `PageClientEnvironment` | yes | yes | real browser page, tab, or popup document |
| `createBrowserWorkerClientEnvironment(options)` | `WebClientEnvironment` | no | no | dedicated/shared worker-style browser host |
| `createServiceWorkerClientEnvironment(options)` | `WebClientEnvironment` | no | no | service worker |
| `createBrowserExtensionBackgroundClientEnvironment(options)` | `WebClientEnvironment` | no | no | extension background or MV3 service-worker-style host |

Preset names are public vocabulary for docs, trace/error context, and tests through `ClientEnvironmentPreset`. Do not use a string-driven `createEnvironmentFromPreset(name)` or global-shape detection to guess the host. Worker, service-worker, and extension-background presets must receive persistence/session stores explicitly when they need storage, and page-only helpers must fail fast when used outside a page environment.

When a host needs stable layered environment ownership across routes, commands, or framework adapters, use `ClientEnvironmentService` from `@securitydept/client/web` as the reusable foundation resolver. `resolveClientEnvironment()` / `resolveWebEnvironment()` / `resolvePageEnvironment()` coalesce concurrent async materialization, while `read*()` exposes Suspense-compatible render-time reads by throwing the shared pending promise or cached error. In React, the canonical bridge is no longer a dedicated environment Provider; instead, register `provideClientEnvironmentService()` through `SecuritydeptProvider` and read the same service later through `useSecuritydeptContext().get(CLIENT_ENVIRONMENT_SERVICE)` or explicit props. In Angular, the canonical DI bridge remains `providePageClientEnvironment({ environment })` from `@securitydept/client-angular`. Service instances belong to the framework composition root (injector or another host-owned scope), not to JS module-cache singletons.

This rule applies beyond `@securitydept/client`: context packages and framework adapters must use the same boundary for public helpers. Any helper that reads host globals, performs page navigation, constructs a client, or owns transport/store/scheduler/clock wiring should accept a client environment or a narrow capability view. Provider, DI, and top-level adapter registration APIs may accept a full environment as composition roots; ordinary hooks, guards, interceptors, services, and convenience helpers should not each redeclare the full dependency bag.

## Context Client Design

### `basic-auth-context-client`

Stable root surface for basic-auth boundary helpers. The `/web` and `/server` entries provide thin host helpers, and React/Angular adapters remain host wrappers.

### `session-context-client`

Stable root surface for session login URL, post-auth redirect, user-info, logout, and browser-shell convenience. `SessionContextController` is the framework-neutral state owner for user-info refresh, logout cleanup, and redirect helpers. Framework adapters consume this controller through hooks, DI, signals, or observables rather than duplicating session semantics.

### `token-set-context-client`

Provisional token-set family for browser-owned OIDC/token material flows. It owns `backend-oidc-mode`, `frontend-oidc-mode`, `orchestration`, `access-token-substrate`, and `registry` entries. The registry entry owns shared callback resume orchestration through `TokenSetCallbackResumeController`; React hooks and Angular services/components bridge that controller instead of becoming callback state machines.

## SSR / Server-Side Support

### `basic-auth-context` and `session-context`

Server-host adopters should use the dedicated `/server` helper entries for host-neutral request/response coordination.

### `token-set-context`

Server-side token ownership, BFF, and mixed-custody remain outside the current `0.3.x` SDK baseline. The current SDK baseline is browser-owned token-set.

## Error Model

SDK errors expose machine-facing codes and host-facing recovery hints where relevant. Host copy and UI state remain adopter-owned. Do not parse opaque `Error.message` strings for control flow.

## Cancellation and Disposal

`@securitydept/client/web` owns browser cancellation interop, including AbortSignal bridges. Long-lived hosts should wire cancellation and disposal explicitly.

## Logging, Tracing, and Testing

`@securitydept/client` owns the minimal trace event and operation-correlation primitives used by SDK flows. `@securitydept/test-utils` remains experimental and is not a current beta npm publish target.

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

The table below is the current TS SDK public-surface snapshot. It must remain aligned with `public-surface-inventory.json`.

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
| `@securitydept/client/events` | `provisional` | `foundation` | `provisional-migration-required` |
| `@securitydept/client/injection` | `provisional` | `foundation` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/backend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/backend-oidc-mode/web` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/orchestration` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/access-token-substrate` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/registry` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/web-router` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/test-utils` | `experimental` | `foundation` | `experimental-fast-break` |
| `@securitydept/basic-auth-context-client-angular` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-angular` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react/react-query` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react/tanstack-router` | `provisional` | `token-set-context` | `provisional-migration-required` |
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
- `/web-router`: token-set-specific raw Web Router helper that calls the canonical auth barrier before redirect/block fallback.

#### Capability Boundary Rules

- Framework router glue belongs to shared framework adapters.
- Browser token-lifecycle glue belongs to the token-set family.
- App-local business API wrappers are not SDK public surface.
- Reference apps prove real usage patterns; they do not define package ownership by themselves.

#### token-set-context-client Frontend Subpath / Abstraction Split

Frontend adopters should reason in layers: foundation coordination, token-set mode/substrate/registry, then framework adapter. The token-set family is not the sole owner of every frontend helper.

#### Config Projection Source Contract (`frontend-oidc-mode/config-source.ts`)

`frontend-oidc-mode` owns projection-source precedence, validation, freshness, restore, and revalidation. `createFrontendOidcModeBrowserClient()` owns browser materialization from an explicit `FrontendOidcModeWebClientEnvironment`; the host owns config endpoint wiring, environment creation, and page routes.

#### Reference-App Baseline (`apps/webui` / `apps/server`)

`apps/webui` and `apps/server` define the current in-repo baseline: backend-mode and frontend-mode host splits, keyed callback/readiness, React Query token-set management flows, route security, dashboard bearer access, browser harness reporting, and shared error/diagnosis consumption.

The reference app should prove canonical SDK usage directly. `apps/webui` now reads SDK dependencies through `useSecuritydeptContext().get(TOKEN)`, `useReadableSignal(...)`, and explicit assertion/helpers local to each feature instead of hiding those reads behind a shared app-local facade.

### Framework Router Adapters

Framework router adapters are owned by:

- `@securitydept/client-react/tanstack-router`
- `@securitydept/client-angular`

Canonical semantics: full matched-route chain aggregation, `inherit` / `merge` / `replace`, child-route serializable metadata, root-level runtime policy, and no product chooser UI in the SDK.

Angular token-set route handlers receive a route unauthenticated context with `attemptedUrl`. Use that value when starting OIDC redirect login so the attempted navigation is recorded as `postAuthRedirectUri`. The canonical Angular path is to provide one provider-scoped environment source from the composition root with `providePageClientEnvironment({ environment })`, where `environment` is typically a stable `ClientEnvironmentService` or another inject-safe resolver owned by Angular DI, then call `createTokenSetOidcLoginRedirectHandler({ ... })` without re-creating page capability in every guard path. The shared contract is `OidcRedirectLoginClient` plus `OidcRedirectLoginOptions` from `@securitydept/token-set-context-client/registry`; Angular, React/TanStack, `FrontendOidcModeClient`, and backend-oidc web clients all target that capability instead of a mode-qualified helper. The helper keeps `environment` as its public key, but that key now represents a stable page-environment source that the guard awaits inside the same async flow as registry lookup; use an already-materialized page environment object only when the host intentionally owns synchronous page capability. Do not read Angular `Router.url` for this value inside a guard handler, because the attempted navigation has not been committed yet. A handler that has started a full-page external redirect should not resolve to `false`; the SDK helper returns a never-settling guard result after starting the redirect so Angular does not finalize an in-app navigation cancel while the page is leaving.

TanStack Router's `createSecureBeforeLoad()` likewise passes an unauthenticated handler context with `attemptedUrl`. React/TanStack adopters that start a full-page external auth redirect should use `createExternalRedirectBeforeLoadHandler()`, call their login client inside the callback, and pass `context.attemptedUrl` as `postAuthRedirectUri`. Do not infer the target page from `window.location`; while `beforeLoad` is running, the current document URL may still be the previously committed route.

### token-set-context-client v1 Scope Baseline

The current `0.3.x` baseline is browser-owned token-set with framework adapters, registry lifecycle, route orchestration, readiness, callback handling, in-repo proof, and downstream calibration.

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
4. Accept the current `0.3.x` boundary before depending on token-set behavior.

### Verified Environments / Host Assumptions

Verified means focused verification, in-repo proof, or downstream calibration exists. It does not mean broad coverage across every host.

Current verification covers Node/browser foundation behavior, React 19, Angular, TanStack Router, raw Web Router, `apps/webui`, and `outposts`. Host support should be described through ECMAScript requirements, adapter capabilities, and direct verification.

### Minimal Entry Paths

#### 1. Foundation entry: environment stays explicit

Use `@securitydept/client` for shared primitives. It is not a product-level auth shell.

#### 2. Browser entry: `./backend-oidc-mode/web` owns browser glue

Use `@securitydept/token-set-context-client/backend-oidc-mode/web` for backend-owned OIDC/token-set browser flows.

This subpath is browser-host glue, not a promise that every Web-like runtime has page navigation. Use the foundation environment boundary before choosing helpers:

- Browser client construction should take a `WebClientEnvironment` created at the host composition root. Do not pass transport, scheduler, clock, persistent store, and session store independently to every helper.
- Worker-like hosts, service workers, and extension backgrounds may create/restore clients and run token-state APIs, but they must not run page callback capture by default.
- Page-only helpers may read `window.location` / `window.history` only through `PageClientEnvironment`; their names or options must make the page boundary explicit, such as `currentPageLocationAsPostAuthRedirectUri`, `buildAuthorizeUrlReturningToCurrentPage`, `bootstrapBackendOidcModePageClient`, and `captureBackendOidcModePageCallbackFragment`. For token-set OIDC login, the shared browser entry is `loginWithRedirect({ environment, postAuthRedirectUri })` on an `OidcRedirectLoginClient`: `FrontendOidcModeClient` satisfies that contract directly, and `createBackendOidcModeWebClient(...)` materializes the same method while `loginWithBackendOidcRedirect(...)` remains a legacy/convenience alias. Popup helpers such as `loginWithBackendOidcPopup` and `relayBackendOidcPopupCallback` remain page-only and fail fast outside an explicit environment.
- Host-injected callback helpers must receive a `BackendOidcModeWebClientEnvironment` or explicit page/callback-fragment capabilities. `loginWithBackendOidcPopup()` requires `BackendOidcModePopupLoginCapability`, and `resetBackendOidcModeBrowserState()` requires an explicit `callbackFragmentStore`; ordinary helpers do not construct global session-storage-backed fragment stores. They must fail fast when a required capability is missing instead of falling through to `window is not defined` or stale URL parsing.

Recommended host environments:

| Host | Environment | Callback capture | Restore/token state | Storage defaults |
|---|---|---:|---:|---|
| browser page/tab/popup | `PageClientEnvironment` | yes | yes | page storage may be used |
| browser worker | `WebClientEnvironment` | no by default | yes | explicit store only |
| service worker | `WebClientEnvironment` | no by default | yes | explicit store only |
| extension background | `WebClientEnvironment` | no by default | yes | explicit store only |

Do not decide whether callback bootstrap is allowed by checking `globalThis.location`. A service worker or extension background may expose a location-like object without page history semantics. Page detection must validate page/document capabilities such as `window.location` and `window.history.replaceState`.

The same page-boundary rule applies to basic-auth and session `/web` redirect helpers: redirect helpers that read or write `window.location` are page helpers. Worker-like hosts must pass explicit URL/navigation capabilities or keep redirect initiation in a real page context.

#### 3. React entry: one SDK context plus injector factories

Use:

- `@securitydept/client-react`
- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

React composition still follows the three-layer model: auth-context config, injector providers/factories, and host registration glue.

- `@securitydept/client-react` owns the only SDK React Context: `SecuritydeptContext`, `SecuritydeptProvider`, and `useSecuritydeptContext()`. It also owns the context-free signal/event bridge `useReadableSignal()` and `useEventStream()`.
- `provideClientEnvironmentService()` and the planner-host factories (`AUTH_PLANNER_HOST`, `provideAuthPlannerHost()`, `AUTH_REQUIREMENTS_CLIENT_SET`, `provideRequirementsClientSet()`) register shared dependencies into the injector. They do not introduce additional domain-specific Providers or Context hooks.
- `@securitydept/basic-auth-context-client-react` exports `BASIC_AUTH_CONTEXT_CLIENT`, `createBasicAuthContextClient()`, and `provideBasicAuthContextClient()`. React code reads the client through `useSecuritydeptContext().get(BASIC_AUTH_CONTEXT_CLIENT)`.
- `@securitydept/session-context-client-react` exports `SESSION_CONTEXT_CLIENT`, `SESSION_CONTEXT_CONTROLLER`, `createSessionContextController()`, and `provideSessionContextController()`. React code reads controller/client through `useSecuritydeptContext().get(...)` and reads state through `useReadableSignal(controller.state)`.
- `@securitydept/token-set-context-client-react` exports `provideTokenSetAuthRegistry()`, `TOKEN_SET_AUTH_REGISTRY`, `provideTokenSetCallbackResumeController()`, `TOKEN_SET_CALLBACK_RESUME_CONTROLLER`, `useTokenSetCallbackResume()`, and `TokenSetCallbackComponent`. There is no separate token-set runtime wrapper anymore. The canonical keyed auth-state path is `const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY)` followed by `useReadableSignal(registry.clientSignalFor("main"))`, then reading the returned client's replay channels such as `authSnapshot` or `isAuthenticated`.
- `useTokenSetCallbackResume({ controller, injector, getCurrentUrl, describeError })` is the explicit callback bridge over the shared `TokenSetCallbackResumeController`. An explicit `controller` or `injector` wins; when no current URL is available the hook stays idle instead of forcing callback handling. Default failure presentation comes from `readCallbackResumeErrorDetails()` in `@securitydept/token-set-context-client/registry`; mode-specific copy belongs in an explicit `describeError` override owned by the host or adapter.

#### 4. Angular entry: thin DI wrappers preserve canonical owner boundaries

Use:

- `@securitydept/basic-auth-context-client-angular`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client-angular`

Layering rules:

- `provideBasicAuthContext({ config })`: auth-context config only.
- `provideSessionContext({ config, environment, initialRefresh })`: adapter leaf over `SessionContextController`; Angular DI reads `environment.transport` and `environment.sessionStore` from the same `WebClientEnvironment` and registers the controller. Service construction does not auto-probe user-info unless `initialRefresh` is explicit.
- `SessionContextService`: signal / observable facade over the controller. Low-level auth-context behavior remains on `SessionContextService.client`.
- `provideTokenSetAuth({ clients, idleWarmup })`: Angular host registration; each client entry still owns auth-context config and environment composition.
- `providePageClientEnvironment({ environment })`: canonical Angular DI bridge for page-scoped capability resolution. The canonical value is a provider-scoped `ClientEnvironmentService` or another inject-safe stable resolver that can await page capability; passing a synchronous page environment object is only the already-materialized host-owned case.
- `CallbackResumeService` wraps the shared `TokenSetCallbackResumeController` and exposes component-free `resume(url)` state through Angular signals / observables. `TokenSetCallbackComponent` is only a page-only convenience component on top of that service; custom hosts, SSR-like tests, or shell adapters can override URL/policy tokens or call `CallbackResumeService.resume(url)` directly. `handleCallback(url)` remains a compatibility wrapper.
- `provideTokenSetBearerInterceptor(options?)` / `createTokenSetBearerInterceptor(registry, options?)`: bearer-header injection using the SDK options-object API form. Before adding `Authorization`, the interceptor waits for the selected client's `authorizationHeaderValue` replay signal. It does not trigger refresh or auth checks; client `start()`, refresh timers, page-resume auth-check triggers, or explicit `authCheck()` own maintenance. `BearerInterceptorOptions.strictUrlMatch` controls unmatched URL behavior:
  - default `strictUrlMatch: false`: keeps the single-client convenience fallback by waiting for the only registered client's `authorizationHeaderValue`; use only when the host calls exactly one registered backend.
  - `strictUrlMatch: true`: unmatched URLs receive no `Authorization` header.
  - multi-backend, multi-audience, or third-party-traffic Angular adopters MUST use `strictUrlMatch: true`.
  - `TOKEN_SET_BEARER_INTERCEPTOR_OPTIONS` is exported for advanced DI/test overrides.

Freshness is owned by the token-set core, not by one framework adapter. Consumer code reads replay channels: first-screen readiness uses `authDetermined`, stable UI uses `authSnapshot`, route guards use `isAuthenticated`, and transports/interceptors use `authorizationHeaderValue`. `authCheck(options?)` is the only explicit maintenance command and should be reserved for advanced callers that intentionally trigger one serialized check. Event payloads must not contain raw access, refresh, or ID token values. Header availability does not have a separate event/status lifecycle: usable bearer projection is part of the authenticated snapshot, while missing bearer material remains unauthenticated or an undefined header projection. Mode clients do not expose synchronous bearer convenience APIs, and registry token sugar is not part of the public model. Use `registry.whenReady(key?)` or `registry.clientSignalFor(key?)` to acquire a started client, then consume that client's replay signals.

Browser-owned frontend/backend OIDC factories attach a page-resume auth-check trigger by default. Angular `provideTokenSetAuth(...)` installs the same default for registry-managed browser clients, including `clientFactory` implementations that directly return `createFrontendOidcModeClient(...)`. On `visibilitychange` back to visible, `pageshow`, `focus`, and `online`, the page source emits an auth-check trigger; the client then runs the same queued auth-check pipeline used by restore and refresh timers and emits `auth.check.*` events with `authCheckReason: "page_resume"`. This is a recovery barrier, not an interactive login trigger: refresh failures clear or preserve auth state through the normal token-set client paths, and route/request handlers decide whether to start login. Set per-client `pageResumeAuthCheck: false` only for hosts that install their own equivalent trigger source; pass `pageResumeAuthCheckOptions` to provide custom browser targets or throttling in tests.

Short access-token lifetimes should be handled by the running client state machine: persisted restore performs the initial auth check, refresh timers schedule later checks, and browser resume emits auth-check triggers after hidden tabs, system sleep, or bfcache return. Angular route aggregation waits for pending initial auth determination, then reads `isAuthenticated`; protected requests wait for `authorizationHeaderValue`. When `frontend-oidc-mode` or another token-set mode can stamp `accessTokenIssuedAt`, token freshness caps refresh-window and clock-skew calculations relative to the token lifetime instead of applying a raw fixed window to every token. That keeps newly issued short-lived tokens fresh at issuance while still entering `refresh_due` early enough for restore, resume, and scheduled maintenance. TanStack Router hosts should use `createTokenSetSecureBeforeLoad()` from `@securitydept/token-set-context-client-react/tanstack-router`; raw web hosts should use `createTokenSetWebRouteAuthCandidate()` from `@securitydept/token-set-context-client/web-router`. Both helpers wait for the selected client's `isAuthenticated` replay signal before redirect/block fallback.

If a downstream resource server reports `ExpiredSignature`, the rejection is correct: the frontend sent an expired JWT and the SDK/adopter must not inject that bearer. Diagnose whether the browser has refresh material before blaming the refresh barrier:

```ts
Object.entries(localStorage)
  .filter(([k]) => k.includes("outposts.web.auth"))
  .map(([key, raw]) => {
    try {
      const parsed = JSON.parse(raw);
      const tokens = parsed.value?.tokens ?? parsed.tokens;
      return {
        key,
        accessTokenExpiresAt: tokens?.accessTokenExpiresAt,
        hasRefreshMaterial: Boolean(tokens?.refreshMaterial),
      };
    } catch {
      return { key, parseError: true };
    }
  });
```

When `hasRefreshMaterial=false`, check the IdP, requested scopes, and refresh-token policy; the SDK still must not send the expired access token. For Authentik deployments this usually means verifying that `offline_access` is requested/allowed and that refresh-token rotation/lifetime settings allow the browser client to keep usable refresh material. When `hasRefreshMaterial=true`, the SDK should refresh before route admission, page-resume recovery, or the first protected request, or move the client to unauthenticated state; `ExpiredSignature` should not appear on a request sent through the SDK bearer interceptor or authorized transport.

#### 5. SSR / server-host entry: dedicated `./server` helpers

Use:

- `@securitydept/basic-auth-context-client/server`
- `@securitydept/session-context-client/server`

Do not import `/web` subpaths into server-hosted code.

### Provisional Adapter Maintenance Standard

`./web`, `./server`, and framework packages are maintained at a stricter provisional bar: stable boundaries, safe import-time behavior, ordinary usage without reference-app glue, focused verification, real dogfooding, and accurate verified-environment claims.

#### Provisional Adapter Promotion Checklist

| Condition | Requirement |
|---|---|
| capability boundary is stable | no owner reshuffle across a sustained release window |
| minimal entry is clear | explainable without a full reference page |
| ordinary usage is mature | no app-local glue dependency |
| focused verification is complete | lifecycle, regression, and import-contract guardrails exist |
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
| `token-set-context-client-react/react-query` | provisional; canonical token-set readiness/invalidation glue path established |

## Raw Web Router Baseline

**Subpath**: `@securitydept/client/web-router`

The raw Web Router baseline is for non-framework hosts. It uses Navigation API first, History API fallback, and one planner-host submission per full matched-route chain.

## Shared Client Lifecycle Contract

**Subpath**: `@securitydept/token-set-context-client/registry`

The registry owns `register(entry)`, `unregister(key)`, `resetMaterialization(key)`, `dispose()`, `primary` / `lazy` initialization priority, `preload`, `whenReady`, `idleWarmup`, keyed lookup aligned with callback/readiness behavior, and the shared generic callback failure presenter `describeTokenSetCallbackError()`. React and Angular adapters consume this shared core, while mode-specific copy such as `describeFrontendOidcModeCallbackError()` stays under the mode owner and must be injected explicitly.

The contract now treats `registered` and `ready` as distinct observability surfaces. Use `has()`, `registeredKeys()`, `registeredEntriesSnapshot()`, and `registeredMetaSnapshot()` to inspect configured clients, and `readyKeys()` to inspect clients whose materialization and `start()` lifecycle have completed. Removal and rematerialization now use the canonical verbs `unregister(key)` and `resetMaterialization(key)` directly.

The registry is now also the reactive topology/readiness authority. Observe it through `state: ReadableSignalTrait<TokenSetAuthRegistryState<TClient>>`, `getState()`, or `subscribe()`. Registered snapshot helpers remain available, but they are synchronous convenience over `state.get()` rather than a parallel state source. `clientSignalFor(key?)` is the canonical reactive client acquisition API and triggers lazy materialization/start when called. Promises such as `whenReady()` and `preload()` are action-completion handles, not the canonical observation path.

Per-client token-set auth material is owned by the mode client itself. Every registry-managed OIDC mode client exposes separate auth channels: replay signals for `authDetermined` (first determination), `authSnapshot` (last determined snapshot or `null`), `isAuthenticated` (guard truth), and `authorizationHeaderValue` (bearer projection); plain signals for `lastAuthError` (latest determination/operation error register) and `authOperations.*Pending` (local operation locks). `authSnapshot` is the authoritative auth-material replay source; `authDetermined`, `isAuthenticated`, and `authorizationHeaderValue` are derived replay projections rather than manually synchronized state. Directly created clients start only after `start()` unless `autoStart: true` is explicitly passed. Registry-managed clients never use entry-level `autoStart` or `autoRestore`; registry readiness means the client has been materialized and `start()` has completed. The default `createTokenSetOidcAuthRegistry()` materializes the client itself, so React Query readiness and Angular registry lookups return clients rather than per-client service wrappers. `authEvents` remains auth-domain telemetry only; registry topology and readiness changes are observed through registry `state`.

The canonical RxJS bridge now lives at `@securitydept/client/rx`. Use `toRxObservable(source)` for either `EventStreamTrait` or `ReadableSignalTrait`, and `fromRxObservable(observable)` for the reverse bridge. `@securitydept/client-angular` still owns `bridgeToAngularSignal()` because writable Angular signal bridging is framework-specific, but signal-to-RxJS interop is no longer Angular-owned.

## React Query Integration

**Subpath**: `@securitydept/token-set-context-client-react/react-query`

This is the token-set React Query integration surface. It owns cache-key namespace helpers, readiness queries over registry materialization, and canonical invalidation for token-set-aware query trees. It is not the login, refresh, lifecycle, or reference-app resource API.

Groups/entries domain models, CRUD request assembly, and reference-app TanStack hooks stay app-local or adopter-local. Hosts should compose those resource queries on top of SDK token-set clients or registry readiness rather than importing a productized business API from the SDK.

## Examples and Reference Implementations

### Primary Real Reference Apps

- `apps/server`: auth, propagation, route composition, server error/diagnosis proof.
- `apps/webui`: React/browser/multi-context auth shell, token-set reference page, dashboard, browser harness report, and SDK dogfooding coverage.

### Downstream Reference Case: Outposts

`~/workspace/outposts` validates the real Angular adopter path. It uses `provideTokenSetAuth(...)` plus `provideTokenSetBearerInterceptor({ strictUrlMatch: true })`, proving strict URL-prefix bounded bearer injection against a downstream `confluence` backend. The path also calibrates stale-token handling: the SDK must refresh or clear before the first protected Confluence request instead of sending an expired bearer that the backend correctly rejects with `ExpiredSignature`. Its app-local auth service remains adopter glue, not an SDK API template.

Downstream verification should use local pnpm `link:` dependencies for SecurityDept SDK packages, not package-manager overrides. Plain TS packages can link to package roots; Angular packages should link to their built `dist/` outputs after rebuilding, then clear the downstream Angular/Vite cache before browser verification.

### Current Bundle / Code Split Judgment

Bundle and code-splitting are engineering optimization topics, not public-contract blockers for the current `0.3.x` line.

### Demo and OIDC Provider

Demos explain contracts. Provider choice and demo pages do not define package boundaries or replace focused verification.

## Requirements for Future Developers and AI Agents

- Do not rename or rebuild the client SDK as `auth-runtime`.
- Do not let framework adapters pollute foundation packages.
- Do not introduce import-time side effects or default global polyfills.
- Do not productize reference-app or adopter glue as SDK API.
- Do not move mixed-custody / BFF / server-side token ownership into the current SDK baseline.
- Move public surface, docs, examples, inventory, and migration notes together.

[English](007-CLIENT_SDK_GUIDE.md) | [中文](../zh/007-CLIENT_SDK_GUIDE.md)
