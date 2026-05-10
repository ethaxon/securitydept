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
- Read and write helpers are SDK-owned where they represent reusable token-set groups / entries behavior.
- App-specific mutation composition remains app glue.

Migration:

- Import React Query helpers from the `./react-query` subpath.
- Do not depend on `apps/webui/src/hooks/*` as public API.
- Keep TanStack Query as an optional peer dependency in hosts that import the subpath.
- Treat `requestOptions.transport` as a resource-request override only; auth lifecycle and authorization-header ownership still stay with the token-set client service.

### Framework Adapter Environment Boundaries

Packages:

- `@securitydept/client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

Change:

- `@securitydept/client-react` now owns the canonical React environment-service bridge: `ClientEnvironmentServiceProvider`, `useClientEnvironmentService()`, `useClientEnvironment()`, `useWebClientEnvironment()`, and `usePageClientEnvironment()`.
- `SessionContextProvider` and `provideSessionContext` bridge `SessionContextController`, the framework-neutral state/flow owner for user-info refresh, logout cleanup, and redirect helpers. They still accept `environment: WebClientEnvironment`, but initial user-info probing is explicit through `initialRefresh`; hosts may pass an already-created `controller` to the React provider when they own lifecycle directly.
- The legacy single-client `BackendOidcModeContextProvider` now accepts `environment: BackendOidcModeWebClientEnvironment` and materializes its browser client through `createBackendOidcModeWebClient(...)` instead of a raw dependency/capability bag.
- Angular `createTokenSetOidcLoginRedirectHandler()` is now the route-login helper. It still uses `environment` as the only public key, but the value is now a stable page-environment source that Angular DI provides through `providePageClientEnvironment({ environment })` from `@securitydept/client-angular`. The helper targets the shared `OidcRedirectLoginClient` contract and awaits that source inside the guard flow before calling `loginWithRedirect()`.
- Angular `CallbackResumeService` and React `useTokenSetCallbackResume({ getCurrentUrl, describeError })` now bridge the shared `TokenSetCallbackResumeController` from `@securitydept/token-set-context-client/registry`. Angular `TokenSetCallbackComponent` remains page-only convenience over that service, with injectable current URL and host policy tokens.

Migration:

- Build browser environments at the framework composition root, then pass those environment objects into the provider entrypoints.
- Opt session adapters into initial probing with `initialRefresh` when an app relied on the old provider/service construction side effect, or call `controller.refresh()` / `service.refresh()` explicitly from the host-owned lifecycle.
- For React render paths that need page capability, wrap the route/app tree with `ClientEnvironmentServiceProvider({ service })`, read page capability with `usePageClientEnvironment()` under Suspense plus an error boundary, and keep command/event flows on `useClientEnvironmentService().resolvePageEnvironment()`.
- For Angular frontend-oidc route redirects, provide one stable page-environment source from the composition root with `providePageClientEnvironment({ environment })`, where `environment` is usually a provider-scoped `ClientEnvironmentService` or another inject-safe stable resolver.
- For Angular callback routes, override `TOKEN_SET_CALLBACK_CURRENT_URL` when `window.location.href` is not the right source of truth, and override `TOKEN_SET_CALLBACK_COMPONENT_OPTIONS` when the host needs non-default fallback navigation or centralized error logging.
- For custom callback orchestration, call `CallbackResumeService.resume(url)` or the React hook with `getCurrentUrl` / `describeError` instead of reintroducing page-global fallback logic or mode-specific copy into ordinary helpers. `CallbackResumeService.handleCallback(url)` remains only a compatibility wrapper.

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
