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
- **environment**: a host composition-root dependency object. It carries behavior traits such as `BaseTransportTrait`, `TimeTrait`, a required root `SpanTrait`, a required `TracingTrait`, optional `IdleCallbackTrait`, `StorageTrait`, `RouterTrait`, `PageLifecycleTrait`, and `PopupTrait`. Core client constructor dependencies are also an environment; they are not a separate runtime object.
- **capability / trait**: the narrowest behavior contract a helper needs from an environment or host adapter, such as `RouterTrait` for auth navigation. Raw host objects such as `window`, `document`, `location`, and `history` are adapter inputs, not core environment fields.
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

`@securitydept/client` exposes the foundation event-stream traits and operator facade used by token-set lifecycle telemetry. Family packages should emit SecurityDept event traits as their public contract; RxJS is an implementation and interop detail, not the shape adapters must expose.

### Transport

Transport is layered explicitly. Foundation environments carry `BaseTransportTrait`; protocol/bootstrap consumers may derive `ExternalTransportTrait` from a base transport, and higher-level resource traffic may derive `ManagedTransportTrait` through wrappers such as `createAuthorizedTransportFromBase(...)`. The std fetch adapter is `createBaseTransportForStdFetch(...)`, and host creators should rely on foundation transport resolution instead of each creating their own fetch transport.

### Persistence

`@securitydept/client` owns `StorageTrait` semantics, including single-consume callback state through `take()`. `@securitydept/client/persistence/web` owns browser persistence adapters.

### Auth Coordination

`@securitydept/client` owns planner-host and requirement orchestration primitives. They are headless: they may decide required actions, but they do not own chooser UI, route copy, or product flow semantics.

### Configuration

Read configuration in three layers:

1. foundation environments/capabilities
2. auth-context config
3. adapter/host registration glue

Do not flatten these into one global config DSL for the current baseline.

### Scheduling and Unified Input Sources

Scheduling, cancellation, abort interop, storage, page lifecycle, and promise/signal helpers live in foundation and web subpaths. Browser lifecycle behavior is exposed as explicit EventStream sources that consume host-provided capabilities; SDK helpers must not discover `window` or `document` implicitly.

### Unified Dependency Injection

`@securitydept/client` is now the framework-neutral DI authority. `SecuritydeptInjectorTrait` is the minimal read-side contract and only expresses `get()`; consumers, React Context, and third-party injector adapters work against that duck type. `SecuritydeptInjector` is the SDK runtime/facade that owns `resolveAndCreate()`, `fromParentInjector()`, explicit provider resolution, parent inheritance, overrides, and side-effect-free `has()` diagnostics.

React is allowed exactly one SDK Context, all in `@securitydept/client-react`: `SecuritydeptContext`, `SecuritydeptProvider`, and `useSecuritydeptContext()`. Domain React packages no longer create their own public Context/Provider/`useXxxContext()` surface. They export injection tokens, provider factories, and explicit callback/component bridges. React reads synchronous signals through `useSignal()`, Resource snapshots through `useResourceSnapshot()`, and other observable/event sources through `useInteropObservable()` and `useEventStream()`.

Angular DI remains an adapter concern. Framework-neutral host capability resolution remains a foundation concern. Core clients still consume `FoundationEnvironment`; non-client-bound helpers still consume explicit typed environment objects or narrower capability views created by the host composition root.

The canonical foundation model is:

- `FoundationEnvironment` is the flattened foundation client dependency environment. It directly carries `transport`, `time`, a required root `span`, required `tracing`, required `realmStorage`, and optional `idleCallback`, `persistentStorage`, `sessionStorage`, `router`, `pageLifecycle`, and `popup`. `realmStorage` is a synchronous `SyncStorageTrait` scoped to that environment's JavaScript realm: `createFoundationEnvironment()` creates a fresh isolated in-memory store unless the composition root supplies an override. Historical `ClientRuntime` naming is retired and not canonical vocabulary.
- `StorageTrait` operations may complete synchronously or return a Promise, while `SyncStorageTrait` narrows all operations to synchronous results and therefore remains structurally assignable to `StorageTrait`. A storage adapter may expose `storageEvent` for logical-key mutation notifications; `StorageChangeEvent.origin` distinguishes same-context `local` mutations from cross-context `external` mutations, while host adapters own native event filtering and key-prefix normalization.
- `NativeWebEnvironment` is the canonical browser page environment. It extends the foundation environment with host-owned page capabilities such as `router`, `PageLifecycleTrait`, and `PopupTrait`; it does not expose `window.location` or `window.history`, and it no longer mirrors router methods at the top level.
- `WebExtCoreEnvironment` is the shared extension-core environment above the foundation layer. `WebExtBackgroundEnvironment` is the background-script specialization, and `WebExtPageEnvironment` combines extension-core capabilities with `NativeWebEnvironment`.
- `ServiceWorkerEnvironment` is the service-worker specialization above the foundation layer.
- Helpers should request the narrowest behavior trait they need, for example `RouterTrait`, `PopupTrait`, or `Pick<FoundationEnvironment, "transport" | "sessionStorage">`, rather than accepting the full environment by default.
- `environment.runtime` and historical runtime/derive helper names are retired naming artifacts. New public API and documentation must use Environment names such as `FoundationEnvironment`, `createFoundationEnvironment()`, or direct structural `FoundationEnvironment` / `NativeWebEnvironment` passing.
- Public option keys that carry environment-like dependency sources should stay named `environment`; the required capability is expressed by the type, not by introducing parallel keys such as `pageEnvironment`.

Conceptual split:

| Concept | Owns | Does not own | Naming |
|---|---|---|---|
| Environment | host dependencies and capabilities | business lifecycle state machine | `FoundationEnvironment`, `NativeWebEnvironment`, `WebExtCoreEnvironment` |
| Trait | minimal behavior dependency view | unrelated host dependencies | `RouterTrait`, `StorageTrait`, `PopupTrait` |
| Client | protocol/domain operations | framework lifecycle or DI | `SessionContextClient`, `BackendOidcModeClient` |
| Registry | multi-client registration/readiness/discrimination | UI policy or framework state | `TokenSetClientRegistry`, `TokenSetClientRegistryService` |
| Callback handler | client-owned callback input, execution, cancellation, and Resource state | registry selection or framework rendering | `client.callback` |
| Service | framework/host facade over clients | duplicated core state semantics | `SessionContextService` |

Do not model these objects as a DI container, service locator, provider tree, global singleton, or business config DSL. Auth-context configuration such as base URLs, source keys, account binding, and product routes remains in family config or host code, not in the foundation environment.

### Foundation Web environment factories

Foundation Web environment factories are explicit composition helpers, not automatic host detection:

| Factory | Returns | Page capabilities | Default Web storage | Intended host |
|---|---|---:|---:|---|
| `createEnvironmentForNativeWeb({ location, history, ...options })` | `NativeWebEnvironment` | host adapter only | yes | real browser page, tab, or popup document |
| `createEnvironmentForWebExtBackgroundScript(options)` | `WebExtBackgroundEnvironment` | no | extension storage when supplied | extension background scripts |

Do not use a string-driven `createEnvironmentFromPreset(name)`, preset-only wrapper factories, or global-shape detection to guess the host. Core clients never read `window`, `document`, `location`, or `history`; only explicitly named host adapters such as `createRouterForNativeWeb()`, `createPageLifecycleForNativeWeb()`, `createPopupForNativeWeb()`, and `createEnvironmentForNativeWeb()` may read native globals when the caller does not provide the host objects. `NativeWeb` means a normal browser page host with native navigation/location/history capabilities; worker-like hosts should use `createFoundationEnvironment()` or a more specific host factory.

When a host needs environment capabilities across routes, commands, or framework adapters, create one explicit environment at the composition root and pass that object through the framework bridge. In React, use `createEnvironmentForReact()` as the framework composition layer over a host creator such as `createEnvironmentForNativeWeb()`. It constructs the final injector outside the React Fiber tree and provides the insertion point for React-owned services. Pass the ready-made injector to the root `SecuritydeptProvider`, then read it with `useSecuritydeptContext().get(ENVIRONMENT_TOKEN)`. `SecuritydeptProvider` does not create injectors or own a destroy lifecycle. In Angular, use `provideEnvironment()` to construct and provide the environment through Angular DI. `NativeWebEnvironment` structurally covers the foundation `FoundationEnvironment`, and `WebExtUIEnvironment` structurally combines WebExt core plus native-web page capabilities.

This rule applies beyond `@securitydept/client`: context packages and framework adapters must use the same boundary for public helpers. Any helper that reads host globals, performs page navigation, constructs a client, or owns transport/store/time wiring should accept an environment or a narrow capability view. Provider, DI, and top-level adapter registration APIs may accept a full environment as composition roots; ordinary hooks, guards, interceptors, services, and convenience helpers should not each redeclare the full dependency bag.

## Context Client Design

### `basic-auth-context-client`

Stable root surface for basic-auth boundary helpers. The `/web` and `/server` entries provide thin host helpers, and React/Angular adapters remain host wrappers.

### `session-context-client`

Stable root surface for session login URL, post-auth redirect, user-info, logout, and browser-shell convenience. `SessionContextController` is the framework-neutral state owner for user-info refresh, logout cleanup, and redirect helpers. Framework adapters consume this controller through hooks, DI, signals, or observables rather than duplicating session semantics.

### `token-set-context-client`

Provisional token-set family for browser-owned OIDC/token material flows. It owns `backend-oidc-mode`, `frontend-oidc-mode`, `orchestration`, `access-token-substrate`, and `registry` entries. Each OIDC mode client owns callback state and router-input extraction; the registry only resolves the matching client. Framework adapters bridge those contracts instead of becoming callback state machines.

## SSR / Server-Side Support

### `basic-auth-context` and `session-context`

Server-host adopters should use the dedicated `/server` helper entries for host-neutral request/response coordination.

### `token-set-context`

Server-side token ownership, BFF, and mixed-custody remain outside the current `0.3.x` SDK baseline. The current SDK baseline is browser-owned token-set.

## Error Model

Public asynchronous flows use `ClientError` as the canonical runtime exception. Callers should branch on `kind`, domain-namespaced `code`, and `recovery`; `cause` is diagnostic only. Unknown failures are normalized with `ClientError.fromUnknown(...)` at client operation boundaries, while existing `ClientError` values remain unchanged.

User-facing copy must come from explicit safe `presentation`, a domain code presentation map, or generic foundation kind copy. `readErrorPresentationDescriptor()` never displays runtime `Error.message`. Events and tracing use the message-free `ErrorSummary`; Resource snapshots may retain the original error object. Host copy and UI state remain adopter-owned.

## Cancellation and Disposal

`@securitydept/client` owns the WHATWG-aligned AbortSignal event bridge and foundation-to-AbortSignal bridge, while `@securitydept/client/web` keeps the native-web `AbortSignal -> CancellationTokenTrait` convenience bridge. Long-lived hosts should wire cancellation and disposal explicitly.

## Logging, Tracing, and Testing

`@securitydept/client` owns the minimal tracing runtime, event, and subscriber primitives used by SDK flows. `@securitydept/test-utils` remains experimental and is not a current beta npm publish target.

Span correlation and operation lifecycle use different contracts:

- `SpanTrait` is an explicit correlation/context node. It owns identity, parent linkage, readonly attributes, and `fork()`. It is not a tracing backend and does not expose a public `end()` contract, because current JavaScript/TypeScript cannot guarantee deterministic caller-side disposal.
- `TracingTrait` is the canonical tracing runtime contract. It owns `record(event)` plus a hot, non-replay `events` stream that downstream subscribers consume.
- `OperationSpanTrait extends SpanTrait` and is the canonical operation-lifecycle primitive. `runOperation(...)` forks one child span, passes that operation span to `execute(span)`, and uses that same span for structured lifecycle correlation.
- `TracingEvent` carries `name`, `at`, `span`, `level`, `target`, and optional `fields`. SDK lifecycle events correlate through `event.span.id` / `event.span.parent?.id`; the SDK no longer snapshots `operationId`, `spanId`, or `parentSpanId` onto the event shape.
- `TracingSubscriberTrait` is a pure sink with `record(event)`. Console/timeline/test collectors live at this layer and can be attached through `createTracing({ subscribers })`.
- `runOperation({ environment, span, name, target, fields, execute })` is the canonical structured lifecycle helper for `operation.started` / `operation.error` / `operation.ended` emission. It combines `time`, `tracing`, and an explicit parent span in one explicit call shape, but it is not itself a foundation host capability.
- `defineInstrumentMethodDecorator(...)` is the stage-3 class-method decorator ergonomics over the same helper. It does not introduce a second tracing model, and adopters do not need decorators to use the tracing baseline.
- Span propagation follows an explicit ownership model: environments hold root spans, registries/clients/methods fork child spans as needed, and SDK code does not depend on ambient current-span state, ambient current-operation state, or `runWithSpan()`-style implicit context.

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
| `@securitydept/client/persistence/web` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/web` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/basic-auth-context-client` | `stable` | `basic-auth-context` | `stable-deprecation-first` |
| `@securitydept/basic-auth-context-client-react` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/session-context-client` | `stable` | `session-context` | `stable-deprecation-first` |
| `@securitydept/session-context-client-react` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/backend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/orchestration` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/access-token-substrate` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/registry` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/test-utils` | `experimental` | `foundation` | `experimental-fast-break` |
| `@securitydept/basic-auth-context-client-angular` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-angular` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react/tanstack-router` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-angular` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/client-react` | `provisional` | `shared-framework` | `provisional-migration-required` |
| `@securitydept/client-react/tanstack-router` | `provisional` | `shared-framework` | `provisional-migration-required` |
| `@securitydept/client-angular` | `provisional` | `shared-framework` | `provisional-migration-required` |

#### How To Read `token-set-context-client` Subpaths

- `/backend-oidc-mode`: platform-neutral client/service/token-material entry plus browser login and popup callback relay helpers.
- `/frontend-oidc-mode`: frontend OIDC client mode and environment-backed config projection resolution.
- `/orchestration`: protocol-agnostic token lifecycle and route requirement primitives.
- `/access-token-substrate`: access-token propagation vocabulary and substrate contract.
- `/registry`: shared multi-client lifecycle core.

#### Capability Boundary Rules

- Framework router glue belongs to shared framework adapters.
- Browser token-lifecycle glue belongs to the token-set family.
- App-local business API wrappers are not SDK public surface.
- Reference apps prove real usage patterns; they do not define package ownership by themselves.

#### token-set-context-client Frontend Subpath / Abstraction Split

Frontend adopters should reason in layers: foundation coordination, token-set mode/substrate/registry, then framework adapter. The token-set family is not the sole owner of every frontend helper.

#### Config Projection Source Contract (`frontend-oidc-mode/config-source.ts`)

`frontend-oidc-mode` owns ordered config projection resolution across inline, realm, persisted, and network sources. `resolveFrontendOidcModeConfigProjection()` accepts a root `FoundationEnvironment`, validates every source through the same projection schema, reads transport/storage/time capabilities from that environment, and returns the resolved projection plus client config. Realm injection is explicit through `injectConfigProjectionIntoRealm()`; no browser materializer or mode-specific web environment exists. The host owns its single environment, source descriptors, endpoint URL, redirect URI, and client construction.

Frontend OIDC flow state has an explicit storage scope selected at the flow entry. Redirect authorization, automatic callback restore, and public `handleCallback()` use the optional `sessionStorage`; popup authorization and its relay callback use the required per-environment `realmStorage`. Pending and consumed-state records always use the same selected store pair. The client never probes or falls back between realm and session storage, so a broken session store cannot affect popup login and a broken realm override cannot silently switch to session storage.

#### Reference-App Baseline (`apps/webui` / `apps/server`)

`apps/webui` and `apps/server` define the current in-repo baseline: backend-mode and frontend-mode host splits, keyed callback/readiness, React Query token-set management flows, route security, dashboard bearer access, browser E2E coverage, and shared error/diagnosis consumption.

The reference app should prove canonical SDK usage directly. `apps/webui` now reads SDK dependencies through `useSecuritydeptContext().get(TOKEN)`, `useSignal(...)` / `useResourceSnapshot(...)`, and explicit assertion/helpers local to each feature instead of hiding those reads behind a shared app-local facade.

### Framework Router Adapters

Framework router adapters are owned by:

- `@securitydept/client-react/tanstack-router`
- `@securitydept/client-angular`

Canonical semantics: full matched-route chain aggregation, `inherit` / `merge` / `replace`, child-route serializable metadata, root-level runtime policy, and no product chooser UI in the SDK.

For Angular, `@securitydept/client-angular` owns the token-set-agnostic base layer built on `RequirementPlannerHost` / `RouteCompositionRequirementPlanner`: declare child requirements with `secureRoute()`, assemble the root with `secureRouteRoot()` (which attaches `createAngularCanActivate` / `createAngularCanActivateChild`), project route metadata with `projectAngularRouteSegments()`, and wire the planner host through the `REQUIREMENT_PLANNER_HOST` DI token via `provideRequirementPlannerHost()`. `@securitydept/token-set-context-client-angular` layers the registry-backed specialization on top: `provideTokenSetRequirementPlannerHost()` binds the token-set behaviour, `createTokenSetCanActivate()` / `createTokenSetCanActivateChild()` wrap the base guards, and `secureTokenSetRoute()` / `secureTokenSetRouteRoot()` provide explicitly named token-set route builders before delegating to the base builders.

Angular token-set route security uses `secureTokenSetRouteRoot()` with registry requirements whose `attributes.query` selects clients (for example `{ clientKey: "main" }` or `{ requirementKind: "frontend_oidc" }`). When a guard rejects navigation, the registry behaviour's default `onUnauthenticated` handler starts OIDC redirect login for the first unauthenticated client and records `planContext.routeState.url` as `postAuthRedirectUri`. Override redirect policy only when needed via `secureTokenSetRouteRoot({ onClientUnauthenticated: ... })` or `provideTokenSetRequirementPlannerHost({ onClientUnauthenticated: ... })`. The shared contract is `BaseOidcModeClient.loginWithRedirect(options)` plus `TokenSetOidcRedirectLoginOptions` from `@securitydept/token-set-context-client/registry`. Do not read Angular `Router.url` for the post-auth target inside a guard handler, because the attempted navigation has not been committed yet. A handler that has started a full-page external redirect should not resolve to `false`; the default registry handler returns a never-settling guard result after starting the redirect so Angular does not finalize an in-app navigation cancel while the page is leaving.

TanStack Router uses `secureRoute()` for serializable `staticData` and `secureRouteRoot()` for root `beforeLoad` composition. Runtime behaviour is supplied through core `RequirementPlannerHost` / `REQUIREMENT_PLANNER_HOST`; route context includes `planContext.routeState.url`, which should be used as the attempted navigation URL when starting full-page auth redirects. Do not infer the target page from `window.location`; while `beforeLoad` is running, the current document URL may still be the previously committed route.

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

#### 2. Browser entry: backend OIDC client

Use `BackendOidcModeClient`, `relayTokenSetPopupCallbackFromEnvironment`, and `TokenSetPopupRelayErrorCode` from `@securitydept/token-set-context-client/backend-oidc-mode` with a host-owned `FoundationEnvironment` or `NativeWebEnvironment`.

This subpath is browser-host glue, not a promise that every Web-like runtime has page navigation. Use the foundation environment boundary before choosing helpers:

- Browser client construction should use `new BackendOidcModeClient(config, environment)`, where `environment` is created by the host through `createFoundationEnvironment(...)`, `createEnvironmentForNativeWeb(...)`, or another explicit host creator. Do not pass transport, time, persistent store, and session store independently to every helper.
- Worker-like hosts, service workers, and extension backgrounds may create/restore clients and run token-state APIs, but they must not run page callback capture by default.
- Page-only helpers may read `window.location` / `window.history` only through `NativeWebEnvironment`; return URL construction should stay explicit at the app boundary, for example `client.authorizeUrl(environment.router.currentUrl()?.toString())` or `client.loginWithRedirect({ postAuthRedirectUri })`. Callback pages use the mode-owned `takeFrontendOidcCallbackInputFromRouter(router)` or `takeBackendOidcCallbackInputFromRouter(router)` helper before passing the returned input to `client.handleCallback(...)`. Both helpers perform callback cleanup through `RouterTrait`; the frontend helper preserves non-OIDC query parameters and the backend helper preserves existing hash-router blocks. For token-set OIDC login, the shared browser entries are `loginWithRedirect({ postAuthRedirectUri })` and `loginWithPopup({ popupCallbackUrl })` on `BaseOidcModeClient`; `FrontendOidcModeClient.loginWithRedirect()` additionally accepts a per-request `redirectUri`, which must be included in its configured callback resolver candidates. The client itself must carry its page router / popup capability through its environment. `FrontendOidcModeClient` and `BackendOidcModeClient` implement those methods directly. `relayTokenSetPopupCallbackFromEnvironment()` remains a page-only helper and requires an explicit `environment` argument.
- Backend OIDC does not maintain a hidden callback-fragment store. Retry or delayed callback processing is an application-level policy and requires the application to retain the callback input before consuming it from the router. Helpers must fail fast when a required capability is missing instead of falling through to `window is not defined` or stale URL parsing.

Recommended host environments:

| Host | Environment | Callback capture | Restore/token state | Storage defaults |
|---|---|---:|---:|---|
| browser page/tab/popup | `NativeWebEnvironment` | yes | yes | page storage may be used |
| browser worker | `FoundationEnvironment` | no by default | yes | explicit store only |
| service worker | `ServiceWorkerEnvironment` | no by default | yes | explicit store only |
| extension background | `WebExtBackgroundEnvironment` | no by default | yes | explicit store only |

Do not decide whether callback bootstrap is allowed by checking `globalThis.location`. A service worker or extension background may expose a location-like object without page history semantics. Page detection must validate page/document capabilities such as `window.location` and `window.history.replaceState`.

The same page-boundary rule applies to basic-auth and session `/web` redirect helpers: redirect helpers that read or write `window.location` are page helpers. Worker-like hosts must pass explicit URL/navigation capabilities or keep redirect initiation in a real page context.

#### 3. React entry: one SDK context plus injector factories

Use:

- `@securitydept/client-react`
- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

React composition still follows the three-layer model: auth-context config, injector providers/factories, and host registration glue.

- `@securitydept/client-react` owns `createEnvironmentForReact()`, the only SDK React Context (`SecuritydeptContext`, `SecuritydeptProvider`, and `useSecuritydeptContext()`), and the context-free bridges `useSignal()`, `useResourceSnapshot()`, `useInteropObservable()`, and `useEventStream()`.
- React constructs the final injector outside the Fiber tree and passes it through `SecuritydeptProvider.injector`; concrete router adapters such as `@securitydept/client-react/tanstack-router` own route-scoped auth coordination.
- `@securitydept/basic-auth-context-client-react` exports `BASIC_AUTH_CONTEXT_CLIENT`, `BASIC_AUTH_CONTEXT_CLIENT_CONFIG`, `BasicAuthContextService`, and `provideBasicAuthContext({ config })`. React code reads the client through `useSecuritydeptContext().get(BASIC_AUTH_CONTEXT_CLIENT)`.
- `@securitydept/session-context-client-react` exports `SESSION_CONTEXT_CLIENT`, `SESSION_CONTEXT_CLIENT_CONFIG`, `SessionContextService`, and `provideSessionContext({ config })`. React code reads the client through `useSecuritydeptContext().get(SESSION_CONTEXT_CLIENT)` and reads its `sessionResource` through `useResourceSnapshot()`.
- `@securitydept/token-set-context-client-react` exports `provideTokenSetClientRegistry()`, `TOKEN_SET_CLIENT_REGISTRY`, `TokenSetClientRegistryService`, and headless callback hooks. The canonical keyed auth-state path is `const registry = useSecuritydeptContext().get(TOKEN_SET_CLIENT_REGISTRY)`, followed by `useResourceSnapshot(registry.clientResourceFor("main"))`, and then `useResourceSnapshot(client.authResource)` after the client snapshot resolves.
- Frontend and backend callbacks use `useTokenSetFrontendCallback({ clientQuery })` and `useTokenSetBackendCallback({ clientQuery })`. The optional synchronous `clientQuery({ callbackUrl })` creates a registry query or returns `null` when the callback is not applicable; it does not consume callback input. The hooks keep callback state idle during SSR and the hydration render, then initialize the selected record after the client commit and flatten registry readiness with the selected client's `callback` Resource. Callback input resolution and cleanup remain client-owned during `start()`, before persistence restore. Default resolvers accept an asynchronous `callbackInputPredicate` that runs before the canonical `take...FromRouter()` cleanup; returning `false` leaves the URL untouched. Backend registry selection defaults to the compat-fragment `callback_routing_key`, while `createBackendOidcModeClientFactory()` defaults the client routing key to `meta.clientKey`. Frontend selection defaults to entry metadata `callbackUrl` candidates, and `createFrontendOidcModeClientFactory()` uses those candidates when no explicit resolver is supplied. Registry queries and input predicates are independent extension points. Registry factories receive `{ environment, meta, cancellationToken }`; neither framework adapter calls `client.start()` directly. After callback determination succeeds, in-memory auth and callback Resources are committed independently of best-effort persistence synchronization; a storage write failure is traced but does not turn the login into a failure.

#### 4. Angular entry: thin DI wrappers preserve canonical owner boundaries

Use:

- `@securitydept/basic-auth-context-client-angular`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client-angular`

Layering rules:

- `provideBasicAuthContext({ config })`: auth-context config only.
- `provideEnvironment({ environment })`: canonical Angular DI bridge for environment capability injection. Context-client Angular providers read this token instead of accepting an `environment` option themselves.
- `provideSessionContext({ config })`: adapter leaf over `SessionContextClient`. Use `config.autoStart` when service construction should immediately start the client.
- `SessionContextService`: signal / observable facade over the controller. Low-level auth-context behavior remains on `SessionContextService.client`.
- `provideTokenSetClientRegistry({ clients })`: Angular host registration over core `TokenSetClientRegistryEntry<BaseOidcModeClient>` values; each client entry still owns auth-context config and environment composition.
- `TokenSetFrontendCallbackComponent` and `TokenSetBackendCallbackComponent` bridge registry/client callback Resources into Angular signals. They remain idle during server rendering and use Angular's browser-only `afterNextRender()` phase to initialize the selected record, so callback input is never consumed while producing SSR output. They do not parse callback input or own a second callback state machine.
- `provideTokenSetClientRegistryAuthorizationInterceptor(options?)` / `createTokenSetClientRegistryAuthorizationInterceptor(options?)`: request authorization using the SDK options-object API form. The functional interceptor defaults to injecting `TokenSetClientRegistryService`; `authorizationForRequest` can be passed explicitly or provided with `TOKEN_SET_CLIENT_REGISTRY_AUTHORIZATION_FOR_REQUEST`. The default `authorizationForRequest(registry, request)` selects a registered client by request URL, initializes that client, and waits for its `authorizationHeaderValue` replay signal before adding `Authorization`. It does not trigger refresh or auth checks; client `start()`, refresh timers, page-resume auth-check triggers, or explicit `authCheck()` own maintenance. Requests whose URL does not match a registered client receive no `Authorization` header.

Freshness is owned by the token-set core, not by one framework adapter. Consumer code reads replay channels: first-screen readiness uses `authDetermined`, stable UI uses `authSnapshot`, route guards use `isAuthenticated`, and transports/interceptors use `authorizationHeaderValue`. `authCheck(options?)` is the only explicit maintenance command and should be reserved for advanced callers that intentionally trigger one serialized check. Event payloads must not contain raw access, refresh, or ID token values. Header availability does not have a separate event/status lifecycle: usable bearer projection is part of the authenticated snapshot, while missing bearer material remains unauthenticated or an undefined header projection. Mode clients do not expose synchronous bearer convenience APIs, and registry token sugar is not part of the public model. Use `registry.whenReady(key?)` or `registry.clientSignalFor(key?)` to acquire a started client, then consume that client's replay signals.

Browser-owned frontend/backend OIDC factories configure page-resume auth-check through the client runtime option `authCheck.triggerSources.pageResume`. The bundled source only consumes the host-owned `PageLifecycleTrait.resume` event stream; it never accepts or discovers raw `document` or `window` targets in token-set orchestration. Angular registry entries no longer patch clients with page-resume triggers during materialization: Angular hosts should construct the client with the desired `authCheck.triggerSources` configuration from `clientFactory({ environment, meta, cancellationToken })`. On `visibilitychange` back to visible, `pageshow`, `focus`, and `online`, the page source emits a pure EventStream auth-check trigger. The client-owned dispatcher submits trigger events into the serialized auth-check runner; restore and explicit `authCheck()` use command gateways for their promise-returning semantics, while the refresh timer is another trigger source derived from `authSnapshot`. A completed check projects its outcome through the typed terminal auth events (`auth.authenticated` / `auth.unauthenticated`); the triggering reason (such as page resume) lives in local orchestration trace attributes rather than a payload field on the auth event. This is a recovery barrier, not an interactive login trigger: refresh failures clear or preserve auth state through the normal token-set client paths, and route/request handlers decide whether to start login.

Short access-token lifetimes should be handled by the running client state machine: persisted restore performs the initial auth check, refresh timers schedule later checks, and browser resume emits auth-check triggers after hidden tabs, system sleep, or bfcache return. Angular route aggregation waits for pending initial auth determination, then reads `isAuthenticated`; protected requests wait for `authorizationHeaderValue`. When `frontend-oidc-mode` or another token-set mode can stamp `accessTokenIssuedAt`, token freshness caps refresh-window and clock-skew calculations relative to the token lifetime instead of applying a raw fixed window to every token. That keeps newly issued short-lived tokens fresh at issuance while still entering `refresh_due` early enough for restore, resume, and scheduled maintenance. TanStack Router hosts should use `createTokenSetSecureBeforeLoad()` from `@securitydept/token-set-context-client-react/tanstack-router`; non-framework browser hosts should compose the shared guarded-router primitives with the selected token-set client's `isAuthenticated` replay signal before redirect/block fallback.

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

#### 5. SSR / server-host entry: environment host adapters

Use foundation host adapters from `@securitydept/client`, then pass the resulting environment into context clients.

- `@securitydept/client/server`
- `createEnvironmentFor{Host}` helpers owned by concrete host/framework adapters

Context packages do not own dedicated `/web` or `/server` subpaths. Host capability resolution belongs to the client foundation package and framework adapters.

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
| `@securitydept/client/web` / `@securitydept/client/server` | foundation-owned host environment adapters established |
| `*-react` / `*-angular` adapter family | provisional; real reference-app/downstream proof exists, broad host matrix does not |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | provisional; keyed pending-state and single-consume callback semantics formalized |

## Shared Client Lifecycle Contract

**Subpath**: `@securitydept/token-set-context-client/registry`

The registry owns `register(entry)`, `unregister(key)`, `resetMaterialization(key)`, `dispose()`, `primary` / `lazy` initialization priority, `preload`, `whenReady`, `idleWarmup`, keyed lookup aligned with callback/readiness behavior, and the shared generic callback failure presenter `describeTokenSetCallbackError()`. React and Angular adapters consume this shared core, while mode-specific copy such as `describeFrontendOidcModeCallbackError()` stays under the mode owner and must be injected explicitly.

The contract now treats `registered` and `ready` as distinct observability surfaces. Use `has()`, `registeredKeys()`, `registeredEntriesSnapshot()`, and `registeredMetaSnapshot()` to inspect configured clients, and `readyKeys()` to inspect clients whose materialization and `start()` lifecycle have completed. Removal and rematerialization now use the canonical verbs `unregister(key)` and `resetMaterialization(key)` directly.

The core client registry is the reactive topology/readiness authority. Observe it through `entries: ReadableSignalTrait<readonly TokenSetClientRecordView<TClient>[]>` and use `clientRecordFor*` / `clientSignalFor*` for keyed or query-based acquisition. `clientSignalFor(key, { initialize })` and `clientSignalForQuery(query, { initialize })` are the canonical reactive client acquisition APIs and trigger lazy materialization by default. `initialize(key)` is an action-completion handle that resolves to `TokenSetClientReadyRecordView<TClient>`, not the canonical observation path.

Per-client token-set auth material is owned by the mode client itself. Every registry-managed OIDC mode client exposes separate auth channels: replay signals for `authDetermined` (first determination), `authSnapshot` (last determined snapshot or `null`), `isAuthenticated` (guard truth), and `authorizationHeaderValue` (bearer projection); plain signals for `lastAuthError` (latest determination/operation error register) and `authOperations.*Pending` (local operation locks). `authSnapshot` is the authoritative auth-material replay source; `authDetermined`, `isAuthenticated`, and `authorizationHeaderValue` are derived replay projections rather than manually synchronized state. Directly created clients start only after `start()` unless `autoStart: true` is explicitly passed. Registry-managed clients never use entry-level `autoStart` or `autoRestore`; registry readiness means the client has been materialized and `start()` has completed. The default `createTokenSetOidcAuthRegistry()` materializes the client itself, so React Query readiness and Angular registry lookups return clients rather than per-client service wrappers. `authEvents` remains auth-domain telemetry only; registry topology and readiness changes are observed through registry `state`.

The canonical RxJS bridge now lives at `@securitydept/client/rx`. Use `toRxObservable(source)` for either `EventStreamTrait` or `ReadableSignalTrait`, and `fromRxObservable(observable)` for the reverse bridge. Angular adapters should use `toNgSignal(source)` from `@securitydept/client-angular` when they need Angular-native signals.

## Examples and Reference Implementations

### Primary Real Reference Apps

- `apps/server`: auth, propagation, route composition, server error/diagnosis proof.
- `apps/webui`: React/browser/multi-context auth shell, token-set reference page, dashboard, browser E2E coverage, and SDK dogfooding coverage.

### Downstream Reference Case: Outposts

`~/workspace/outposts` validates the real Angular adopter path. It uses `provideTokenSetClientRegistry(...)` plus `provideTokenSetClientRegistryAuthorizationInterceptor()`, proving URL-prefix bounded authorization injection against a downstream `confluence` backend. The path also calibrates stale-token handling: the SDK must refresh or clear before the first protected Confluence request instead of sending an expired bearer that the backend correctly rejects with `ExpiredSignature`. Its app-local auth service remains adopter glue, not an SDK API template.

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
