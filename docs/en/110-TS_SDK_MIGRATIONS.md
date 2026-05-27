# TypeScript SDK Migration Guide

This document is the human-readable companion to `sdks/ts/public-surface-inventory.json`. It records the current migration rules and the active adopter-facing migration notes without using implementation chronology as the stable documentation structure.

## 0.x Contract Change Policy

The SDK is still in `0.x`, but public-surface changes must remain deliberate.

| Stability | Change Discipline | Meaning |
| --- | --- | --- |
| `stable` | `stable-deprecation-first` | Breaking changes require a deprecation period. Keep the deprecated API functional for at least one minor release and document the migration here. |
| `provisional` | `provisional-migration-required` | Breaking changes are allowed, but the migration path and justification must be documented. |
| `experimental` | `experimental-fast-break` | Breaking changes are expected. A short note is useful but not a release gate. |

Rules:

- `public-surface-inventory.json` is the machine-readable authority for package/subpath stability and evidence.
- This document is the adopter-readable migration companion.
- Non-experimental breaking changes must update both the inventory and this guide.
- Additive changes can be documented here when adopters need to opt into safer behavior.

## Current Migration Notes

### Token-set Auth Event Payload Map

Packages:

- `@securitydept/token-set-context-client/orchestration`

Change:

- The loose `TokenSetAuthEventPayload` bag is replaced by a per-event-type `TokenSetAuthEventPayloadMap`. `TokenSetAuthEvent<TType>` is now `RuntimeEventEnvelope<TType, TokenSetAuthEventPayloadMap[TType]>`, and `createTokenSetAuthEvent()` is a generic factory whose `payload` is constrained by the event `type`.
- `freshness` and `hasRefreshMaterial` exist only on the refresh-specific payload (`AuthRefreshRequired` / `AuthRefreshStarted` / `AuthRefreshSucceeded` / `AuthRefreshFailed`). Terminal events (`AuthAuthenticated` / `AuthUnauthenticated` / `AuthMaterialCleared`) carry only the minimal identity payload.
- Client identity is expressed solely through the optional `id` field; there is no general loose-field bag.
- The `AuthCheck*` event family and the `TokenSetAuthFlowOutcome` / `TokenSetAuthFlowReason` / `authCheckReason` vocabulary are removed. Outcomes are expressed by the event type itself, and triggering reason context lives in local orchestration trace attributes rather than an event payload field.

Migration:

- Replace any read of `event.payload.outcome` / `event.payload.reason` / `event.payload.authCheckReason` with a check on `event.type` (for example `event.type === TokenSetAuthEventType.AuthAuthenticated`).
- Read `freshness` / `hasRefreshMaterial` only after narrowing to a refresh event type.
- Replace `event.payload.clientKey` / `event.payload.logicalClientId` with `event.payload.id`.

### Unified Injector And Single React Context

Packages:

- `@securitydept/client`
- `@securitydept/client-react`
- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

Change:

- `@securitydept/client` now owns the framework-neutral DI authority. `SecuritydeptInjectorTrait` is the minimal read-side contract and only expresses `get()`; `SecuritydeptInjector` is the SDK runtime/facade that owns provider resolution, parent inheritance, overrides, and `has()` diagnostics.
- React now has exactly one SDK Context: `SecuritydeptContext`, `SecuritydeptProvider`, and `useSecuritydeptContext()` in `@securitydept/client-react`.
- React domain packages no longer export `BasicAuthContextProvider`, `SessionContextProvider`, `BackendOidcModeContextProvider`, `TokenSetAuthProvider`, `useBasicAuthContext()`, `useSessionContext()`, `useBackendOidcModeContext()`, `useTokenSetAuthRegistry()`, and similar domain-specific Context / Provider / keyed state helpers.
- React domain packages now export injection tokens, provider factories, plain factories, and explicit callback/component bridges. State reading is unified around `useReadableSignal(...)`.

Migration:

- Wrap React subtrees with `SecuritydeptProvider`; pass a ready-made `injector`, or derive a child injector from `providers` / `parentInjector`.
- Replace `XxxContextProvider` / `useXxxContext()` with `useSecuritydeptContext().get(TOKEN)`.
- Replace `useTokenSetAuthState(key)` / `useTokenSetAccessToken(key)` / `useTokenSetAuthRegistryState()` with `const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY)` followed by `useReadableSignal(registry.clientSignalFor(key))`, then read the returned client's replay channels. For aggregate registry topology, use `useReadableSignal(registry.state)`.
- Replace basic-auth / session provider-first composition with `create*()` + `provide*()`. For token-set multi-client React composition, register `provideTokenSetAuthRegistry({ clients })` and add `provideTokenSetCallbackResumeController(registry)` only when the host explicitly needs callback resume wiring.

### Token-Set React Registry Composition

Package:

- `@securitydept/token-set-context-client-react`

Change:

- `createTokenSetAuthRuntime()` and `provideTokenSetAuthRuntime()` are removed.
- The React token-set adapter no longer blesses one fixed runtime bundle that couples registry ownership, callback resume controller ownership, idle warmup, and disposal.

Migration:

- For ordinary React hosts, register `provideTokenSetAuthRegistry({ clients })`.
- If the host needs callback resume, compose it explicitly with `provideTokenSetCallbackResumeController(registry)` after choosing how the registry instance should be owned.
- If the host needs manual readiness, manual disposal, or custom warmup policy, create and own the registry/controller directly instead of depending on an SDK-owned runtime object.

### Client Environment And Backend-OIDC Web Host Boundary

Packages:

- `@securitydept/client`
- `@securitydept/client/web`
- `@securitydept/token-set-context-client/backend-oidc-mode/web`

Change:

- Framework-neutral host capability resolution is now owned by the client foundation through typed `FoundationEnvironment`, `NativeWebEnvironment`, `WebExtCoreEnvironment`, and related host specializations.
- The historical `ClientRuntime` naming has been retired in favor of environment terminology. Core client constructor dependencies are environments, not a second runtime layer. Canonical access is `environment.transport`, `environment.sessionStorage`, and peers.
- Web host environment factories are explicit composition entry points. They are not automatic host detection and no longer expose preset-only worker/service-worker/extension-background wrappers.
- Context and adapter public helpers use the same boundary. Backend-OIDC web helpers, basic-auth/session redirect helpers, and framework adapter convenience helpers must not each redeclare or guess transport/store/time/page dependencies.
- Backend-OIDC web helpers are split by host boundary: page-only helpers use page-explicit names, while worker-safe helpers require host-injected environment/capabilities or restore-only behavior.

Migration:

- Create one environment at the host composition root and pass the environment object itself through providers/adapters. Do not teach adopters to read `environment.runtime`; update direct historical runtime/derive helper usage to `FoundationEnvironment`, `createFoundationEnvironment()`, `createEnvironmentForNativeWeb()`, or direct structural environment passing.
- Keep public option keys named `environment` even when the value is page-scoped or async-resolved. Do not introduce `pageEnvironment` as a parallel key; the type communicates the page requirement.
- Use `createEnvironmentForNativeWeb({ location, history, ...options })` for real page/tab/popup callback flows; page capabilities are explicit top-level host inputs and must come from the host composition root.
- Do not use `createEnvironmentForNativeWeb()` for worker-like hosts. Compose those with `createFoundationEnvironment()` or a more specific host factory, then inject persistence/session stores explicitly when needed.
- Do not call page callback bootstrap in service workers or extension backgrounds. Run restore/token-state APIs there, and run callback capture only in a real page/popup document or with explicit fake page/callback-fragment capabilities in tests.
- Update ambiguous page-global helper names to page-explicit forms where the public name changed, such as `currentPageLocationAsPostAuthRedirectUri()`, `buildAuthorizeUrlReturningToCurrentPage()`, `bootstrapBackendOidcModePageClient()`, and `captureBackendOidcModePageCallbackFragment()`.
- Treat existing redirect/popup helpers (`loginWithBackendOidcRedirect()`, `loginWithBackendOidcPopup()`, and `relayBackendOidcPopupCallback()`) as page-only helpers even though their historical names remain intact; pass an explicit `RouterTrait`/`PopupTrait` or a page-bearing `environment` when testing or running in a host wrapper. The canonical shared token-set OIDC browser contract is now `loginWithRedirect({ environment, postAuthRedirectUri })` on `OidcRedirectLoginClient`; backend web clients materialized through `createBackendOidcModeWebClient(...)` expose that method while `loginWithBackendOidcRedirect()` remains the compatibility/convenience wrapper. Popup login also requires an explicit callback-fragment capability, and browser-state reset requires an explicit `callbackFragmentStore`.
- For frontend-mode browser materialization, create `createFrontendOidcModeWebClientEnvironment(...)` at the host composition root and pass it to `createFrontendOidcModeBrowserClient({ environment, ... })`; the materializer no longer creates a default environment when `environment` is omitted.
- When browser/page environment ownership must stay stable across framework routes or commands, create one host-owned `NativeWebEnvironment` at the composition root and inject that object. Do not invent app-local module singletons or SDK-local lazy environment resolvers.
- Treat basic-auth/session `/web` redirect helpers as page navigation helpers; keep them in a real page context or inject an explicit `RouterTrait`.
- Let framework provider/DI registration functions own full environment composition. Do not make ordinary hooks, guards, interceptors, services, or convenience helpers each accept a full scattered dependency bag.
- Do not infer page capability from `globalThis.location`; core helpers consume behavior traits. Raw `window.location` and `window.history` only appear in explicit native-web adapter inputs.

Justification:

- Non-client-bound helpers had started to duplicate dependency bags and hidden `window.*` defaults. Typed client environments keep core dependency wiring explicit while giving helpers a shared, testable, host-scoped capability boundary.

### TimeTrait And EventStream Time Sources

Package:

- `@securitydept/client`

Change:

- `FoundationEnvironment` now carries one `time: TimeTrait` capability instead of separate `clock` and `scheduler` fields. Idle work is a separate optional `idleCallback: IdleCallbackTrait` capability.
- `createDefaultTimeConfig()` replaces `createDefaultClock()` and `createDefaultScheduler()`.
- `createDefaultIdleScheduler()` and registry `idleScheduler` wiring are removed. Registry idle warmup now runs only when the host provides `environment.idleCallback`.
- `timer()`, `interval()`, `scheduleAt()`, `fromTimeout()`, `fromInterval()`, `fromScheduleAt()`, `fromEventPattern()`, `fromSignal()`, and `fromPromise()` are removed from `@securitydept/client`.
- The SDK still exposes `EventStreamTrait` / `EventSubjectTrait` as its public reactive primitives, but generic source construction now belongs to direct RxJS usage plus the `@securitydept/client/rx` bridge and `createAsyncSchedulerWithTimestampProvider(...)` when host-owned `TimeTrait` must drive scheduling.

Migration:

- Replace `{ clock, scheduler }` environment wiring with `{ time }`; pass a host-owned `{ environment }` whose `environment.idleCallback` is set only when the host intentionally enables registry idle warmup. Tool-level idle revalidation helpers still consume explicit narrow capabilities.
- Registry-managed token-set entries now receive that same registry-owned environment as `clientFactory(environment)`. Build clients from this argument instead of reaching for module globals or passing scattered sub-capabilities.
- Replace direct callback timer handles with `timer(delayMs, createAsyncSchedulerWithTimestampProvider(time)).subscribe(...)`.
- Replace recurring callback scheduling with `interval(periodMs, createAsyncSchedulerWithTimestampProvider(time)).subscribe(...)`.
- Replace `fromEventPattern({ ..., callback })` style SDK helpers with direct `rxjs` sources such as `fromEventPattern(...)`, `from(Promise.resolve(...))`, or `new Observable(...)`, then bridge back to `EventStreamTrait` only when a SecurityDept trait boundary is required.
- Use `FakeTimeConfig` in tests when deterministic `now()`, timer queueing, flushing, and pending-count assertions are needed.

Justification:

- The former scheduler abstraction only wrapped host timers and did not model priority, execution context, queues, or RxJS-style scheduling. Treating timers as EventStream sources aligns refresh timers, page-resume triggers, and other input sources under one subscription model.

### Token-Set Event-Driven Auth Flow

Packages:

- `@securitydept/client`
- `@securitydept/token-set-context-client/orchestration`
- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-angular`
- `@securitydept/token-set-context-client-react`

Change:

- Token-set clients now expose replay channels as the canonical consumer API: `authDetermined`, `authSnapshot`, `isAuthenticated`, and `authorizationHeaderValue`.
- The old imperative helpers `ensureAuthForResource()`, `ensureFreshAuthState()`, `ensureAuthorizationHeader()`, and registry-level `ensureAccessToken()` / `ensureAuthorizationHeader()` / `ensureAuthForResource()` have been removed.
- `authCheck(options?)` remains as the single advanced maintenance entry for callers that explicitly want to trigger one serialized auth check; it is not the route guard, transport, interceptor, or UI read path.
- Auth lifecycle events do not expose raw access, refresh, or ID token values. Authorization-header availability is represented by the authenticated snapshot and header projection, not by separate header terminal events.

Migration:

- First-screen readiness should wait for `authDetermined.whenValue()`.
- Stable UI should read `authSnapshot`; route guards and router adapters should wait for `isAuthenticated.whenValue()`.
- HTTP transports and interceptors should wait for `authorizationHeaderValue.whenValue()` and treat `undefined` according to their `requireAuthorization` / fallback policy.
- Use `registry.whenReady(key?)` or `registry.clientSignalFor(key?)` to acquire a started client; do not add registry-level token sugar in host code.
- Subscribe to `authEvents` for lifecycle telemetry instead of inferring auth flow state from redirects, thrown errors, or raw token values.

Justification:

- Splitting consumer reads from explicit maintenance avoids route/interceptor side effects, makes lazy registry lifecycle explicit, and keeps UI slices independent instead of forcing every consumer through one composite imperative state machine.

### Angular Token-Set Bearer Interceptor: `strictUrlMatch`

Package: `@securitydept/token-set-context-client-angular`

Change:

- `provideTokenSetBearerInterceptor()` accepts `options?: BearerInterceptorOptions`.
- `createTokenSetBearerInterceptor(registry, options?)` accepts the same options object.
- `BearerInterceptorOptions.strictUrlMatch` controls whether unmatched URLs receive a single-client fallback token.

Migration:

```ts
provideTokenSetBearerInterceptor({ strictUrlMatch: true });
```

Use `strictUrlMatch: true` for Angular hosts with multiple backends, multiple audiences, or any third-party HTTP traffic. This prevents bearer injection when a request URL does not match any registered token-set client `urlPatterns`.

Single-backend hosts can keep the no-argument form if they intentionally rely on the convenience fallback.

### Shared Authenticated Principal

Packages:

- `@securitydept/client`
- `@securitydept/session-context-client`
- `@securitydept/token-set-context-client`

Change:

- `@securitydept/client` owns the shared `AuthenticatedPrincipal` contract.
- Session and token-set user-info projections align to that shared principal shape.
- Resource-token facts remain separate and are not aliases of authenticated human-principal data.

Migration:

- Prefer `normalizeAuthenticatedPrincipal()` or `normalizeAuthenticatedPrincipalWire()` for incoming principal data.
- Prefer `projectAuthenticatedPrincipal()` for host-facing current-user display data.
- Ensure session principal data includes a stable `subject`.
- Do not use resource-token facts as a human-principal substitute.

### Operation Tracing And Error Presentation

Package: `@securitydept/client`

Change:

- The shared client foundation owns operation correlation primitives and error-presentation reader helpers used by reference apps and adapters.
- Host UI should consume stable `code` / `recovery` data instead of parsing raw message text.

Migration:

- Use SDK helpers to read `ErrorPresentation`-compatible response data.
- Branch product recovery UI on `UserRecovery` values.
- Keep app-local copy, toast, and routing decisions in the host app.

### Token-Set React Query

Package: `@securitydept/token-set-context-client-react/react-query`

Change:

- React Query integration is a subpath of the React package, not a standalone package.
- The SDK-owned surface is limited to readiness queries, token-set-aware query-key namespacing, and invalidation glue.
- Resource domain models and groups/entries CRUD hooks remain app-local or adopter-local code.

Migration:

- Import React Query helpers from the `./react-query` subpath.
- Build app-specific resource hooks in the host app instead of expecting a token-set CRUD SDK surface.
- Keep TanStack Query as an optional peer dependency in hosts that import the subpath.
- Use SDK query-key prefixes and readiness helpers to compose host-owned query trees that should invalidate on token-set lifecycle changes.

### Framework Adapter Environment Boundaries

Packages:

- `@securitydept/client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

Change:

- `@securitydept/client-react` now owns the canonical React injector bridge: `SecuritydeptContext`, `SecuritydeptProvider`, and `useSecuritydeptContext()`, plus the context-free `useReadableSignal()` / `useEventStream()` bridge.
- `client-react` environment and planner-host helpers now export injection tokens and provider factories only, for example `CLIENT_ENVIRONMENT` + `provideClientEnvironment(environment)` and `AUTH_PLANNER_HOST` + `provideAuthPlannerHost()`.
- The basic-auth / session / token-set React adapters no longer own domain-specific Provider / Context hooks. They export tokens, plain factories, provider factories, and explicit callback/component bridges. Token-set multi-client composition is now explicit registry/controller wiring instead of an SDK-owned runtime bundle.
- Angular `createTokenSetOidcLoginRedirectHandler()` is now the route-login helper. It still uses `environment` as the only public key, but the value is now a stable native-web-environment source that Angular DI provides through `provideNativeWebEnvironment({ environment })` from `@securitydept/client-angular`. The helper targets the shared `OidcRedirectLoginClient` contract and awaits that source inside the guard flow before calling `loginWithRedirect()`.
- Angular `CallbackResumeService` and React `useTokenSetCallbackResume({ getCurrentUrl, describeError })` now bridge the shared `TokenSetCallbackResumeController` from `@securitydept/token-set-context-client/registry`. Angular `TokenSetCallbackComponent` remains page-only convenience over that service, with injectable current URL and host policy tokens.

Migration:

- Build browser environments at the framework composition root, then register those dependencies through `SecuritydeptProvider` plus provider factories.
- Opt session adapters into initial probing by explicitly creating `SessionContextController` and calling `controller.refresh()` from the host-owned lifecycle when needed.
- For React code that needs page environment capability, register the host-owned object with `provideClientEnvironment(environment)` and read it later through `useSecuritydeptContext().get(CLIENT_ENVIRONMENT)`.
- For Angular frontend-oidc route redirects, provide the host-owned native web environment object from the composition root with `provideNativeWebEnvironment({ environment })`.
- For Angular callback routes, override `TOKEN_SET_CALLBACK_CURRENT_URL` when `window.location.href` is not the right source of truth, and override `TOKEN_SET_CALLBACK_COMPONENT_OPTIONS` when the host needs non-default fallback navigation or centralized error logging.
- For custom callback orchestration, call `CallbackResumeService.resume(url)` or the React hook with explicit `controller` / `injector` / `getCurrentUrl` / `describeError` instead of reintroducing page-global fallback logic or mode-specific copy into ordinary helpers. `CallbackResumeService.handleCallback(url)` remains only a compatibility wrapper.

### Route Security And Matched Route Chains

Packages:

- `@securitydept/client`
- `@securitydept/client-react`
- `@securitydept/client-angular`

Change:

- Route requirements are evaluated from matched route chains.
- Child routes inherit parent requirements unless the adapter contract explicitly replaces or merges them.
- Framework adapters should stay provider-neutral and express auth requirements, not provider SDK details.

Migration:

- Model protected routes as route-chain requirements rather than flat per-leaf checks.
- Avoid app-local route guards that skip parent requirements.
- Keep product routing and chooser UI in the host app.

### Token-Set Callback And Readiness

Packages:

- `@securitydept/token-set-context-client`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

Change:

- Callback handling is keyed and readiness-aware.
- Duplicate, stale, missing, and client-mismatch callback states are formal callback outcomes.
- Hosts should surface typed callback failures rather than parsing raw text.

Migration:

- Register token-set clients before callback routes consume state.
- Use the framework callback components / guards where available.
- Route failure UI through structured code and recovery data.

### Token-Set Registry Dynamic Lifecycle Semantics

Packages:

- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

Change:

- Canonical registry lifecycle verbs are now `register(entry)`, `unregister(key)`, `resetMaterialization(key)`, and `dispose()`.
- The registry now exposes separate configured-vs-ready observability: `has()` / `registeredKeys()` / `registeredEntriesSnapshot()` / `registeredMetaSnapshot()` describe registered entries, while `readyKeys()` describes clients whose materialization and `start()` lifecycle have completed.
- React token-set composition is now registry-first: register `provideTokenSetAuthRegistry(...)` at the composition root, add `provideTokenSetCallbackResumeController(...)` only when callback resume handling is needed, and perform add/remove/reset flows through the injected registry instance rather than `TokenSetAuthProvider` or hidden lookup hooks. Angular `TokenSetAuthRegistry` now exposes the same lifecycle verbs, registered snapshots, ready keys, and `clientSignalFor()` acquisition as the shared core.

Migration:

- Replace old `reset(key)` calls that meant “remove this client registration” with `unregister(key)`.
- Replace old retry/recreate flows that re-register the same key after failure with `resetMaterialization(key)` followed by `whenReady(key)`.
- For management UIs or diagnostics, use the registered snapshots for configured rows, `readyKeys()` for started-client membership, and `clientSignalFor(key)` / `whenReady(key)` for live client access; do not treat ready-only keys as the source of truth for configured clients.
- In React hosts, do not expect prop changes to reconcile token-set registration automatically. Use `useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY)` or another retained registry reference for runtime lifecycle changes.

Justification:

- The old `reset(key)` wording mixed two different operations: removing a registration and invalidating one materialized service instance. Splitting the verbs makes async invalidation race-safe, keeps stale materialization from repopulating removed state, and gives hosts an explicit registered-vs-ready management surface.

### Token-Set Client Replay State And Registry Client Materialization

Packages:

- `@securitydept/client`
- `@securitydept/client/rx`
- `@securitydept/client-angular`
- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

Change:

- `TokenSetAuthRegistry.state`, `getState()`, and `subscribe()` are now the canonical topology/readiness observation surface. Snapshot helpers remain, but they are synchronous convenience over `state.get()`.
- `@securitydept/client` now provides replay signal primitives: `createReplaySignal()`, `createComputedReplaySignal()`, `createAndThenComputedReplaySignal()`, `readonlyReplaySignal()`, `isReplaySignalTrait()`, and `ReplaySignalSlot<T>`.
- `ReadableReplaySignalTrait` uses `get()` for type-safe synchronous slot reads and `whenValue({ cancellationToken })` for cancellable asynchronous value waits. The previous synchronous `value()` / `requireValue()` convenience methods are intentionally not part of the public replay signal contract because they cannot distinguish empty from `value(undefined)`.
- Registry-managed OIDC mode clients now expose canonical per-client auth channels: replay channels for `authDetermined`, `authSnapshot`, `isAuthenticated`, and `authorizationHeaderValue`; plain signals for `lastAuthError` and `authOperations.*Pending`.
- `TokenSetAuthService` has been removed from the public token-set registry, React, and Angular surfaces. The default `createTokenSetOidcAuthRegistry()` materializes the mode client itself, so `registry.whenReady()`, `registry.clientSignalFor()`, React Query readiness, and Angular registry lookups return clients.
- Registry-managed clients are explicit long-running state machines. Direct client creation defaults to not started; pass `autoStart: true` only for direct creation paths that should start immediately. Registry entries do not accept `autoStart` or `autoRestore`; the registry materializes clients and calls `client.start()` through its start hook.
- `registry.whenReady()` and `registry.clientSignalFor()` may omit the key only when exactly one client is registered. Omitted-key calls wait for lazy materialization and `start()` completion instead of only inspecting ready clients.
- React and Angular adapters no longer own separate business-state implementations for token freshness, access-token derivation, or auto-restore. They read the mode client replay channels and only perform host integration.
- `@securitydept/client/rx` is now the canonical RxJS bridge for both `ReadableSignalTrait` and `EventStreamTrait`. `signalToObservable` is no longer exported from `@securitydept/client-angular`; Angular keeps `bridgeToAngularSignal()` only.

Migration:

- Observe registry topology and readiness through `registry.state`, `registry.getState()`, or `registry.subscribe()`; use `registeredKeys()` / `readyKeys()` / registered snapshot helpers only as synchronous convenience.
- If host code depended on adapter-local token-set service state machines or `TokenSetAuthService`, migrate to the mode client channels directly: first-screen readiness uses `authDetermined`, stable UI uses `authSnapshot`, route guards use `isAuthenticated`, HTTP uses `authorizationHeaderValue`, and button locks use `authOperations.*Pending`.
- Replace synchronous service-wrapper access such as `registry.require(key).client` with `await registry.whenReady(key)` in async setup, or `useReadableSignal(registry.clientSignalFor(key))` in reactive hosts.
- In multi-client hosts, pass an explicit registry key to `whenReady(key)` and `clientSignalFor(key)`. Keep omitted-key usage only for true single-client hosts.
- Replace `import { signalToObservable } from "@securitydept/client-angular"` with `import { toRxObservable } from "@securitydept/client/rx"`.
- In Angular hosts that need RxJS values for auth state, call `toRxObservable(client.authSnapshot)` or another client replay signal. Replay signal observables do not emit before the first value and replay the last value to late subscribers.
- In React hosts that need aggregate registry reactivity, use `useReadableSignal(registry.state)` instead of maintaining an app-local mirror store for registered/ready keys. For per-client auth, read the client replay signals instead of creating service hooks.

Justification:

- This keeps the mode client as the single per-client auth authority, removes duplicated adapter-local/service state machines, avoids compressing unrelated UI states into one phase enum, and makes the RxJS bridge framework-neutral instead of Angular-owned.

## Current Non-Goals

These are not migration targets in the current SDK baseline:

- mixed-custody token ownership
- full BFF / server-side token-set ownership
- built-in SDK chooser UI
- app-specific business API wrappers
- product copy, toast policy, or route table ownership
- non-TypeScript SDK productization

## Adding A New Migration Note

Use this shape for future non-experimental breaking changes:

```markdown
### Package Or Subpath: Short Description

Package: `@securitydept/example`

Change:

- What changed.

Migration:

- What adopters must do.

Justification:

- Why the break is necessary.
```

Also update `sdks/ts/public-surface-inventory.json` and the focused evidence tests that prove the new contract.

---

[English](110-TS_SDK_MIGRATIONS.md) | [中文](../zh/110-TS_SDK_MIGRATIONS.md)
