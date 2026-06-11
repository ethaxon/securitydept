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

### Auth Coordination Planner Host And Planner Variants

Packages:

- `@securitydept/client`

Change:

- The auth-coordination surface is rebuilt around three layers: a serializable `contract`, a non-serializable `RequirementPlannerHost`, and a planner family that owns the pipeline.
- `RequirementPlannerHost.fromBehaviour(behaviour, { parent })` carries `checkAuthenticated` / `onUnauthenticated` / `selectCandidate`. Each field is optional and resolved through the parent chain (nearest definition wins; safe defaults at the root: unauthenticated / block / first-candidate).
- `BaseRequirementPlanner` owns the pipeline: `buildPlan()` (step 0 — bind host behaviour and materialize a `RequirementPlan`), `checkUnauthenticatedCandidates(plan)` (step 1), `runStep(plan)` / `runUntilSettled()` (step 2 loop). Variants differ only in how requirements are materialized inside `buildPlan()`:
  - `StaticRequirementPlanner.fromRequirements(host, requirements)`
  - `RouteCompositionRequirementPlanner.fromRootRoute(host, segments)` / `.fromActiveRoute(host, segments, previousPlanner, previousPlan)` (immutable transition; preserves shared-prefix resolutions from `previousPlan`)
  - `MergeRequirementPlanner.fromPlanners(host, planners)` (ordered concatenation, no dedupe)
- The pipeline runs `checkAuthenticated` concurrently in step 2 and partitions into resolved / candidate sets. There is no sequential prefix auto-resolve; inter-requirement ordering or dependencies must be expressed inside `checkAuthenticated`.
- Call `buildPlan()` at the start of each manual pipeline run. It resolves the host parent chain, captures behaviour callbacks once, and returns a `RequirementPlan` whose behaviour and requirement list stay fixed until the next `buildPlan()`. `runUntilSettled()` calls it automatically.
- Removed without replacement aliases: `createPlannerHost`, `PlannerHost`, `PlannerHostResult`, `CreatePlannerHostOptions`, `CandidateSelector`, `AuthGuardClientOption`, `materializeAuthGuardCandidates`, `MaterializeAuthGuardCandidatesOptions`, `RequirementPlanner` (old class with `nextPending`/`resolve`), `RouteRequirementPlannerSession`, `RouteMatchNode`, `RouteRequirementSettledEvent`, `ChooserDecision`, `RequirementsClientSet`, `ScopedRequirementsClientSet`, `RequirementsClientSetComposition`, `resolveEffectiveClientSet`.

Migration:

- Replace `createPlannerHost({ selectCandidate })` + `materializeAuthGuardCandidates(...)` + `host.evaluate(candidates)` with a `RequirementPlannerHost`, `buildPlan()`, and `checkUnauthenticatedCandidates(plan)` / `runStep(plan)` / `runUntilSettled()`.
- Replace `RequirementsClientSetComposition` with `RequirementsComposition` and `resolveEffectiveClientSet` with `resolveEffectiveRequirements`.
- Replace `RouteRequirementPlannerSession` (and its `activateMatchedRoutes` / `resolve` / `ChooserDecision`) with `RouteCompositionRequirementPlanner` (`RouteTreeSegment[]` carries per-segment `composition`).
- Provider-level chooser belongs in `selectCandidate`; per-requirement provider context belongs in `RequirementResolution` or the requirement attributes, not a separate decision bag.

Note: the Angular adapter packages (`@securitydept/client-angular`, `@securitydept/token-set-context-client-angular`) are migrated (see Angular Route Subsystem Rewrite below). `@securitydept/client-react` remains a follow-up and will not typecheck against this surface until then.

### Angular Route Subsystem Rewrite

Packages:

- `@securitydept/client-angular`
- `@securitydept/token-set-context-client-angular`

Change:

- The Angular route subsystem is rebuilt on top of `RequirementPlannerHost` / `RouteCompositionRequirementPlanner`. `@securitydept/client-angular` owns the token-set-agnostic base layer; `@securitydept/token-set-context-client-angular` provides the registry-backed specialization that calls into it.
- `@securitydept/client-angular` removals: `AuthRouteAdapter`, `createRouterForAngularRouter` (renamed), `RouteGuardResult`; the old planner-host DI (`AUTH_PLANNER_HOST`, `provideAuthPlannerHost`, `injectPlannerHost`, `AUTH_REQUIREMENTS_CLIENT_SET`, `provideRouteScopedRequirements`, `resolveEffectiveClientSet`); and the old route-metadata helpers (`withRouteRequirements`, `extractFullRouteRequirements`, `ROUTE_REQUIREMENTS_DATA_KEY`, `ROUTE_REQUIREMENTS_COMPOSITION_DATA_KEY`, `resolveEffectiveRequirements`).
- `@securitydept/client-angular` additions: `createRouterForAngular(options)` (→ `RouterTrait`); `projectAngularRouteSegments(leafRoute)`; DI planner-host wiring `REQUIREMENT_PLANNER_HOST` + `provideRequirementPlannerHost(behaviourOrFactory)` + `injectRequirementPlannerHost()` (the Angular DI hierarchy maps to the host parent chain via `skipSelf`); `createAngularCanActivate(options?)` / `createAngularCanActivateChild(options?)`; and route builders `secureRoute()` (metadata only) / `secureRouteRoot()` (metadata + `canActivate` + `canActivateChild`, optional `provideRequirementPlannerHost`). Route metadata storage lives in `@securitydept/client` (`SECURITYDEPT_ROUTE_METADATA_KEY`, `readSecuritydeptRouteMetadata`, `writeSecuritydeptRouteMetadata`).
- `@securitydept/token-set-context-client-angular` removals: `createTokenSetRouteAggregationGuard` and the `guard-types` module (`UnauthenticatedEntry` moved into `planner-host`).
- `@securitydept/token-set-context-client-angular` route auth now layers on the core registry model: `provideTokenSetClientRegistry({ clients })` registers core `TokenSetClientRegistryEntry<BaseOidcModeClient>` values, `provideTokenSetRequirementPlannerHost(options?)` binds registry-backed `RequirementBehaviour` to `REQUIREMENT_PLANNER_HOST`, and `secureTokenSetRoute()` / `secureTokenSetRouteRoot()` expect query-based `TokenSetClientRegistryAuthRequirement` metadata.

Migration:

- Replace `createRouterForAngularRouter(...)` with `createRouterForAngular(...)`.
- Replace `AuthRouteAdapter.projectRouteMatch(...)` + `extractFullRouteRequirements(...)` with `projectAngularRouteSegments(route)` feeding `RouteCompositionRequirementPlanner.fromRootRoute(host, segments)`.
- Replace `provideAuthPlannerHost()` / `AUTH_PLANNER_HOST` with `provideRequirementPlannerHost(behaviourOrFactory)` / `REQUIREMENT_PLANNER_HOST`; for token-set, use `provideTokenSetRequirementPlannerHost(options?)`.
- Replace `createTokenSetRouteAggregationGuard(...)` with `createTokenSetCanActivate()` / `createTokenSetCanActivateChild()` (host resolved through DI), or preferably declare token-set routes with `secureTokenSetRoute()` / `secureTokenSetRouteRoot()`.
- Move token-set requirement `kind` into `attributes.requirementKind` (the token-set `secureRoute` helpers do this automatically).

### RouterTrait URI Reference Migration

Packages:

- `@securitydept/client`
- `@securitydept/client/web`
- `@securitydept/client/webext`
- `@securitydept/client-angular`
- `@securitydept/client-react/tanstack-router`
- `@securitydept/session-context-client`
- `@securitydept/basic-auth-context-client`
- `@securitydept/token-set-context-client`

Change:

- `RouterTrait.currentUrl()` now returns `UriReferenceString | null` instead of `URL | null`. SPA adapters may expose relative in-app paths (`/dashboard`) without fabricating an absolute URL.
- `RouterNavigationRequest.url`, `RouterGuardContext.url` / `currentUrl`, and redirect decisions use `UriReferenceString`.
- `parseCompatFragment` / `takeCompatFragmentFromRouter` accept `UriReferenceString` inputs.

Migration:

- `environment.router.currentUrl()?.toString()` remains valid for OAuth return URLs and logging.
- Replace `new URL(relative, sentinelBase)` in custom adapters with `UriReferenceString.tryParse(relative)` for `currentUrl`.
- Pass `coerceUriReferenceString(string)` when calling `router.navigate({ url, ... })` from string-returning client APIs.

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
- React domain packages now export injection tokens, provider factories, plain factories, and explicit callback/component bridges. State reading is unified around `useReadableSignalValue(...)`.

Migration:

- Wrap React subtrees with `SecuritydeptProvider`; pass a ready-made `injector`, or derive a child injector from `providers` / `parentInjector`.
- Replace `XxxContextProvider` / `useXxxContext()` with `useSecuritydeptContext().get(TOKEN)`.
- Replace `useTokenSetAuthState(key)` / `useTokenSetAccessToken(key)` / `useTokenSetAuthRegistryState()` with `const registry = useSecuritydeptContext().get(TOKEN_SET_CLIENT_REGISTRY)` followed by `useReplaySignalValue(registry.clientSignalFor(key))`, then read the returned client's replay channels.
- Replace basic-auth / session provider-first composition with `create*()` + `provide*()`. For token-set multi-client React composition, register `provideTokenSetClientRegistry({ clients })` and use the frontend/backend callback Resource hooks when the host needs callback rendering.

### Token-Set React Registry Composition

Package:

- `@securitydept/token-set-context-client-react`

Change:

- `createTokenSetAuthRuntime()` and `provideTokenSetAuthRuntime()` are removed.
- The React token-set adapter no longer blesses one fixed runtime bundle that couples registry ownership, callback resume controller ownership, idle warmup, and disposal.

Migration:

- For ordinary React hosts, register `provideTokenSetClientRegistry({ clients })`.
- If the host needs callback rendering, use `useTokenSetFrontendCallback()` or `useTokenSetBackendCallback()` from the React root adapter.
- If the host needs manual readiness, manual disposal, or custom warmup policy, create and own the registry directly instead of depending on an SDK-owned runtime object.

### Client Environment And Backend-OIDC Web Host Boundary

Packages:

- `@securitydept/client`
- `@securitydept/client/web`

Change:

- Framework-neutral host capability resolution is now owned by the client foundation through typed `FoundationEnvironment`, `NativeWebEnvironment`, `WebExtCoreEnvironment`, and related host specializations.
- The historical `ClientRuntime` naming has been retired in favor of environment terminology. Core client constructor dependencies are environments, not a second runtime layer. Canonical access is `environment.transport`, `environment.sessionStorage`, and peers.
- Web host environment factories are explicit composition entry points. They are not automatic host detection and no longer expose preset-only worker/service-worker/extension-background wrappers.
- Context and adapter public helpers use the same boundary. Backend-OIDC web helpers, basic-auth/session redirect helpers, and framework adapter convenience helpers must not each redeclare or guess transport/store/time/page dependencies.
- Backend-OIDC web helpers are split by host boundary: page-only helpers use page-explicit names, while worker-safe startup uses host-injected environment/capabilities plus `client.start()`, `autoStart`, registry orchestration, and auth signals.

Migration:

- Create one environment at the host composition root and pass the environment object itself through providers/adapters. Do not teach adopters to read `environment.runtime`; update direct historical runtime/derive helper usage to `FoundationEnvironment`, `createFoundationEnvironment()`, `createEnvironmentForNativeWeb()`, or direct structural environment passing.
- Keep public option keys named `environment` even when the value is page-scoped or async-resolved. Do not introduce `pageEnvironment` as a parallel key; the type communicates the page requirement.
- Use `createEnvironmentForNativeWeb({ location, history, ...options })` for real page/tab/popup callback flows; page capabilities are explicit top-level host inputs and must come from the host composition root.
- Do not use `createEnvironmentForNativeWeb()` for worker-like hosts. Compose those with `createFoundationEnvironment()` or a more specific host factory, then inject persistence/session stores explicitly when needed.
- Do not run callback fragment consumption in service workers or extension backgrounds. Run restore/token-state APIs there, and consume callback fragments only in a real page/popup document or with an explicit fake `RouterTrait` in tests.
- Update ambiguous page-global helper usage to explicit page forms: use `client.authorizeUrl(environment.router.currentUrl()?.toString())` or `client.loginWithRedirect({ postAuthRedirectUri })` for return-URL construction. Callback pages use `takeFrontendOidcCallbackInputFromRouter(router)` or `takeBackendOidcCallbackInputFromRouter(router)` followed by `client.handleCallback(input)`. Backend OIDC fragment redirects use the securitydept compat fragment protocol and preserve existing hash-router fragments.
- Treat popup callback relay helpers such as `relayTokenSetPopupCallbackFromEnvironment()` as page-only helpers; pass a page-bearing `environment` when testing or running in a host wrapper. Import them from `@securitydept/token-set-context-client/backend-oidc-mode` or `@securitydept/token-set-context-client/frontend-oidc-mode`; the removed `@securitydept/token-set-context-client/backend-oidc-mode/web` subpath was only a forwarder. The canonical shared token-set OIDC browser login contracts are `BaseOidcModeClient.loginWithRedirect({ postAuthRedirectUri })` and `BaseOidcModeClient.loginWithPopup({ popupCallbackUrl })`; the client carries page navigation and popup capability through its environment. Backend and frontend mode clients expose those methods directly. Backend OIDC no longer owns hidden callback-fragment flow state; retry or delayed callback handling must be explicit application code.
- Replace frontend-mode browser materialization with `resolveFrontendOidcModeConfigProjection({ clientKey, environment, sources, overrides })`, then construct `FrontendOidcModeClient` with the returned config and the same root environment. Declare realm, persisted, and network precedence explicitly; inject server-rendered projections with `injectConfigProjectionIntoRealm()`.
- When browser/page environment ownership must stay stable across framework routes or commands, create one host-owned `NativeWebEnvironment` at the composition root and inject that object. Do not invent app-local module singletons or SDK-local lazy environment resolvers.
- Treat basic-auth/session `/web` redirect helpers as page navigation helpers; keep them in a real page context or inject an explicit `RouterTrait`.
- Let framework provider/DI registration functions own full environment composition. Do not make ordinary hooks, guards, interceptors, services, or convenience helpers each accept a full scattered dependency bag.
- Do not infer page capability from `globalThis.location`; core helpers consume behavior traits. Raw `window.location` and `window.history` only appear in explicit native-web adapter inputs.

Justification:

- Non-client-bound helpers had started to duplicate dependency bags and hidden `window.*` defaults. Typed environments keep core dependency wiring explicit while giving helpers a shared, testable, host-scoped capability boundary.

### TimeTrait And EventStream Time Sources

Package:

- `@securitydept/client`

Change:

- `FoundationEnvironment` now carries one `time: TimeTrait` capability instead of separate `clock` and `scheduler` fields. Idle work is a separate optional `idleCallback: IdleCallbackTrait` capability.
- `createTimeForStd()` replaces `createDefaultClock()` and `createDefaultScheduler()`.
- `createDefaultIdleScheduler()` and registry `idleScheduler` wiring are removed. Registry idle warmup now runs only when the host provides `environment.idleCallback`.
- `timer()`, `interval()`, `scheduleAt()`, `fromTimeout()`, `fromInterval()`, `fromScheduleAt()`, `fromEventPattern()`, `fromSignal()`, and `fromPromise()` are removed from `@securitydept/client`.
- The SDK still exposes `EventStreamTrait` / `EventSubjectTrait` as its public reactive primitives, but generic source construction now belongs to direct RxJS usage plus the `@securitydept/client/rx` bridge and `createAsyncSchedulerWithTimestampProvider(...)` when host-owned `TimeTrait` must drive scheduling.

Migration:

- Replace `{ clock, scheduler }` environment wiring with `{ time }`; pass a host-owned `{ environment }` whose `environment.idleCallback` is set only when the host intentionally enables registry idle warmup. Tool-level idle revalidation helpers still consume explicit narrow capabilities.
- Registry-managed token-set entries now receive that same registry-owned environment as `clientFactory(environment)`. Build clients from this argument instead of reaching for module globals or passing scattered sub-capabilities.
- Replace direct callback timer handles with `timer(delayMs, createAsyncSchedulerWithTimestampProvider(time)).subscribe(...)`.
- Replace recurring callback scheduling with `interval(periodMs, createAsyncSchedulerWithTimestampProvider(time)).subscribe(...)`.
- Replace `fromEventPattern({ ..., callback })` style SDK helpers with direct `rxjs` sources such as `fromEventPattern(...)`, `from(Promise.resolve(...))`, or `new Observable(...)`, then bridge back to `EventStreamTrait` only when a SecurityDept trait boundary is required.
- Use `createTimeForTest()` from `@securitydept/client/test` when deterministic `now()`, timer queueing, flushing, and pending-count assertions are needed.

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

### Angular Token-Set Client Registry Authorization Interceptor

Package: `@securitydept/token-set-context-client-angular`

Change:

- `provideTokenSetClientRegistryAuthorizationInterceptor()` replaces `provideTokenSetBearerInterceptor()`.
- `createTokenSetClientRegistryAuthorizationInterceptor(options?)` replaces `createTokenSetBearerInterceptor(registry, options?)`.
- `authorizationForRequest(registry, request)` customizes how the `Authorization` header is resolved. It can be passed explicitly or provided with `TOKEN_SET_CLIENT_REGISTRY_AUTHORIZATION_FOR_REQUEST`. The default implementation selects a client by request URL and returns no header for unmatched URLs.

Migration:

```ts
provideTokenSetClientRegistryAuthorizationInterceptor();
createTokenSetClientRegistryAuthorizationInterceptor();
```

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

Package: removed token-set React Query subpath

Change:

- The React Query subpath has been removed.
- Query keys, readiness queries, and invalidation policy are app-local concerns composed on top of the injected token-set registry and clients.

Migration:

- Move token-set query keys into the host app.
- Use `TOKEN_SET_CLIENT_REGISTRY` plus `registry.clientRecordFor(key, { initialize: true })` or `registry.clientResourceFor(key)` inside host-owned TanStack Query hooks.

### Framework Adapter Environment Boundaries

Packages:

- `@securitydept/client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

Change:

- `@securitydept/client-react` now owns the canonical React injector bridge: `SecuritydeptContext`, `SecuritydeptProvider`, and `useSecuritydeptContext()`, plus the context-free `useReadableSignalValue()`, `useReplaySignalValue()`, `useInteropObservable()`, and `useEventStream()` bridge.
- `client-react` root now exports the React injector bridge only. React environment capability comes from the core environment injector: pass `environment.injector` to the root `SecuritydeptProvider` as `parentInjector`. Route-scoped planner hosts are owned by concrete router adapters such as `@securitydept/client-react/tanstack-router`.
- The basic-auth / session / token-set React adapters no longer own domain-specific Provider / Context hooks. They export tokens, plain factories, provider factories, and explicit callback/component bridges. Token-set multi-client composition is now explicit registry/controller wiring instead of an SDK-owned runtime bundle.
- Token-set Angular/React route security now relies on `secureTokenSetRouteRoot()` plus the registry-backed default unauthenticated handler. Client selection belongs in requirement `attributes.query`; custom redirect policy is optional via `onClientUnauthenticated` on the secure route root or planner host provider.
- React callback handling uses `useTokenSetFrontendCallback()` and `useTokenSetBackendCallback()` over client-owned callback Resources. Registry selection is non-consuming and returns a fixed-record client resolver. The registry entry factory starts the client; client startup resolves and takes callback input before persistence restore.

Migration:

- Build browser environments at the framework composition root, then register those dependencies through `SecuritydeptProvider` plus provider factories.
- Opt session adapters into initial probing by explicitly creating `SessionContextController` and calling `controller.refresh()` from the host-owned lifecycle when needed.
- For React code that needs environment capability, pass the host-owned environment injector to `SecuritydeptProvider` as `parentInjector` and read it later through `useSecuritydeptContext().get(ENVIRONMENT_TOKEN)`.
- For Angular frontend-oidc route redirects, provide the host-owned environment object from the composition root with `provideEnvironment({ environment })`.
- For Angular callback routes, use `TokenSetFrontendCallbackComponent` or `TokenSetBackendCallbackComponent`.
- For custom callback orchestration, provide a client `callbackInputResolver` and use the registry selectors without reintroducing a separate callback controller.

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
- React token-set composition is registry-first: register `provideTokenSetClientRegistry(...)` at the composition root, use callback Resource hooks only where callback state is rendered, and perform add/remove flows through the injected registry instance. Angular token-set composition uses `TokenSetClientRegistryService`, a thin DI adapter over the shared core `TokenSetClientRegistry`.

Migration:

- Replace old `reset(key)` calls that meant “remove this client registration” with `unregister(key)`.
- Replace old retry/recreate flows that re-register the same key after failure with `resetMaterialization(key)` followed by `whenReady(key)`.
- For management UIs or diagnostics, use the registered snapshots for configured rows, `readyKeys()` for started-client membership, and `clientSignalFor(key)` / `whenReady(key)` for live client access; do not treat ready-only keys as the source of truth for configured clients.
- In React hosts, do not expect prop changes to reconcile token-set registration automatically. Use `useSecuritydeptContext().get(TOKEN_SET_CLIENT_REGISTRY)` or another retained registry reference for runtime lifecycle changes.

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
- `@securitydept/client/rx` is now the canonical RxJS bridge for both `ReadableSignalTrait` and `EventStreamTrait`. `signalToObservable` is no longer exported from `@securitydept/client-angular`; Angular adapters should use `toNgSignal(source)` from `@securitydept/client-angular`.

Migration:

- Observe registry topology and readiness through `registry.state`, `registry.getState()`, or `registry.state.notify(listener)`; use `registeredKeys()` / `readyKeys()` / registered snapshot helpers only as synchronous convenience.
- If host code depended on adapter-local token-set service state machines or `TokenSetAuthService`, migrate to the mode client channels directly: first-screen readiness uses `authDetermined`, stable UI uses `authSnapshot`, route guards use `isAuthenticated`, HTTP uses `authorizationHeaderValue`, and button locks use `authOperations.*Pending`.
- Replace synchronous service-wrapper access such as `registry.require(key).client` with `await registry.whenReady(key)` in async setup, or `useReadableSignalValue(registry.clientSignalFor(key))` in reactive hosts.
- In multi-client hosts, pass an explicit registry key to `whenReady(key)` and `clientSignalFor(key)`. Keep omitted-key usage only for true single-client hosts.
- Replace `import { signalToObservable } from "@securitydept/client-angular"` with `import { toRxObservable } from "@securitydept/client/rx"`.
- In Angular hosts that need RxJS values for auth state, call `toRxObservable(client.authSnapshot)` or another client replay signal. Replay signal observables do not emit before the first value and replay the last value to late subscribers.
- In React hosts that need aggregate registry reactivity, use `useReadableSignalValue(registry.state)` instead of maintaining an app-local mirror store for registered/ready keys. For per-client auth, read the client replay signals instead of creating service hooks.

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
