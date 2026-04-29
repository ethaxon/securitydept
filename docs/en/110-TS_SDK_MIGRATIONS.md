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

These are not migration targets in the current stable line:

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
