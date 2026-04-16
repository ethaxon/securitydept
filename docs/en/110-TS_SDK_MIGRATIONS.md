# TS SDK Migration Ledger

This document is the authoritative entry for TS SDK public-surface change discipline, migration notes, and deprecation records.

## 0.x Contract Change Policy

The TS SDK is currently at `0.x`. This does not mean "break anything freely" — it means **breaking changes are allowed under explicit discipline**.

### Change Discipline by Stability Level

| Stability | Change Discipline | Meaning |
|---|---|---|
| `stable` | `stable-deprecation-first` | Breaking changes require a deprecation period. Removal only after at least one minor release with the deprecated API still available and a migration note in this ledger. |
| `provisional` | `provisional-migration-required` | Breaking changes are allowed but must be accompanied by a migration note in this ledger and a review-visible justification. |
| `experimental` | `experimental-fast-break` | Breaking changes are expected and may happen without prior deprecation. A brief note in this ledger is recommended but not enforced by the gate. |

### Rules

1. **Every non-experimental breaking change must have a migration note** in the [Migration Notes](#migration-notes) section below.
2. **Stable surface**: deprecate first, remove later. The deprecated API must remain functional for at least one minor release.
3. **Provisional surface**: break is allowed, but the note must include the justification and the migration path.
4. **Experimental surface**: no process required, but a brief note is appreciated.
5. **The inventory is the authority**: `public-surface-inventory.json` declares the `changeDiscipline` for each subpath. This ledger is the human-readable companion.

### How to Add a Migration Note

When making a breaking change to a non-experimental public surface:

1. Add a new entry under [Migration Notes](#migration-notes) with the format shown below.
2. Update `public-surface-inventory.json` if the subpath stability or shape changed.
3. Ensure `release-gate.test.ts` passes.

Entry format:

```markdown
### [date] package/subpath — short description

**Discipline**: `stable-deprecation-first` | `provisional-migration-required`
**Subpath**: `@securitydept/package/subpath`
**Change**: description of the breaking change
**Migration**: step-by-step migration instructions
**Justification**: why this break was necessary (provisional/stable only)
```

## Migration Notes

### 2026-04-19 @securitydept/token-set-context-client-react and ./react-query — canonical React token-set consumer path tightened around keyed SDK ownership

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/token-set-context-client-react` and `@securitydept/token-set-context-client-react/react-query`

**Change**:

The canonical React token-set consumer path is now keyed and SDK-owned end to end:

- `@securitydept/token-set-context-client-react` now exports `useTokenSetBackendOidcClient(clientKey)` as the formal lower-level keyed accessor for backend-oidc-specific behavior
- `@securitydept/token-set-context-client-react/react-query` canonical groups / entries hooks no longer require adopters to pass an explicit `client`
- the reference app no longer treats app-local `BackendOidcModeReactClient`, `getTokenSetClient()`, or `service.client as ...` narrowing as the canonical consumer story

**Migration**:

1. Replace canonical hook calls such as:
   ```ts
   useTokenSetGroupsQuery({ clientKey, client })
   useTokenSetCreateGroupMutation({ clientKey, client })
   ```
   with keyed-only calls:
   ```ts
   useTokenSetGroupsQuery({ clientKey })
   useTokenSetCreateGroupMutation({ clientKey })
   ```
2. If a React consumer needs backend-oidc-specific behavior such as `authorizeUrl()`, `authorizationHeader()`, `refresh()`, or `clearState()`, replace app-local `service.client as ...` narrowing with `useTokenSetBackendOidcClient(clientKey)`.
3. Keep app-local token-set modules focused on bootstrap config, trace sinks, or provider wiring rather than canonical consumer contracts.

**Justification**:

Iteration 115 moved the token-set React Query write path into the SDK, but the canonical React consumer story still depended on app-local client ownership patterns. Iteration 116 closes that gap by making the keyed registry / service path the formal consumer contract, and by moving the lower-level backend-oidc accessor into the SDK instead of leaving it in `apps/webui`.

### 2026-04-19 @securitydept/token-set-context-client-react/react-query — canonical mutation ownership moved into the SDK subpath

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/token-set-context-client-react/react-query`

**Change**:

The React Query subpath now owns the canonical token-set groups / entries mutation surface in addition to the existing read-side helpers.

It now exports:

- groups / entries query hooks
- groups / entries mutation hooks
- token-set management entity / request / response contracts used by those hooks
- query-key extensions for `groups`, `group`, `entries`, and `entry`
- post-mutation invalidation semantics for the canonical groups / entries flows

This also changes the owner boundary: `apps/webui` is no longer the canonical owner of token-set React Query write semantics. It is now a consumer / authority-evidence host of the SDK-owned surface.

**Migration**:

1. Replace app-local token-set React Query wrappers such as `useTokenSetQueries.ts` with imports from `@securitydept/token-set-context-client-react/react-query`.
2. Replace app-local `tokenSetAppQueryKeys.*` usage with `tokenSetQueryKeys.groups(...)`, `tokenSetQueryKeys.group(...)`, `tokenSetQueryKeys.entries(...)`, and `tokenSetQueryKeys.entry(...)`.
3. When a mutation needs request-scoped transport or cancellation, pass it through `requestOptions` on the mutation variables:
    ```ts
    mutation.mutate({
       name: "Operators",
       group_ids: ["group-1"],
       requestOptions: { cancellationToken },
    });
    ```

**Justification**:

Iteration 114 proved the real mutation lifecycle and invalidation semantics in `apps/webui`, but leaving those semantics app-local kept the reference app in the wrong owner role. Iteration 115 moves the canonical groups / entries write path, entity contracts, and query-key / invalidation policy into the SDK subpath so React adopters get a complete SDK-owned read/write story.

### 2026-04-12 React adapters moved from same-package subpaths to dedicated npm packages (breaking move)

**Discipline**: `provisional-migration-required`

**Removed old subpaths**:

| Old import path | New import path |
|---|---|
| `@securitydept/basic-auth-context-client/react` | `@securitydept/basic-auth-context-client-react` |
| `@securitydept/session-context-client/react` | `@securitydept/session-context-client-react` |
| `@securitydept/token-set-context-client/backend-oidc-mode/react` | `@securitydept/token-set-context-client-react` |

**Change**:

Framework-specific adapters for the three main families (BasicAuth, Session, OIDC), including their React/Angular bindings and Router adapters, have been entirely removed from the core packages.
- `@securitydept/basic-auth-context-client` no longer exports any framework adapters
- `@securitydept/session-context-client` no longer exports any framework adapters
- `@securitydept/token-set-context-client` no longer exports any framework adapters or related router adapters

**Migration**:

1. Install the new dedicated packages:
   ```
   pnpm add @securitydept/basic-auth-context-client-react
   pnpm add @securitydept/session-context-client-react
   pnpm add @securitydept/token-set-context-client-react
   ```

2. For React users, replace all `from "@securitydept/.../react"` imports with the new dedicated packages:
   - `from "@securitydept/basic-auth-context-client/react"` -> `from "@securitydept/basic-auth-context-client-react"`
   - `from "@securitydept/session-context-client/react"` -> `from "@securitydept/session-context-client-react"`
   - `from "@securitydept/token-set-context-client/backend-oidc-mode/react"` -> `from "@securitydept/token-set-context-client-react"`

3. For router-adapter users, do **not** stop at the intermediate token-set framework packages. Follow the dedicated route-adapter migration in the 2026-04-13 section below:
   - TanStack Router -> `@securitydept/client-react/tanstack-router`
   - Angular Router -> `@securitydept/client-angular`

**Justification**:

React adapters now follow the same dedicated-package strategy as Angular adapters. Angular adapters required separate packages from the start due to `ng-packagr` APF build requirements. Aligning React adapters to the same strategy avoids a mixed `tsdown` + `ng-packagr` subpath pattern, provides cleaner `peerDependencies` declarations, and improves tree-shaking boundaries.

---

### 2026-04-10 @securitydept/basic-auth-context-client — Config validation deprecation (phase 1: warn)

**Discipline**: `stable-deprecation-first`
**Subpath**: `@securitydept/basic-auth-context-client` (`.`)
**Change**: `BasicAuthContextClient` constructor now validates config at runtime via `BasicAuthContextClientConfigSchema`. In this deprecation phase, invalid configs produce a `console.warn` but the client still constructs. The following inputs are deprecated and will become hard errors in a future minor release:
  - `zones: []` (empty array) — will require at least one zone
  - `zonePrefix: ""` (empty string) — will require non-empty string
  - `baseUrl: ""` (empty string) — will require non-empty string

**Migration**: If your code constructs `BasicAuthContextClient` with an empty `zones` array or empty `zonePrefix` / `baseUrl`, add at least one valid zone config with non-empty strings before the next minor release.
**Justification**: A `BasicAuthContextClient` with zero zones or empty path prefixes has no functional behavior. Making this an explicit deprecation prevents subtle bugs where the client silently does nothing.

---

### 2026-04-13 Auth orchestration primitives — owner moved from token-set to @securitydept/client

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/token-set-context-client/orchestration` (partial — planner and route orchestrator removed)

**New canonical location**: `@securitydept/client/auth-coordination`

**Change**:

`RequirementPlanner`, `RouteRequirementOrchestrator`, and all related types (`AuthRequirement`, `RouteMatchNode`, `PlanSnapshot`, `ResolutionStatus`, `PlanStatus`, etc.) have been **removed** from `@securitydept/token-set-context-client/orchestration` and are now exclusively available from `@securitydept/client/auth-coordination`.

Additionally, the `RequirementKind` named constant object has been removed entirely. `AuthRequirement.kind` is now an opaque `string`; each auth-context or adopter project should define its own named constants.

`@securitydept/token-set-context-client/orchestration` still exists and continues to export the token-set-specific orchestration layer: `AuthSnapshot`, `AuthSourceKind`, `bearerHeader`, `mergeTokenDelta`, `createAuthStatePersistence`, `createAuthorizedTransport`, `createAuthMaterialController`, `BaseOidcModeClient`, etc.

**Migration**:

1. Replace the import location for planner and orchestrator:
   ```diff
   - import { createRequirementPlanner, PlanStatus, ResolutionStatus } from "@securitydept/token-set-context-client/orchestration";
   - import { createRouteRequirementOrchestrator } from "@securitydept/token-set-context-client/orchestration";
   + import { createRequirementPlanner, PlanStatus, ResolutionStatus } from "@securitydept/client/auth-coordination";
   + import { createRouteRequirementOrchestrator } from "@securitydept/client/auth-coordination";
   ```

2. Replace `RequirementKind.xxx` with string literals:
   ```diff
   - import { RequirementKind } from "@securitydept/token-set-context-client/orchestration";
   - { id: "session", kind: RequirementKind.Session }
   - { id: "api-token", kind: RequirementKind.BackendOidc }
   + { id: "session", kind: "session" }
   + { id: "api-token", kind: "backend_oidc" }
   ```
   If your project uses these constants widely, define a local `const MyRequirementKind = { ... } as const` object.

3. Framework adapter users (TanStack Router, Angular Router adapters): `AuthRequirement` and `RouteMatchNode` types are re-exported from the adapter packages, avoiding direct orchestrator imports. (Note: Ensure you update to the new canonical adapter paths as described in the 2026-04-13 migration).

**Justification**:

`RequirementPlanner` and `RouteRequirementOrchestrator` are protocol-agnostic and cross-auth-context primitives. Their `RequirementKind` vocabulary (session, OIDC, custom) clearly spans beyond token-set. Hosting these in `token-set-context-client` was a misplacement that created an unwanted coupling — non-token-set adopters (basic-auth, session) had to depend on the token-set package to use shared orchestration. Moving to `@securitydept/client` (the foundation shared across all auth-context families) establishes the correct ownership boundary.

---

### 2026-04-13 Route adapter ownership — moved from token-set family to shared framework adapter owners

**Discipline**: `provisional-migration-required`

**Removed canonical ownership from**:
- `@securitydept/token-set-context-client-react/tanstack-router` (TanStack Router projection)
- `@securitydept/token-set-context-client-angular` (Angular Router projection, `TokenSetRouterAdapter`)

**New canonical locations**:

| Old import path | New import path | Rename |
|---|---|---|
| `@securitydept/token-set-context-client-react/tanstack-router` | `@securitydept/client-react/tanstack-router` | — |
| `@securitydept/token-set-context-client-angular` (router types) | `@securitydept/client-angular` | `TokenSetRouterAdapter` → `AuthRouteAdapter`; `TokenSetRouterAdapterOptions` → `AuthRouteAdapterOptions` |

**Change**:

The generic route adapter logic (projection of framework-specific matched route trees into `RouteMatchNode[]`) has been extracted from the token-set framework adapter packages and re-homed in new shared framework adapter owners:

- `@securitydept/client-react/tanstack-router` — canonical TanStack React Router adapter:
  - `projectTanStackRouteMatches()` (unchanged API)
  - `createTanStackRouteActivator()` (unchanged API)
  - `TanStackRouteMatch` / `TanStackRouterAdapterOptions` (unchanged shapes)
  - `DEFAULT_REQUIREMENTS_KEY` (unchanged value)

- `@securitydept/client-angular` — canonical Angular Router adapter:
  - `AuthRouteAdapter` injectable service (renamed from `TokenSetRouterAdapter`)
  - `AuthRouteAdapterOptions` (renamed from `TokenSetRouterAdapterOptions`)
  - `RouteGuardResult` (unchanged)
  - `DEFAULT_ROUTE_REQUIREMENTS_KEY` (unchanged)

**Compat re-exports** (transitional):

The compat re-exports that existed briefly (`@securitydept/token-set-context-client-react/tanstack-router` and the route adapter part of `@securitydept/token-set-context-client-angular`) have been fully removed in this iteration. Only the new canonical packages remain.

**Migration**:

1. TanStack Router users:
   ```diff
   - import { projectTanStackRouteMatches, createTanStackRouteActivator } from "@securitydept/token-set-context-client-react/tanstack-router";
   + import { projectTanStackRouteMatches, createTanStackRouteActivator } from "@securitydept/client-react/tanstack-router";
   ```

2. Angular Router users:
   ```diff
   - import { TokenSetRouterAdapter } from "@securitydept/token-set-context-client-angular";
   + import { AuthRouteAdapter } from "@securitydept/client-angular";
   ```
   Then rename all usages: `TokenSetRouterAdapter` → `AuthRouteAdapter`, `TokenSetRouterAdapterOptions` → `AuthRouteAdapterOptions`.

**Justification**:

The projection of framework route trees into `RouteMatchNode[]` is a pure framework glue concern with no token-set-specific logic. Hosting it in the token-set family forces adopters that only need auth orchestration (session, basic-auth) to take a token-set dependency for shared route adapter features. Moving to `@securitydept/client-react` and `@securitydept/client-angular` establishes the correct ownership: framework adapters are owned by dedicated framework adapter packages, token-set families own only their token-set-specific mapping and policy.

---

### 2026-04-13 Angular Router auth canonical path: route-metadata + full-route aggregation (breaking)

**Discipline**: `provisional-migration-required`

**Subpaths affected**:
- `@securitydept/token-set-context-client-angular` — `createTokenSetAuthGuard()` removed from public surface; `createTokenSetRouteAggregationGuard()` extended with `requirementPolicies`
- `@securitydept/client-angular` — signal bridge utilities added (`bridgeToAngularSignal`, `signalToObservable`)
- `@securitydept/client` — `ReadableSignalTrait` is now the canonical contract for SDK signals

**Change**:

The Angular Router auth canonical path has been consolidated to route-metadata + full-route aggregation:

1. `createTokenSetAuthGuard()` is **removed from the public surface**. `createTokenSetRouteAggregationGuard()` is the single canonical guard and now absorbs all former capabilities via `requirementPolicies`.
2. `requirementPolicies` (keyed by `requirement.id`) allows per-requirement overrides:
   - `selector: { clientKey }` or `selector: { query: ClientQueryOptions }` — override default kind→client mapping
   - `onUnauthenticated` — per-requirement redirect/block policy (takes precedence over `requirementHandlers[kind]` and `defaultOnUnauthenticated`)
3. Signal bridge utilities (`bridgeToAngularSignal`, `signalToObservable`) moved from `@securitydept/token-set-context-client-angular` to `@securitydept/client-angular`. `SdkReadableSignal` local type removed; canonical type is `ReadableSignalTrait` from `@securitydept/client`.

**Migration**:

1. Remove `createTokenSetAuthGuard` usage. Replace with `createTokenSetRouteAggregationGuard`:
   ```diff
   - import { createTokenSetAuthGuard } from "@securitydept/token-set-context-client-angular";
   + import { createTokenSetRouteAggregationGuard } from "@securitydept/token-set-context-client-angular";

   - createTokenSetAuthGuard({
   -   clientOptions: {
   -     selector: { clientKey: "confluence" },
   -     requirementId: "confluence-oidc",
   -     requirementKind: "frontend_oidc",
   -     onUnauthenticated: () => "/auth/confluence",
   -   },
   -   plannerHost: host,
   - })
   + createTokenSetRouteAggregationGuard({
   +   requirementPolicies: {
   +     "confluence-oidc": {
   +       selector: { clientKey: "confluence" },
   +       onUnauthenticated: () => "/auth/confluence",
   +     },
   +   },
   +   plannerHost: host,  // optional: omit if AUTH_PLANNER_HOST is provided via DI
   + })
   ```

2. For `query`-selector users:
   ```diff
   - createTokenSetAuthGuard({
   -   clientOptions: {
   -     selector: { query: { requirementKind: "frontend_oidc" } },
   -     requirementId: "oidc-auth",
   -     requirementKind: "frontend_oidc",
   -     onUnauthenticated: () => "/login",
   -   },
   - })
   + createTokenSetRouteAggregationGuard({
   +   requirementPolicies: {
   +     "oidc-auth": {
   +       selector: { query: { requirementKind: "frontend_oidc" } },
   +       onUnauthenticated: () => "/login",
   +     },
   +   },
   + })
   ```

3. Update signal bridge imports:
   ```diff
   - import { bridgeToAngularSignal, signalToObservable, SdkReadableSignal } from "@securitydept/token-set-context-client-angular";
   + import { bridgeToAngularSignal, signalToObservable } from "@securitydept/client-angular";
   + import type { ReadableSignalTrait } from "@securitydept/client";
   ```

**Justification**:

Having both `createTokenSetAuthGuard` and `createTokenSetRouteAggregationGuard` as public options forces adopters to choose between two parallel paths with overlapping but unequal capabilities. `createTokenSetRouteAggregationGuard` with `requirementPolicies` covers the full capability surface of the old guard, so the old guard is removed. Signal bridge utilities belong in the generic framework adapter layer (`@securitydept/client-angular`), not in a token-set-specific package.

---

### 2026-04-13 createTokenSetAuthGuard redesigned to planner-host architecture (superseded)

**Discipline**: `provisional-migration-required`

**Subpaths affected**:
- `@securitydept/token-set-context-client-angular` — guard factory
- `@securitydept/client/auth-coordination` — new planner-host contract
- `@securitydept/client-angular` — new planner-host DI providers
- `@securitydept/client-react` — new planner-host Context providers (`.` root export added)

**Change**:

`createTokenSetAuthGuard()` API has been completely redesigned. The old discriminated union (`query` / `clientKey` / `fromRoute`) has been replaced with a new `clientOptions` + `plannerHost` architecture:

- Old: `createTokenSetAuthGuard({ clientKey: "main", onUnauthenticated: ... })`
- New: `createTokenSetAuthGuard({ clientOptions: { selector: { clientKey: "main" }, requirementId: "main-auth", requirementKind: "frontend_oidc", onUnauthenticated: ... } })`

Additionally, a `PlannerHost` is now required — either provided via Angular DI (`provideAuthPlannerHost()`) or passed inline.

**Migration**:

1. Add planner-host provider to your app config:
   ```ts
   import { provideAuthPlannerHost } from "@securitydept/client-angular";

   export const appConfig: ApplicationConfig = {
     providers: [provideAuthPlannerHost()],
   };
   ```

2. Update guard calls:
   ```diff
   - createTokenSetAuthGuard({
   -   clientKey: "confluence",
   -   onUnauthenticated: (failing) => "/login",
   - })
   + createTokenSetAuthGuard({
   +   clientOptions: {
   +     selector: { clientKey: "confluence" },
   +     requirementId: "confluence-oidc",
   +     requirementKind: "frontend_oidc",
   +     onUnauthenticated: (failing) => "/login",
   +   },
   + })
   ```

3. For `fromRoute` users: replace with explicit `clientOptions` declarations per route. The requirement metadata (id, kind) is now declared at the guard level, not embedded in route data.

4. For `query` users: use `selector: { query: ... }` inside each `clientOption`:
   ```diff
   - createTokenSetAuthGuard({
   -   query: { requirementKind: "frontend_oidc" },
   -   onUnauthenticated: (failing) => "/login",
   - })
   + createTokenSetAuthGuard({
   +   clientOptions: {
   +     selector: { query: { requirementKind: "frontend_oidc" } },
   +     requirementId: "oidc-auth",
   +     requirementKind: "frontend_oidc",
   +     onUnauthenticated: (failing) => "/login",
   +   },
   + })
   ```

**Justification**:

The old guard API conflated client resolution with auth decision-making. The new planner-host architecture separates concerns:
- Client options declare what to check and how to react
- The planner-host makes the coordination decision (which candidate to act on)
- Custom selection strategies (e.g. chooser UI) are pluggable without modifying guard code
- Framework-specific planner host providers (Angular DI, React Context) enable scope-based overrides

### 2026-04-13 Angular build topology switched to pnpm recursive (non-breaking)

**Discipline**: `provisional-migration-required`

**Change**: The root `sdks/ts` build script now uses `pnpm -r --filter './packages/*' run build` instead of manual `build:core && build:angular`. Angular workspace dependencies now declare `devDependencies` mirroring `workspace:*` `peerDependencies`, enabling pnpm to compute the correct build topology automatically.

**Migration**: No changes required for consumers. `build:core` and `build:angular` remain as ad-hoc shortcuts.

### 2026-04-13 @securitydept/client-react adds root export and react peerDependency

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/client-react` (`.`)

**Change**: `@securitydept/client-react` now exports a root entry (`.`) providing React planner-host integration (`AuthPlannerHostProvider`, `useAuthPlannerHost`, etc.). React is now a required `peerDependency`. The `./tanstack-router` subpath continues to be available and its existing projection-level APIs (`projectTanStackRouteMatches`, `createTanStackRouteActivator`) are unchanged; a new route-security contract was added in a subsequent iteration (see below).

**Migration**: Ensure `react >= 18.0.0` is installed in your project. No route-level import changes are required for projection-only `./tanstack-router` users at this iteration.

---

### 2026-04-15 @securitydept/client-react/tanstack-router — route-security contract upgrade (additive + canonical entry change)

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/client-react/tanstack-router`

**Change**:

The `./tanstack-router` subpath has gained a full route-security contract aligned with Angular's `secureRouteRoot()` / `secureRoute()` pattern established in Iteration 106. This is an **additive** change — all existing projection-level APIs remain intact — but the **canonical adopter-facing entry has changed**:

| Before (Iteration 103) | After (Iteration 107) |
|---|---|
| No canonical adopter entry; adopters assembled `projectTanStackRouteMatches()` + custom `beforeLoad` manually | `createSecureBeforeLoad()` is the canonical adopter-facing beforeLoad factory |
| `withTanStackRouteRequirements()` existed but had no router-execution glue | `withTanStackRouteRequirements()` on child routes, `createSecureBeforeLoad()` on root route |
| `createTanStackRouteSecurityPolicy()` was the highest-level entry | `createTanStackRouteSecurityPolicy()` is now a lower-level primitive (headless evaluator) |

New canonical adopter-facing pattern:

```ts
import { redirect, createRootRoute, createRoute } from "@tanstack/react-router";
import {
  createSecureBeforeLoad,
  withTanStackRouteRequirements,
} from "@securitydept/client-react/tanstack-router";

// Root route: non-serializable runtime policy
const rootRoute = createRootRoute({
  beforeLoad: createSecureBeforeLoad({
    redirect,                                              // TanStack Router's redirect()
    checkAuthenticated: (req) => authStore.isAuthenticated(req.kind),
    requirementHandlers: {
      frontend_oidc: (req) => `/login/oidc?returnTo=${req.id}`,
    },
    defaultOnUnauthenticated: () => "/login",
  }),
});

// Child routes: serializable declaration only
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "dashboard",
  staticData: withTanStackRouteRequirements([{ id: "session", kind: "session" }]),
});
```

New exports added:
- `createSecureBeforeLoad(options)` — root-level beforeLoad factory
- `RouteSecurityBlockedError` — thrown when navigation is hard-blocked
- `SecureBeforeLoadContext` — minimal beforeLoad context shape
- `CreateSecureBeforeLoadOptions` — options type for `createSecureBeforeLoad`

Existing exports unchanged (still available as lower-level primitives):
- `projectTanStackRouteMatches()` — for `RouteMatchNode[]` projection
- `createTanStackRouteActivator()` — for orchestrator lifecycle bridge
- `createTanStackRouteSecurityPolicy()` — headless evaluator (for custom integrations)
- `withTanStackRouteRequirements()` — route declaration helper (no change)
- `extractTanStackRouteRequirements()` — full-route aggregation (no change)

**Migration**:

**Projection-only users** (using only `projectTanStackRouteMatches` + `createTanStackRouteActivator` for `RouteRequirementOrchestrator` integration): **no action required**. These APIs are unchanged.

**Route-security adopters** who previously assembled `beforeLoad` manually using `createTanStackRouteSecurityPolicy().evaluate()`: upgrade to `createSecureBeforeLoad()` for the canonical pattern:

```diff
- // Old: manual assembly
- const policy = createTanStackRouteSecurityPolicy({ requirementHandlers: { ... } });
- const rootRoute = createRootRoute({
-   beforeLoad: ({ matches }) => {
-     const result = policy.evaluate(matches, checkAuthenticated);
-     if (!result.allMet && typeof result.action === "string") {
-       throw redirect({ to: result.action });
-     }
-   },
- });
+ // New: canonical entry
+ const rootRoute = createRootRoute({
+   beforeLoad: createSecureBeforeLoad({
+     redirect,
+     checkAuthenticated,
+     requirementHandlers: { ... },
+   }),
+ });
```

**Justification**:

The previous state (headless `createTanStackRouteSecurityPolicy()` only) required every adopter to manually wire the `evaluate()` result into TanStack Router's redirect/throw semantics, duplicating the same glue pattern. `createSecureBeforeLoad()` encapsulates this wiring at the SDK level, matching angular's `secureRouteRoot()` depth and establishing a proper canonical entry that is observable and testable without framework mocks.

---

### `TokenSetClientEntry.clientFactory` now accepts async return (iteration 108)

**Packages**: `@securitydept/token-set-context-client-angular`, `@securitydept/token-set-context-client`

**Breaking change level**: Minor (additive — new overload, old sync usage unchanged)

**What changed**:

1. `TokenSetClientEntry.clientFactory` type widened from `() => OidcModeClient & OidcCallbackClient` to `() => (OidcModeClient & OidcCallbackClient) | Promise<OidcModeClient & OidcCallbackClient>`
2. `TokenSetAuthRegistry.register()` now has TypeScript overloads: sync factory → `TokenSetAuthService`, async factory → `Promise<TokenSetAuthService>`
3. New readiness API: `registry.isReady(key)`, `registry.readinessState(key)`, `registry.whenReady(key)`
4. New core contract: `resolveConfigProjection()`, `networkConfigSource()`, `ConfigProjectionSourceKind`, `ClientReadinessState` in `@securitydept/token-set-context-client/frontend-oidc-mode`

**Migration**:

```diff
- // Old: compile-time config, sync clientFactory
- import { environment } from "@/environments/environment";
- clientFactory: () => createFrontendOidcModeClient({
-   issuer: environment.OIDC_ISSUER,
-   clientId: environment.OIDC_CLIENT_ID,
-   ...
- }, runtime),

+ // New: backend-driven config, async clientFactory
+ import { resolveConfigProjection, networkConfigSource }
+   from "@securitydept/token-set-context-client/frontend-oidc-mode";
+ clientFactory: async () => {
+   const resolved = await resolveConfigProjection([
+     networkConfigSource({
+       apiEndpoint: environment.CONFLUENCE_API_ENDPOINT,
+       redirectUri: `${location.origin}/auth/callback`,
+     }),
+   ]);
+   return createFrontendOidcModeClient(resolved.config, runtime);
+ },
```

**Main execution path migration** (guard, callback, interceptor):

`createTokenSetRouteAggregationGuard` — uses `whenReady()` (route guard blocks until ready):
```diff
- // Old (implicit): registry.require(key) — throws if client not yet materialized
- const entries = clientKeys.map(key => ({ service: registry.require(key), ... }));

+ // New: awaits async factory, safe on first navigation
+ const entries = await Promise.all(
+   clientKeys.map(async key => ({ service: await registry.whenReady(key), ... }))
+ );
```

`CallbackResumeService.handleCallback()` — uses `whenReady()` (callback page waits for client):
```diff
- const service = this.registry.require(clientKey);

+ // New: waits if client async factory is still in-flight when callback page loads
+ const service = await this.registry.whenReady(clientKey);
```

Bearer interceptors — **do not** use `whenReady()` (explicit passthrough design):
```
// Interceptors intentionally use registry.get() — not whenReady().
// If a client is still initializing, the request proceeds without Authorization.
// This is correct: guards enforce readiness; interceptors should never deadlock HTTP.
const token = key ? (registry.get(key)?.accessToken() ?? null) : registry.accessToken();
```

**Justification**:

Compile-time OIDC credentials baked into the frontend bundle prevent backend-driven config projection. The async `clientFactory` + `resolveConfigProjection()` contract moves config ownership to the backend. The readiness API (`whenReady`) gives route guards and callback handlers a formal way to await async client materialization. Interceptors deliberately use `get()` (not `whenReady`) to avoid HTTP deadlocks during initialization.

---

### Iteration 109 — Config projection hot-recovery with full source precedence

**Scope**: SDK `config-source.ts` + `outposts-web` adopter + production host

**Source precedence chain** (highest → lowest priority):
1. `bootstrap_script` — server-injected via `window.__OUTPOSTS_CONFIG__`
2. `persisted` — restored from `RecordStore` (localStorage) with timestamp envelope
3. `network` — fetched from backend `/api/auth/config`

**New SDK helpers**:
- `bootstrapScriptSource(options)` — reads from configurable window global (`__OUTPOSTS_CONFIG__` default), with multi-source field (`oidc`) and injection timestamp (`_ts`)
- `persistedConfigSource(options)` — reads from abstract `RecordStore`, envelope contains `{ data, timestamp }`
- `persistConfigProjection(store, key, resolved)` — writes resolved projection + timestamp to `RecordStore`
- `scheduleIdleRevalidation(options)` — freshness-aware: only fires when `Date.now() - timestamp > maxAge` (default 5min); uses `requestIdleCallback` with `setTimeout` fallback

**`ResolvedConfigProjection`** extended with optional `timestamp` and `rawProjection` fields.

**Production host architecture** (separate deployment):
- `bun:alpine` injector sidecar — fetches projection from confluence via HTTP, injects into `index.html`, writes to shared Docker volume; retries ≤3 failures (retaining cache), clears cache on >3 failures
- `nginx:alpine` — serves static assets + injected `index.html` from shared volume with SPA fallback
- Orchestrated via `docker-compose.web.yml`

**Dev server**: `esbuildMiddleware` in `project.json` — equivalent injection behavior via Connect-style middleware

```diff
- // Old: single network source
- const resolved = await resolveConfigProjection([
-   networkConfigSource({ apiEndpoint, redirectUri }),
- ]);

+ // New: full source precedence with persistence and idle revalidation
+ const netSource = networkConfigSource({ apiEndpoint, redirectUri });
+ const resolved = await resolveConfigProjection([
+   bootstrapScriptSource({ redirectUri }),
+   persistedConfigSource({ store, storageKey, redirectUri }),
+   netSource,
+ ]);
+ if (resolved.sourceKind !== "persisted") {
+   void persistConfigProjection(store, storageKey, resolved);
+ }
+ if (resolved.sourceKind !== "network") {
+   scheduleIdleRevalidation({ networkSource: netSource, store, storageKey, timestamp: resolved.timestamp });
+ }
```

### Iteration 110 — Shared multi-client registry, React 19 productization, raw Web router, multi-client lazy init

**Scope:** Phase-neutral productization of multi-client auth across React / Angular / raw Web; extraction of the framework-neutral registry core; native Navigation API-first router baseline; formalized `primary | lazy` client lifecycle with idle prefetch.

**Stability:** all new surfaces ship as `provisional` (provisional-migration-required change discipline).

**New public surfaces**

| Package | Subpath | Purpose |
|---|---|---|
| `@securitydept/client` | `./web-router` | Raw Web router baseline (`createNavigationAdapter`, `createWebRouter`, `isNavigationApiAvailable`, `NavigationAdapterKind`, `WebRouteDefinition`, `WebRouteMatch`, `WebRouteMatcher`, `WebRouter`, `defineWebRoute`, `extractFullRouteRequirements`, `RequirementsClientSetComposition`). Navigation API-first, History API + `popstate` fallback. Full-route aggregation with `inherit` / `merge` / `replace` composition at parity with Angular / TanStack Router adapters (review-1 follow-up). |
| `@securitydept/token-set-context-client` | `./registry` | Framework-neutral multi-client registry core (`createTokenSetAuthRegistry`, `TokenSetAuthRegistry`, `ClientInitializationPriority`, `ClientReadinessState`, `OidcModeClient`, `OidcCallbackClient`, `ClientMeta`, `TokenSetClientEntry`, `ClientQueryOptions`). The shared managed OIDC client contract owner now lives here rather than being duplicated inside Angular / React adapters. |
| `@securitydept/token-set-context-client-react` | `./react-query` | Token-set React Query consumer subpath for canonical groups / entries read/write workflows (`tokenSetQueryKeys`, `useTokenSetReadinessQuery`, `useTokenSetAuthorizationHeader`, `invalidateTokenSetQueriesForClient`, query hooks, mutation hooks, and token-set management contracts). **Not a standalone package**: optional peer `@tanstack/react-query`. |
| `@securitydept/token-set-context-client-react` | `.` (additive) | `TokenSetAuthService`, `TokenSetAuthProvider`, `useTokenSetAuthRegistry`, `useTokenSetAuthService`, `useTokenSetAuthState`, `useTokenSetAccessToken`, `useTokenSetCallbackResume`, `CallbackResumeState`, `CallbackResumeStatus`, `TokenSetCallbackComponent` with a retained `TokenSetCallbackOutlet` compatibility alias. Angular-parity multi-client story on React. The callback hook awaits `registry.whenReady(clientKey)` before `handleCallback()`, so async / lazy clients no longer silently drop callbacks (review-1 follow-up). |

**Breaking migrations**

1. **Angular `TokenSetAuthRegistry.register()` no longer accepts a `DestroyRef` argument.** The registry now pulls its own `DestroyRef` via `inject()` at construction time and binds teardown once per Angular scope. Direct instantiation outside an injection context (unit tests) must call `registry.dispose()` manually.
   ```diff
   - registry.register(entry, destroyRef);
   + registry.register(entry);
   ```
   Same removal applies to `new TokenSetAuthService(client, destroyRef, autoRestore)` → `new TokenSetAuthService(client, autoRestore)`.

2. **`ClientMeta` gains a required `priority: "primary" | "lazy"` field.** Explicit `ClientMeta` literals must provide it. Registry `register()` call-sites are unaffected because the default remains `"primary"` to preserve iteration-109 behavior.

3. **React 19 peer uplift.** `@securitydept/*-react` packages declare `peerDependencies: { "react": ">=19.0.0" }`. React 18 adopters must stay on iteration 109 or upgrade before pulling iteration 110.

4. **Registry `require()` error string adjusted.** The phrase order changed from `No client registered (and ready) for key "X"` to `No client registered for key "X" (and ready)`. Adopter regex-match assertions on this message may need updating.

**Ecosystem integration policy (manager ruling)**

React ecosystem integrations (React Query, potential future Zustand / Jotai / TanStack Query v6 bridges) **must not** ship as standalone packages. They live as **subpaths** under the main React package with their runtime library listed as an `optional` peer dependency and mirrored in `devDependencies` of the hosting package for type-checking. Consumers who do not import the subpath pay zero cost. This rule is binding for all future iterations.

**New evidence**

- `examples/web-router-navigation-api.test.ts` — Navigation API path with JSDOM polyfill
- `examples/web-router-history-fallback.test.ts` — History API + `popstate` fallback path
- `examples/web-router-full-route-aggregation.test.ts` — nested routes + `inherit` / `merge` / `replace` composition + single-call `plannerHost.evaluate()` with full candidate set (review-1 follow-up)
- `examples/multi-client-lazy-init-contract.test.ts` — framework-neutral `priority | preload | whenReady | idleWarmup | reset` contract
- `examples/react-multi-client-registry-baseline.test.ts` — React provider + hooks covering multi-client registration and disposal
- `examples/react-query-integration-evidence.test.ts` — React Query subpath canonical query + mutation consumer semantics
- `examples/react-callback-async-readiness.test.ts` — `useTokenSetCallbackResume` / `TokenSetCallbackComponent` (plus the retained `TokenSetCallbackOutlet` compatibility alias) drive async / lazy client materialisation via `registry.whenReady()` with pending + error surface coverage (review-1 follow-up)

**Reference-app authority update (non-breaking)**

- iteration 117 split the former generic token-set host path in `apps/webui` / `apps/server` into two explicit reference modes:
   - backend mode: `/auth/token-set/backend-mode/*` plus `/playground/token-set/backend-mode`
   - frontend mode: `/api/auth/token-set/frontend-mode/config`, `/playground/token-set/frontend-mode`, and `/auth/token-set/frontend-mode/callback`
- `TokenSetCallbackComponent` now has real host-level authority only through the frontend-mode callback route
- dashboard bearer integration and TanStack route security now operate across both token-set modes without adding any new public React secure-guard surface

---

[English](../en/110-TS_SDK_MIGRATIONS.md) | [中文](../zh/110-TS_SDK_MIGRATIONS.md)

