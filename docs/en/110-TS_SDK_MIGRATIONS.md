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

### Unified Injector And Single React Context

Packages:

- `@securitydept/client/injection`
- `@securitydept/client-react`
- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

Change:

- `@securitydept/client/injection` now owns the framework-neutral DI authority. `SecuritydeptInjectorTrait` is the minimal read-side contract and only expresses `get()`; `SecuritydeptInjector` is the SDK runtime/facade that owns provider resolution, parent inheritance, overrides, and `has()` diagnostics.
- React now has exactly one SDK Context: `SecuritydeptContext`, `SecuritydeptProvider`, and `useSecuritydeptContext()` in `@securitydept/client-react`.
- React domain packages no longer export `BasicAuthContextProvider`, `SessionContextProvider`, `BackendOidcModeContextProvider`, `TokenSetAuthProvider`, `useBasicAuthContext()`, `useSessionContext()`, `useBackendOidcModeContext()`, `useTokenSetAuthRegistry()`, and similar domain-specific Context / Provider / keyed state helpers.
- React domain packages now export injection tokens, provider factories, plain factories, and explicit callback/component bridges. State reading is unified around `useReadableSignal(...)`.

Migration:

- Wrap React subtrees with `SecuritydeptProvider`; pass a ready-made `injector`, or derive a child injector from `providers` / `parentInjector`.
- Replace `XxxContextProvider` / `useXxxContext()` with `useSecuritydeptContext().get(TOKEN)`.
- Replace `useTokenSetAuthState(key)` / `useTokenSetAccessToken(key)` / `useTokenSetAuthRegistryState()` with `const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY)` followed by `useReadableSignal(registry.require(key).state)` or `useReadableSignal(registry.state)`.
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

- Framework-neutral host capability resolution is now owned by the client foundation through typed `ClientEnvironment`, `WebClientEnvironment`, and `PageClientEnvironment` objects.
- The historical `ClientRuntime` naming has been retired in favor of `ClientEnvironment`. Core client constructor dependencies are environments, not a second runtime layer. Canonical access is `environment.transport`, `environment.sessionStore`, and peers.
- Web host presets are explicit factory entry points for browser page, browser worker, service worker, and browser-extension background hosts. They are not automatic host detection.
- Context and adapter public helpers use the same boundary. Backend-OIDC web helpers, basic-auth/session redirect helpers, and framework adapter convenience helpers must not each redeclare or guess transport/store/scheduler/clock/page dependencies.
- Backend-OIDC web helpers are split by host boundary: page-only helpers use page-explicit names, while worker-safe helpers require host-injected environment/capabilities or restore-only behavior.

Migration:

- Create one environment at the host composition root and pass the environment object itself through providers/adapters. Do not teach adopters to read `environment.runtime`; update direct `ClientRuntime` / `createRuntime()` / `createWebRuntime()` / `deriveClientRuntime()` usage to `ClientEnvironment`, `createClientEnvironment()`, `createWebClientEnvironment()`, or `deriveClientEnvironment()`.
- Keep public option keys named `environment` even when the value is page-scoped or async-resolved. Do not introduce `pageEnvironment` as a parallel key; the type communicates the page requirement.
- Use `createBrowserPageClientEnvironment(options)` for real page/tab/popup callback flows.
- Use `createBrowserWorkerClientEnvironment(options)`, `createServiceWorkerClientEnvironment(options)`, or `createBrowserExtensionBackgroundClientEnvironment(options)` for worker-like hosts; inject persistence/session stores explicitly when needed.
- Do not call page callback bootstrap in service workers or extension backgrounds. Run restore/token-state APIs there, and run callback capture only in a real page/popup document or with explicit fake page/callback-fragment capabilities in tests.
- Update ambiguous page-global helper names to page-explicit forms where the public name changed, such as `currentPageLocationAsPostAuthRedirectUri()`, `buildAuthorizeUrlReturningToCurrentPage()`, `bootstrapBackendOidcModePageClient()`, and `captureBackendOidcModePageCallbackFragment()`.
- Treat existing redirect/popup helpers (`loginWithBackendOidcRedirect()`, `loginWithBackendOidcPopup()`, and `relayBackendOidcPopupCallback()`) as page-only helpers even though their historical names remain intact; pass explicit page capability (`PageLocationHistoryCapability`) or a page-bearing `environment` when testing or running in a host wrapper. The canonical shared token-set OIDC browser contract is now `loginWithRedirect({ environment, postAuthRedirectUri })` on `OidcRedirectLoginClient`; backend web clients materialized through `createBackendOidcModeWebClient(...)` expose that method while `loginWithBackendOidcRedirect()` remains the compatibility/convenience wrapper. Popup login also requires an explicit callback-fragment capability, and browser-state reset requires an explicit `callbackFragmentStore`.
- For frontend-mode browser materialization, create `createFrontendOidcModeWebClientEnvironment(...)` at the host composition root and pass it to `createFrontendOidcModeBrowserClient({ environment, ... })`; the materializer no longer creates a default environment when `environment` is omitted.
- When browser/page environment ownership must stay stable across framework routes or commands, create a provider/injector-scoped `ClientEnvironmentService` and use `await service.resolvePageEnvironment()` for command/event flows or `service.readPageEnvironment()` for Suspense-compatible render paths instead of inventing app-local module singletons.
- Treat basic-auth/session `/web` redirect helpers that read or write `window.location` as page helpers; keep them in a real page context or inject explicit navigation capabilities.
- Let framework provider/DI registration functions own full environment composition. Do not make ordinary hooks, guards, interceptors, services, or convenience helpers each accept a full scattered dependency bag.
- Do not infer page capability from `globalThis.location`; page helpers require `window.location` and `window.history.replaceState`.

Justification:

- Non-client-bound helpers had started to duplicate dependency bags and hidden `window.*` defaults. Typed client environments keep core dependency wiring explicit while giving helpers a shared, testable, host-scoped capability boundary.

### Token-Set Event-Driven Auth Flow

Packages:

- `@securitydept/client/events`
- `@securitydept/token-set-context-client/orchestration`
- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-angular`
- `@securitydept/token-set-context-client-react`

Change:

- Token-set clients now expose `authEvents` and `ensureAuthForResource(options)` as the canonical async route/request/resume barrier.
- `ensureFreshAuthState()` and `ensureAuthorizationHeader()` remain compatibility wrappers, but new adapter code should pass an explicit source such as `route_guard`, `resume`, `http_interceptor`, or `authorized_transport`.
- Authorization-header events may include an opaque temporary token handle descriptor. They must not include raw access, refresh, or ID token values.

Migration:

- Prefer `ensureAuthForResource({ source, forceRefreshWhenDue: true })` for route admission and resume recovery.
- Prefer `ensureAuthForResource({ source, needsAuthorizationHeader: true, forceRefreshWhenDue: true })` before protected HTTP requests.
- Subscribe to `authEvents` for lifecycle telemetry instead of inferring auth flow state from redirects, thrown errors, or raw token values.

Justification:

- Short access-token lifetimes need one shared refresh barrier across restore, resume, routes, interceptors, generic transports, and React Query instead of adapter-local freshness patches.

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
- `client-react/environment-service` and `planner-host` now export injection tokens and provider factories only, for example `CLIENT_ENVIRONMENT_SERVICE` + `provideClientEnvironmentService()` and `AUTH_PLANNER_HOST` + `provideAuthPlannerHost()`.
- The basic-auth / session / token-set React adapters no longer own domain-specific Provider / Context hooks. They export tokens, plain factories, provider factories, and explicit callback/component bridges. Token-set multi-client composition is now explicit registry/controller wiring instead of an SDK-owned runtime bundle.
- Angular `createTokenSetOidcLoginRedirectHandler()` is now the route-login helper. It still uses `environment` as the only public key, but the value is now a stable page-environment source that Angular DI provides through `providePageClientEnvironment({ environment })` from `@securitydept/client-angular`. The helper targets the shared `OidcRedirectLoginClient` contract and awaits that source inside the guard flow before calling `loginWithRedirect()`.
- Angular `CallbackResumeService` and React `useTokenSetCallbackResume({ getCurrentUrl, describeError })` now bridge the shared `TokenSetCallbackResumeController` from `@securitydept/token-set-context-client/registry`. Angular `TokenSetCallbackComponent` remains page-only convenience over that service, with injectable current URL and host policy tokens.

Migration:

- Build browser environments at the framework composition root, then register those dependencies through `SecuritydeptProvider` plus provider factories.
- Opt session adapters into initial probing by explicitly creating `SessionContextController` and calling `controller.refresh()` from the host-owned lifecycle when needed.
- For React code that needs an environment service, register it with `provideClientEnvironmentService()` and read it later through `useSecuritydeptContext().get(CLIENT_ENVIRONMENT_SERVICE)`; keep page capability explicit through service `resolvePageEnvironment()` / `readPageEnvironment()` calls or explicit props.
- For Angular frontend-oidc route redirects, provide one stable page-environment source from the composition root with `providePageClientEnvironment({ environment })`, where `environment` is usually a provider-scoped `ClientEnvironmentService` or another inject-safe stable resolver.
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
- The registry now exposes separate configured-vs-materialized observability: `has()` / `registeredKeys()` / `registeredEntriesSnapshot()` / `registeredMetaSnapshot()` describe registered entries, while `readyKeys()` / `readyEntriesSnapshot()` describe materialized services.
- The React token-set composition root is now `createTokenSetAuthRuntime({ clients })` + `provideTokenSetAuthRuntime(runtime)`; runtime add/remove/reset flows should use the injected registry instance rather than `TokenSetAuthProvider` or hidden lookup hooks. Angular `TokenSetAuthRegistry` now exposes the same lifecycle verbs and registered/ready snapshots as the shared core.

Migration:

- Replace old `reset(key)` calls that meant “remove this client registration” with `unregister(key)`.
- Replace old retry/recreate flows that re-register the same key after failure with `resetMaterialization(key)` followed by `whenReady(key)`.
- For management UIs or diagnostics, use the registered snapshots for configured rows and the ready snapshots for live service state; do not treat ready-only keys as the source of truth for configured clients.
- In React hosts, do not expect prop changes to reconcile the token-set runtime automatically. Use `useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY)` or a retained runtime/registry reference for runtime lifecycle changes.

Justification:

- The old `reset(key)` wording mixed two different operations: removing a registration and invalidating one materialized service instance. Splitting the verbs makes async invalidation race-safe, keeps stale materialization from repopulating removed state, and gives hosts an explicit registered-vs-ready management surface.

### Token-Set Core Signal State And Canonical Rx Bridge

Packages:

- `@securitydept/client/rx`
- `@securitydept/client-angular`
- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

Change:

- `TokenSetAuthRegistry.state`, `getState()`, and `subscribe()` are now the canonical topology/readiness observation surface. Snapshot helpers remain, but they are synchronous convenience over `state.get()`.
- `TokenSetAuthService` now lives under `@securitydept/token-set-context-client/registry` as the shared per-client auth material owner. Its `state` owns snapshot, derived token material, freshness, restore lifecycle, and disposed state.
- React and Angular adapters no longer own separate business-state implementations for token freshness, access-token derivation, or auto-restore. React hooks and Angular bridges read the shared core service/registry state instead.
- `@securitydept/client/rx` is now the canonical RxJS bridge for both `ReadableSignalTrait` and `EventStreamTrait`. `signalToObservable` is no longer exported from `@securitydept/client-angular`; Angular keeps `bridgeToAngularSignal()` only.

Migration:

- Observe registry topology and readiness through `registry.state`, `registry.getState()`, or `registry.subscribe()`; use `registeredKeys()` / `readyKeys()` / snapshot helpers only as synchronous convenience.
- If host code depended on adapter-local token-set service state machines, migrate that logic to the shared `TokenSetAuthService` contract from `@securitydept/token-set-context-client/registry` and treat React/Angular service wrappers as host bridges.
- Replace `import { signalToObservable } from "@securitydept/client-angular"` with `import { toRxObservable } from "@securitydept/client/rx"`.
- In React hosts that need aggregate registry reactivity, use `useReadableSignal(registry.state)` instead of maintaining an app-local mirror store for registered/ready keys.

Justification:

- This keeps framework-neutral core signal state as the single authority, removes duplicated adapter-local state machines, and makes the RxJS bridge framework-neutral instead of Angular-owned.

### Token-Set Registry Explicit Service Wiring

Packages:

- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

Change:

- `CreateTokenSetAuthRegistryOptions` is now explicit-only. `dispose`, `accessTokenOf`, `ensureAccessTokenOf`, `ensureAuthorizationHeaderOf`, `ensureAuthForResourceOf`, `authEventsOf`, and `idleScheduler` are required instead of optional.
- `createTokenSetOidcAuthRegistry(...)` no longer performs shape-based fallback wiring. Callers must provide `materializeService` and every other registry capability mapping explicitly.
- `TokenSetAuthService` now exposes same-name static helpers for the canonical OIDC-backed wiring path: `materializeService`, `dispose`, `accessTokenOf`, `ensureAccessTokenOf`, `ensureAuthorizationHeaderOf`, `ensureAuthForResourceOf`, and `authEventsOf`.

Migration:

- When constructing `createTokenSetAuthRegistry(...)`, always pass a complete option object even in tests or single-client hosts.
- When constructing `createTokenSetOidcAuthRegistry(...)`, stop relying on omitted options to infer service capabilities from runtime shape.
- For the shared core `TokenSetAuthService`, prefer the static helpers directly:

```ts
const registry = createTokenSetOidcAuthRegistry({
	materializeService: TokenSetAuthService.materializeService,
	dispose: TokenSetAuthService.dispose,
	accessTokenOf: TokenSetAuthService.accessTokenOf,
	ensureAccessTokenOf: TokenSetAuthService.ensureAccessTokenOf,
	ensureAuthorizationHeaderOf:
		TokenSetAuthService.ensureAuthorizationHeaderOf,
	ensureAuthForResourceOf: TokenSetAuthService.ensureAuthForResourceOf,
	authEventsOf: TokenSetAuthService.authEventsOf,
	idleScheduler: (callback) => {
		const handle = setTimeout(callback, 0);
		return () => clearTimeout(handle);
	},
});
```

Justification:

- Hidden shape checks made registry behavior depend on what methods happened to exist on a service instance at runtime. Requiring every mapping up front makes the contract auditable, avoids silent capability drift, and keeps adapter wiring obvious at the call site.

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
