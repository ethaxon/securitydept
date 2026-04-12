# Client SDK Guide

This document defines the formal design direction for SecurityDept client SDKs. TypeScript comes firstwith Kotlin and Swift expected later under the same architectural rules.

Target readers:

- human developers implementing SDK modules
- AI agents modifying SDK code or documentation

## Goal

Client SDKs should model SecurityDept auth-context behavior for client and portable runtime use cases. They must not reuse the server-side `auth-runtime` conceptand they should not collapse all behavior into one monolithic package.

Current priority:

1. TypeScript SDK
2. Kotlin SDK
3. Swift SDK

## Top-Level Decisions

- client SDKs stay separate from server route orchestration concepts
- public packages are split by auth context or capability
- default exports remain framework-neutral
- framework adapters are exposed through subpath exports in the same package
- TypeScript packages are `ESM only`
- global polyfills are not bundled by default
- packages should be side-effect free by default; any side effect must be mounted or initialized explicitly by the user

## Terminology and Naming

Do not reuse `core` for the shared client base layer.

Reason:

- `securitydept-core` already means the Rust-side re-export aggregation crate
- using `client-core` on the client side would create conflicting meanings in the same workspace

Current terms:

- `client`: top-level user-facing aggregate entry
- `foundation`: shared client infrastructure layerusually better as an internal/workspace term than as the main public package name
- `basic-auth-context-client`: Basic Auth zone-aware helper package
- `session-context-client`: session-mode client package
- `token-set-context-client`: token-set-mode client package

For protocol-like contractsnaming currently follows a `Trait` style to avoid confusion with future global names or standard objects.

Examples:

- `ReadableSignalTrait`
- `WritableSignalTrait`
- `ComputedSignalTrait`
- `EventStreamTrait`
- `EventSubscriptionTrait`
- `LoggerTrait`
- `CancellationTokenTrait`
- `CancellationTokenSourceTrait`

## Packaging Style

SecurityDept client SDKs should follow a TanStack-like package style:

- split public packages by auth context or capability
- keep the default surface framework-neutral
- expose framework adapters through dedicated independent packages
- do not create extra framework aggregate packages such as `@securitydept/react-client`

TypeScript examples:

- `@securitydept/client`
- `@securitydept/client/web`
- `@securitydept/client/persistence`
- `@securitydept/client/persistence/web`
- `@securitydept/basic-auth-context-client`
- `@securitydept/basic-auth-context-client-react`
- `@securitydept/basic-auth-context-client-angular`
- `@securitydept/basic-auth-context-client/web`
- `@securitydept/session-context-client`
- `@securitydept/session-context-client-react`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client/frontend-oidc-mode`
- `@securitydept/token-set-context-client/backend-oidc-mode`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-angular`

For npm packages that expose React adapters:

- keep `react` and related libraries in `peerDependencies`
- mark them as optional when the base package still works without the adapter
- keep the root export free of mandatory framework dependencies

## Recommended Repository Layout

Client SDKs should live in a library workspace separate from `webui`.

Current recommended shape:

```text
sdks/
  ts/
    tsconfig.json
    packages/
      client/
      basic-auth-context-client/
      session-context-client/
      token-set-context-client/
      test-utils/
  kotlin/
    ...
  swift/
    ...
```

Current TypeScript build direction:

- `pnpm workspace`
- `tsconfig references`
- `tsc -b`
- `tsdown`

`apps/webui` should keep using Vitebut Vite should not become the primary build pipeline for SDK packages.

<a id="typescript-sdk-coding-standards"></a>
## TypeScript SDK Coding Standards

These rules apply to all TypeScript packages under `sdks/ts/`. They are summarized in `AGENTS.md`; this section provides the full rationale for reference and review.

### Enum-like String Domains

For string-valued constants with a bounded domain, prefer:

```ts
export const Foo = {
  Bar: "bar",
  Baz: "baz",
} as const;
export type Foo = (typeof Foo)[keyof typeof Foo];
```

This keeps runtime output simple (plain object, no class), stays maximally compatible with JS consumers and string protocols (JSON, discriminants), and still gives strong TypeScript completions and exhaustiveness checking.

Avoid TypeScript `enum` — it emits a runtime IIFE, interops poorly with `isolatedModules`, and confuses `as const` narrowing.

### Named Constants for Public Contracts

For public contracts, high-frequency discriminants, and repeated telemetry vocabulary with stable meaning, extract named constants instead of scattering raw strings. Examples: error `code` strings, trace event names, log scope tags.

Do this when it improves consistency and discoverability. Do **not** apply it mechanically — one-off UI copy or ad-hoc local text stays inline.

### API Shape: Options Object First

<a id="ts-sdk-api-shape"></a>

Public SDK functions default to an **`options` object** for any optional parameter set.

A bare positional second parameter is only acceptable when **both** conditions hold:

1. The parameter's semantics are self-evident without a name (e.g., a simple string key or a required primary value).
2. It is the sole high-frequency argument that yields clear ergonomic benefit at the call site.

A single optional field from a wider options bucket does **not** qualify as a positional overload just because it was historically the only parameter.

**When an existing API is widened** with new options that cannot be expressed positionally, convert the entire second argument to an options object — even if it is a breaking change. This is the intentional direction for the SDK surface.

**Rationale — established in Iteration 76:**  
`resetBackendOidcModeBrowserState` previously took `(client, callbackFragmentStore?)`. When `callbackFragmentKey` and `sessionStore` were added, the second parameter was converted to `(client, options?)`. `callbackFragmentStore` is an `EphemeralFlowStore<string>` — an options-bucket field, not a self-evident positional value — so it does not meet the positional exception threshold. The resulting breaking change was accepted as an intentional API style unification.

## Foundation Design

`foundation` is the shared design and infrastructure layer. It should not own auth-context-specific state machines.

It should own:

- state primitives
- event primitives
- transport abstractions
- persistence abstractions
- configuration layering
- scheduling and clock abstractions
- error model
- cancellation and disposal
- logging and tracing
- schema integration points

### State Primitives

State semantics should lean toward TC39 `signals`while the public API remains a thin SDK-defined protocol layer.

Current minimal direction:

```ts
interface ReadableSignalTrait<T> {
  get(): T
  subscribe(listener: () => void): () => void
}

interface WritableSignalTrait<T> extends ReadableSignalTrait<T> {
  set(value: T): void
}

interface ComputedSignalTrait<T> extends ReadableSignalTrait<T> {}
```

Principles:

- snapshot-first
- immutable snapshots
- readonly public views by default
- state transitions owned by clients/services

### Event Primitives

Event semantics should lean toward `observable`but the SDK must not expose one concrete library type directly.

Current minimal direction:

```ts
interface EventSubscriptionTrait {
  unsubscribe(): void
}

interface EventObserver<T> {
  next?(value: T): void
  error?(error: unknown): void
  complete?(): void
}

interface EventStreamTrait<T> {
  subscribe(observer: EventObserver<T>): EventSubscriptionTrait
}
```

The public design should keep:

- a minimal event protocol
- a minimal operator set
- structured event envelopes

### Transport

Do not model interceptors as middleware APIs tied to one HTTP client.  
Foundation should only define a neutral transport protocol.

Current direction:

```ts
interface HttpRequest {
  url: string
  method: string
  headers: Record<stringstring>
  body?: unknown
}

interface HttpResponse {
  status: number
  headers: Record<stringstring>
  body?: unknown
}

interface HttpTransport {
  execute(request: HttpRequest): Promise<HttpResponse>
}
```

`401`redirectand reauthentication handling belong to auth runtime policynot to transport itself.

### Persistence

Persistence must not be reduced to a generic KV wrapper. It should distinguish:

- long-lived state
- recoverable state
- ephemeral flow state

Current direction:

```ts
interface RecordStore {
  get(key: string): Promise<string | null>
  set(key: stringvalue: string): Promise<void>
  remove(key: string): Promise<void>
}

interface Codec<T> {
  encode(value: T): string
  decode(raw: string): T
}

interface PersistentAuthStore<T> {
  load(): Promise<T | null>
  save(value: T): Promise<void>
  clear(): Promise<void>
}

interface RecoverableStateStore<T> {
  load(): Promise<T | null>
  save(value: T): Promise<void>
  clear(): Promise<void>
}

interface EphemeralFlowStore<T> {
  load(): Promise<T | null>
  save(value: T): Promise<void>
  consume(): Promise<T | null>
  clear(): Promise<void>
}
```

Suggested exports:

- `@securitydept/client/persistence`
- `@securitydept/client/persistence/web`

### Auth Coordination

The auth coordination subpath (`@securitydept/client/auth-coordination`) is the canonical owner of the shared, protocol-agnostic requirement orchestration primitives.

It provides:

- `RequirementPlanner` — headless multi-requirement sequencer (session, OIDC, custom). Requirements are identified by `id` + `kind`, where `kind` is an opaque `string`. Each auth-context or adopter project defines its own named kind constants.
- `RouteRequirementOrchestrator` — route-level glue that maps a matched route chain (`RouteMatchNode[]`) to a `RequirementPlanner` instance, preserving shared-prefix resolutions across route transitions.
- `PlannerHost` / `createPlannerHost()` — host-layer coordination contract for multi-requirement auth guards. Evaluates a set of `AuthGuardClientOption` candidates and selects the next pending one to act on. Supports pluggable candidate selection strategies (default: sequential first-unauthenticated; custom: e.g. chooser UI popup).
- `RequirementsClientSet` / `ScopedRequirementsClientSet` — composable requirement collections with `inherit` / `merge` / `replace` composition semantics for parent-child scope hierarchies.
- `resolveEffectiveClientSet()` — resolves parent + child composition into the effective set.
- Shared types: `AuthRequirement`, `AuthGuardClientOption`, `CandidateSelector`, `RouteMatchNode`, `PlanSnapshot`, `PlanStatus`, `ResolutionStatus`, `RequirementPlannerError`, `ChooserDecision`, `RouteOrchestrationSnapshot`, `PlannerHostResult`.

**Framework-specific planner host integrations:**

- **Angular** (`@securitydept/client-angular`): `AUTH_PLANNER_HOST` injection token, `provideAuthPlannerHost()`, `injectPlannerHost()`, route-metadata helpers (`withRouteRequirements()`, `extractFullRouteRequirements()`, `ROUTE_REQUIREMENTS_DATA_KEY`, `ROUTE_REQUIREMENTS_COMPOSITION_DATA_KEY`, `resolveEffectiveRequirements()`), signal/Observable bridge utilities (`bridgeToAngularSignal()`, `signalToObservable()`). `AUTH_REQUIREMENTS_CLIENT_SET` and `provideRouteScopedRequirements()` are retained only as lower-level non-router DI-scope helpers.
- **React** (`@securitydept/client-react`): `AuthPlannerHostProvider`, `useAuthPlannerHost()`, `AuthRequirementsClientSetProvider`, `useEffectiveClientSet()`.

**Why this lives in `@securitydept/client` and not in `token-set-context-client`:**

The planner and orchestrator are protocol-agnostic. Their requirement kind vocabulary (session, OIDC, custom) clearly spans beyond token-set. Hosting them in `token-set-context-client` forced non-token-set adopters (basic-auth, session) to take an unwanted package dependency. `@securitydept/client` is the foundation shared across all auth-context families and is the correct ownership boundary.

Canonical export:

```ts
import {
  createRequirementPlanner,
  createRouteRequirementOrchestrator,
  createPlannerHost,
  resolveEffectiveClientSet,
  RequirementsClientSetComposition,
  PlanStatus,
  ResolutionStatus,
} from "@securitydept/client/auth-coordination";
```

Stability: `provisional` (`provisional-migration-required`). Moved from `@securitydept/token-set-context-client/orchestration` in iteration 102. Planner-host layer added in iteration 104. See [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md) for migration notes.

### Configuration

Configuration should be layerednot flattened into one large options object.

Recommended layers:

- runtime / foundation config
- auth-context config
- adapter / framework config

Example (current real API):

```ts
// Direct client construction (full control)
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";

const client = new BackendOidcModeClient(
  {
    baseUrl: "https://auth.example.com",
    loginPath: "/auth/oidc/login",    // SDK default; adopters may override
    refreshPath: "/auth/oidc/refresh",
    refreshWindowMs: 60_000,
  },
  runtime,
);

// Browser convenience entry (see /backend-oidc-mode/web)
import { createBackendOidcModeBrowserClient } from "@securitydept/token-set-context-client/backend-oidc-mode/web";

const browserClient = createBackendOidcModeBrowserClient({
  baseUrl: "https://auth.example.com",
  loginPath: "/auth/token-set/login", // adopter-specific override
});
```

Validation:

- prefer `@standard-schema`
- do not bind to one concrete validation library

### Scheduling and Unified Input Sources

This topic is not just about timers. It is about unified input sources and scheduling sources.

Foundation should likely provide:

- `fromEventPattern`
- `fromSignal`
- `timer`
- `interval`
- `scheduleAt`
- `fromPromise`

Adapter layers can then provide:

- `fromEventTarget`
- `fromStorageEvent`
- `fromVisibilityChange`
- `fromAbortSignal`

Do not rely on a single giant `setTimeout`.  
Use:

- absolute deadlines
- chunked scheduling
- lifecycle-triggered recalculation

### Internal Dependency Injection

The current direction is not to introduce a formal DI container or `injection-js`.

Preferred direction:

- explicit capability wiring
- a `runtime` bundle
- a small number of composition roots
- internal services composed through explicit `Deps` objects

If complexity truly grows laterconsider a reflection-free typed-token resolver.

## Context Client Design

### `basic-auth-context-client`

This module should stay intentionally thin. Its purpose is not to replace browser-native Basic Authbut to make zone-aware routing and redirect behavior predictable.

Minimum responsibilities:

- define the active Basic Auth zone boundary
- determine whether the current route is inside that zone
- when a protected API inside that zone returns `401`redirect to the zone login URL
- include the current route as `post_auth_redirect_uri` or an equivalent parameter
- expose a logout helper that redirects to the configured zone logout URL

### `session-context-client`

This module is expected to stay relatively thin and mainly cover:

- login trigger helpers
- logout helpers
- `me` endpoint access
- session presence probing
- optional post-login redirect helpers

### `token-set-context-client`

This must stop being treated as one undifferentiated monolith.

The more appropriate next-stage plan is to split the capability behind `token-set-context-client` into two layers:

1. **generic token orchestration / token material layer**
   - combined `access_token` / `id_token` / `refresh_token` snapshots
   - restore / clear / refresh scheduling
   - persistence, tracing, and transport projection
   - this layer should not care whether the tokens came from:
     - standard frontend OIDC
     - standard backend OIDC resource server
     - the `token-set-context` sealed metadata flow

2. **backend-oidc-mediated browser adapter**
   - callback returns parsing
   - sealed metadata-specific redirect flow
   - metadata fallback
   - flow-state / redirect-recovery storage

Read the current heavy module responsibilities accordingly:

- **generic token orchestration layer**
  - token snapshot / delta merge rules
  - persistence adapters
  - refresh scheduling
  - bearer header injection helpers
  - refresh failure recovery policy
- **backend-oidc-mediated browser adapter layer**
  - callback returns parsing
  - metadata fallback flow
  - sealed metadata-specific recovery behavior

And do not keep assuming that it should also own:

- multi-provider or multi-source management
- route-level orchestration
- chooser UI / app policy

One extra clarification: the current split between the generic orchestration layer and the OIDC-mediated-specific adapter layer is only an internal module boundary. Outwardlythis now has to be read through two related surfaces:

- the TS frontend runtime surface: `token-set-context-client`
- the Rust crate public surface: `securitydept-token-set-context`

The Rust side should no longer be read as “just a backend crate with a `backend` module.” The adopter-facing shape should instead converge on top-level `*_mode` and shared modules (see [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md)).

#### OIDC Mode Family (replaces "three pillars" terminology)

The primary terminology now uses the unified auth-context / mode layering. Full design: [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md).

##### Product surface

| Surface / Authority | SDK / Crate | Role |
|---|---|---|
| **TS frontend runtime surface** | `token-set-context-client` (TS) | Unified frontend subpath / runtime surface; the canonical target is `/frontend-oidc-mode`, `/backend-oidc-mode`, and `/access-token-substrate` |
| **Rust top-level mode / shared-module public surface** | `securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_mode, access_token_substrate, orchestration, models}` | Unified adopter-facing structure built from formal mode modules plus shared modules |
| **Rust ownership boundary (implementation-layer explanation)** | mode-specific contract ownership, shared substrate ownership | Explains internal ownership without continuing to dictate the first-level public path |

##### Mode overview

| Mode | Who runs OIDC flows | TS SDK subpath | Rust-side authority entry |
|---|---|---|---|
| `frontend-oidc` | Frontend (browser) | `/frontend-oidc-mode` | `securitydept-token-set-context::frontend_oidc_mode` owns formal `Config / ResolvedConfig / ConfigSource / Runtime / Service / ConfigProjection`; it has no backend runtime, but it is now a formal mode module |
| `backend-oidc` | Backend | `/backend-oidc-mode` | `securitydept-token-set-context::backend_oidc_mode` owns the unified backend OIDC capability frameworkfrontend-consumable contractsand the boundary to `access_token_substrate` |

These are legacy terms and have been converged into the canonical public surface:

- `backend-oidc` integrating all preset logic internally
- `/backend-oidc-mode` and `securitydept-token-set-context::backend_oidc_mode` providing the unified communication layer

##### `backend-oidc` presets / profiles

`backend-oidc` currently needs at least these two representative presets:

| Preset / Profile | Meaning | Default capability bundle |
|---|---|---|
| `pure` | minimal backend OIDC baseline | `refresh_material_protection = passthrough`, `metadata_delivery = none`, `post_auth_redirect_policy = caller_validated` |
| `mediated` | custody / policy augmentation | `refresh_material_protection = sealed`, `metadata_delivery = redemption`, `post_auth_redirect_policy = resolved` |

These presets are capability bundles, not additional first-level mode names.

##### Infrastructure layer (implementation crates)

The following crates are internal implementation details. Adopters should not need to depend on them directly. They serve the whole Rust public surface rather than one extra pure / mediated branch:

| Crate | Scope |
|---|---|
| `securitydept-oauth-provider` | OIDC discovery, JWKS, metadata refresh, `OidcSharedConfig` |
| `securitydept-oidc-client` | OIDC authorization-code / device flows plus shared `user_info` protocol composition |
| `securitydept-oauth-resource-server` | JWT verification, introspection |

#### `frontend-oidc`: Frontend Pure OIDC Client

- Frontend handles authorize/callback/token-exchange via `oauth4webapi` (official base)
- The Rust backend does **not** run the OIDC redirect/callback/token-exchange runtime itself, but the Rust crate still exposes frontend-consumable config and formal `Config / ResolvedConfig / ConfigSource / Runtime / Service / ConfigProjection` through `securitydept-token-set-context::frontend_oidc_mode`
- `oidc-client-ts` serves as comparison/reference case (`devDependency` only)

Dependency strategy:
- `oauth4webapi`: official base, `optional peerDependency` + `devDependency`; adopters using `/frontend-oidc-mode` must install it
- `oidc-client-ts`: comparison case, `devDependency` only; no installation requirement for adopters

#### `backend-oidc`: Unified backend OIDC capability framework

`backend-oidc` should no longer be interpreted as “pure and mediated as two long-lived peer modes”. It should be treated as one unified backend framework:

- the backend runs a standard OIDC clientresource-server verifier
- OIDC protocol-level orchestration should be pushed down into `securitydept-oidc-client` where practical
- browser-facing callback / refresh contracts should converge on unified mode-qualified contracts
- `user-info` retrieval is a baseline `backend-oidc` behavior; its protocol core should be shared through `securitydept-oidc-client` rather than duplicated per preset
- `metadata_redemption` is an independent payload delivery mechanismwhereas user-info retrieval is an inherent baseline behavior
- resource-serverpropagationand forwarder remain shared substrate concerns rather than preset-owned runtime identity

The public reading should therefore be:

- `backend-oidc-mode` is the canonical target for frontend consumption of `backend-oidc`
- pure / mediated remain capability presets / profilesnot separate TS subpath families

#### Shared Configuration Model

`oidc-client` and `oauth-resource-server` share provider connectivity config via `OidcSharedConfig` (`securitydept-oauth-provider`). More accurately`OidcSharedConfig` should be read as the shared OIDC configuration authority for the whole Rust crate public surfacenot as an internal detail of one `backend` namespace. See the `token-set-context` section in [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md).

#### Current Rust Authority Surface

The Rust public surface has now converged on:

- `frontend_oidc_mode`
- `backend_oidc_mode`
- `access_token_substrate`
- `orchestration`
- `models`

Within that shape:

- `frontend-oidc` config rules  belong to `frontend_oidc_mode`
- `backend-oidc` query / payload / callback/refresh return / redemption / user-info contracts belong to `backend_oidc_mode`
- preset-specific augmentation such as metadata fallbackrefresh-material protectionand redirect resolution remains internal to `backend-oidc`
- resource-server verificationpropagationand forwarder remain shared `access_token_substrate` concerns
- `TokenPropagation` is better modeled as an `access_token_substrate` capability than as a `backend_oidc_mode` axis
- the substrate runtime should continue to converge on `AccessTokenSubstrateConfig` / `AccessTokenSubstrateRuntime`
- the forwarder should not be embedded directly into `TokenPropagation`; the cleaner direction is to layer it above the substrate runtime through `PropagationForwarderConfigSource` and `PropagationForwarder`

#### Cross-mode Constraints

- The OIDC mode family now has two formal modes: `frontend-oidc` and `backend-oidc`
- The TS frontend product surface is `/frontend-oidc-mode`, `/backend-oidc-mode`, `/access-token-substrate`, and `/orchestration`
- `/orchestration` is shared infrastructurenot a replacement for any mode
- Different modes / presets should reuse the same token lifecyclepersistenceand transport semantics
- No dual-authority ownership within a single token family

#### Mixed Custody and BFF Boundary

Mixed-custody must be recognized:

- `browser-owned token family`
- `bff-owned token family`

The same token family must not be owned concurrently by browser and BFF.  
Mixed-custody should appear in the formal designbut it must be clearly marked as:

- an important boundary
- high complexity
- not fully implemented in v1

#### Multi-OIDC-Client / Multi-Requirement Route Orchestration Boundary

Another downstream-adopter scenario must also be considered:

- a single frontend host talks to multiple backend services
- different backend services may use different OIDC clients / audiences / scope sets
- one frontend route area may require credentials for both `app1` and `app2`

The hard problem in this scenario is not only “how to get tokens”but also:

- which requirements can be satisfied silently
- which requirements require interactive redirect
- whether multiple interactive requirements should produce a user-choice step first
- how remaining requirements resume after callback recovery

Current recommended direction:

- the auth stack may eventually grow **headless orchestration primitives / scheduler direction**
- on the frontend side`token-set-context-client` or a future layer above it may own pending-requirement / callback-recovery state-machine concerns; on the backend side`securitydept-token-set-context` mode family boundaries need to stay aligned
- chooser UIrouter policyand product-facing interaction steps should remain in adopter-owned app glue

The current status should stay explicit:

- this is a high-value downstream reference-case direction that should inform future auth stack design (frontend `token-set-context-client`, backend `securitydept-token-set-context`)
- but it is **not part of the currently verified v1 contract**

## SSR / Server-Side Support

In this guide, "server-side support" means TypeScript SDK behavior for SSR /
server-render hosts and server request / response handling boundaries. It does
not mean Rust route-facing service crates.

Server-side support should not mean "a separate server-only client core". It
should still build on the same portable capability model.

The frontend `token-set-context-client` orchestration / lifecycle substrate (token snapshot, persistence, transport projection) is designed as cross-mode shared infrastructure. The Rust crate `securitydept-token-set-context` is better read as:

- `frontend_oidc_mode`
- `backend_oidc_mode`
- `access_token_substrate`
- `backend_oidc_mode`
- `orchestration`
- `models`

Within that structure, each `*_mode` module owns the config / contract / runtime entry for its mode, while `access_token_substrate` owns the shared resource-server / propagation / forwarder substrate together with `TokenPropagation`, `AccessTokenSubstrateConfig`, `AccessTokenSubstrateRuntime`, and the forwarder trait boundary; `orchestration` / `models` carry only truly shared abstractions.

### `basic-auth-context` and `session-context`

They should support redirect-aware SSR / server request handling.

This is a direction for the TS SDK surface, not a statement that the current
SDK already ships a fully productized SSR helper layer.

The core is not browser navigation. The core is a neutral redirect instruction:

```ts
export const AuthGuardResultKind = {
  Ok: "ok",
  Redirect: "redirect",
} as const

export const AuthGuardRedirectStatus = {
  Found: 302,
  SeeOther: 303,
  TemporaryRedirect: 307,
} as const

type AuthGuardResult<T> =
  | { kind: typeof AuthGuardResultKind.Ok; value: T }
  | {
      kind: typeof AuthGuardResultKind.Redirect
      status: (typeof AuthGuardRedirectStatus)[keyof typeof AuthGuardRedirectStatus]
      location: string
    }
```

### `token-set-context`

Server-side support should be treated as a higher-levelstateful BFF mode rather than as a small SSR extension.

Principles:

- server-side `token-set-context` support is provisional
- SSR / BFF should consume `bff-owned` token families only
- for sensitive third-party tokensavoid making the BFF hold raw access tokens whenever possible

## Error Model

The client should not rely on a flat single-layer `Error` model.  
A two-layer model is preferred:

- machine-facing runtime error
- user-facing presentation / recovery hint

Current server-aligned base contract:

```ts
export const UserRecovery = {
  None: "none",
  Retry: "retry",
  RestartFlow: "restart_flow",
  Reauthenticate: "reauthenticate",
  ContactSupport: "contact_support",
} as const

type UserRecovery = (typeof UserRecovery)[keyof typeof UserRecovery]

interface ErrorPresentation {
  code: string
  message: string
  recovery: UserRecovery
}
```

Current principles:

- preserve server-returned `error: { codemessagerecovery }` when available
- `code` is the stable cross-layer contract; `message` is not
- prefer exported `const objecttype alias` contracts such as `UserRecovery``ClientErrorKind``AuthGuardResultKind`and `BackendOidcModeBootstrapSource` over raw string unions or TypeScript `enum`
- preserve `cause` and structured context
- redirect / reauthenticate flows should not always be modeled as ordinary exceptions

## Cancellation and Disposal

Cancellation and resource disposal must be first-class core concerns.

Current direction:

```ts
interface DisposableTrait {
  dispose(): void
}

interface CancelableHandle {
  cancel(): void
}

interface CancellationTokenTrait {
  readonly isCancellationRequested: boolean
  readonly reason?: unknown
  onCancellationRequested(listener: (reason: unknown) => void): DisposableTrait
  throwIfCancellationRequested(): void
}

interface CancellationTokenSourceTrait extends DisposableTrait {
  readonly token: CancellationTokenTrait
  cancel(reason?: unknown): void
}
```

Principles:

- `CancelableHandle` is mainly for resource handles
- clients should own a root cancellation source
- `dispose()` should:
  - cancel the root source
  - clean up scheduler handles / subscriptions / watchers
  - prevent new operations from starting
- `AbortSignal` is better treated as a web interop bridgenot as the only core cancellation primitive

## LoggingTracingand Testing

Foundation should formally provide an observability layer:

- `LoggerTrait`
- `TraceEventSinkTrait`
- `OperationTracerTrait`

Principles:

- leave room for an OpenTelemetry bridgebut do not bind the default core to OTel directly
- timeline / trace sinks are the primary observation surface for behavior testsnot plain text logs

Testing should be layered:

1. protocol and primitive tests
2. runtime orchestration tests
3. auth client tests
4. adapter tests
5. scenario / regression tests

Preferred test utilities:

- `FakeClock`
- `FakeScheduler`
- `FakeTransport`
- `InMemoryPersistence`
- `InMemoryTraceCollector`

## BuildCompatibilityand Side Effects

### Output and Compatibility

- `ESM only`
- full type declarations
- no default CJS support
- foundation compatibility is described mainly in terms of ECMAScript / JS built-in requirements
- host-specific requirements are described through adapter capability requirements
- do not maintain a caniuse-style all-platform support table
- do describe verified environments separately

### Polyfills

- do not bundle or auto-install global polyfills by default
- do not patch `globalThis` by default
- prefer capability injection over polyfills
- where neededprefer ponyfills or opt-in helpers

### sideEffects / Tree Shaking

- tree shaking is a design goal
- the SDK should be side-effect free by default
- any side effect must require explicit user mounting or initialization
- imports must not automatically trigger schedulingstorage restoreredirectsloggingtracingor polyfills
- `sideEffects: false` should be the target capabilitynot a late packaging patch

## API Stability

Not all public exports should be treated as equally stable.  
The current design should distinguish at least:

- `stable`
- `provisional`
- `experimental`

Prefer `stable` for:

- foundation base protocols
- the main entry points and core APIs of each context client

Prefer `provisional` for:

- advanced `token-set-context` behavior
- future server adapters
- mixed-custody / BFF high-complexity strategies

Prefer `experimental` for:

- advanced event operators
- advanced DI helpers
- debug / OTel bridge helpers

Subpath exports are also public contract.

### Current 0.x Freeze Semantics

In the current 0.x TypeScript SDK stage, `stable / provisional / experimental` should be read with explicit release semantics, not as loose adjectives:

- `stable`
  - Meaning: the current public contract is ready to be depended on directly by external consumers
  - Allowed change: additive capability, backward-compatible convenience, documentation clarification, and internal refactors
  - Should not happen: silent responsibility shifts between layers, entry-path churn, or changes that invalidate the documented minimal entry path
  - Current basis: the root capability boundary is clear, minimal entry paths are explainable, ordinary usage does not rely on reference-app-only glue, and there are already narrow guardrails around exports/build/public vocabulary
- `provisional`
  - Meaning: publicly usable and intentionally exported, but still managed as a freezing adapter/capability boundary rather than a settled release-grade surface
  - Allowed change: lifecycle hardening, additive convenience, more focused automation, and clearer capability requirements
  - Still risky: frequent entry-shape churn, pulling app glue back into adapters, or promoting to `stable` before the evidence changes
  - Current basis: the subpaths are real and usable, but ordinary usage still depends more heavily on capability requirements, adapter-owned lifecycle boundaries, and focused evidence
- `experimental`
  - Meaning: exposed mainly for testing, demos, or exploration, not as a publishable stability promise
  - Allowed change: renaming, reshaping, replacement, or removal
  - Current basis: these surfaces primarily serve tests/demo/workbench scenarios rather than core adopter-facing integration

The important distinction is:

- `stable` answers what is already a v1-candidate external contract
- `provisional` answers what is public and usable, but still under a stricter freeze bar
- `experimental` answers what is still mainly for internal validation rather than external promise

### Current Contract Snapshot

This is the current working contract map for the TypeScript SDK. It keeps the main stability, capability, and boundary judgment in one place so later sections can reference it instead of restating it.

This table uses canonical mode-aligned names as the target contract.  
If implementation is still migrating, this table takes precedence over leftover legacy shapes.

| Package / Subpath | Stability | Host / Capability Requirement | Current Reading |
|---|---|---|---|
| `@securitydept/client` | `stable` | No DOM, no implicit `fetch`; caller provides transport/runtime | Foundation root export |
| `@securitydept/client/persistence` | `stable` | No browser storage; in-memory stores, codecs, and protocols remain foundation | Foundation persistence capability |
| `@securitydept/client/web` | `stable` ¹ | `fetch` / `AbortSignal`; browser convenience without side effects | Foundation-owned capability adapter |
| `@securitydept/client/persistence/web` | `stable` ¹ | Web-storage semantics; inject custom store if unavailable | Foundation-owned storage adapter |
| `@securitydept/basic-auth-context-client` | `stable` | No React; redirect convenience stays in `./web` | Basic-auth root contract |
| `@securitydept/basic-auth-context-client/web` | `provisional` | `location` / redirect semantics | Auth-context browser adapter; `loginWithRedirect` zone-aware convenience + named `LoginWithRedirectOptions` |
| `@securitydept/basic-auth-context-client-react` | `provisional` | React runtime | React adapter |
| `@securitydept/basic-auth-context-client-angular` | `provisional` | Angular 17+ `@angular/core` InjectionToken + service | Angular adapter: `BASIC_AUTH_CONTEXT_CLIENT` token, `provideBasicAuthContext()`, `BasicAuthContextService` |
| `@securitydept/session-context-client` | `stable` | Transport / cancellation; login redirect flow is not SDK surface | Session root contract |
| `@securitydept/session-context-client-react` | `provisional` | React runtime | React adapter; `SessionContextValue` exported for type-level reference |
| `@securitydept/session-context-client-angular` | `provisional` | Angular 17+ `@angular/core` InjectionToken + signal state | Angular adapter: `SESSION_CONTEXT_CLIENT` token, `provideSessionContext()`, `SessionContextService` with signal |
| `@securitydept/token-set-context-client/backend-oidc-mode` | `provisional` ² | Backend OIDC capability negotiation, callback / refresh transport contracts, preset/profile introspection, persistence / traceSink | **Canonical frontend-facing entry** for consuming `backend-oidc` |
| `@securitydept/token-set-context-client/backend-oidc-mode/web` | `provisional` | `location` / `history` / `fetch` / flow-state storage | Canonical browser-adapter subpath for consuming `backend-oidc` |
| `@securitydept/token-set-context-client-react` | `provisional` | React runtime | Canonical React-adapter package for consuming `backend-oidc` |
| `@securitydept/token-set-context-client/orchestration` | `provisional` ³ | No backend-oidc preset-specific sealed-flow fields; protocol-agnostic token snapshot / persistence / transport / `AuthMaterialController` thin control layer | Shared token lifecycle substrate **explicit subpath entry** (recommended for protocol-agnostic usage; not a complete mode/flow entry) |
| `@securitydept/token-set-context-client-angular` | `provisional` ⁶ | Angular 17+ Signal / RxJS / HttpClient / DI / callback lifecycle; duck-typed, no build-time `@angular/*` or `rxjs` dep | Angular integration family: signal bridge, Observable bridge, bearer interceptor, provider lifecycle, callback resume. Route adapter now in `@securitydept/client-angular` |
| `@securitydept/client-react/tanstack-router` | `provisional` | `@tanstack/react-router` matched routes; duck-typed, no build-time dep | **Canonical** TanStack React Router route-security contract. Canonical adopter-facing entry: `createSecureBeforeLoad()` (beforeLoad factory, wires runtime policy into router execution) + `withTanStackRouteRequirements()` (child route serializable declaration). Lower-level: `extractTanStackRouteRequirements()`, `createTanStackRouteSecurityPolicy()`, `projectTanStackRouteMatches()`, `createTanStackRouteActivator()` |
| `@securitydept/client-angular` | `provisional` | Angular `@angular/router` `ActivatedRouteSnapshot`; duck-typed, no runtime dep | **Canonical** Angular Router projection adapter (`AuthRouteAdapter`); no token-set policy |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | `provisional` ⁴ | Frontend pure OIDC client (`frontend-oidc` mode); based on `oauth4webapi`; provides a full browser client, `ConfigProjection` adapter, claims check, refresh, and `userInfo()` | `frontend-oidc` **mode-aligned explicit subpath entry** |
| `@securitydept/token-set-context-client/access-token-substrate` | `provisional` ⁵ | Access-token substrate vocabulary, `TokenPropagation` capability, and integration info aligned with Rust `access_token_substrate` | shared substrate **explicit subpath entry** |
| `@securitydept/test-utils` | `experimental` | Fake clock / scheduler / transport / trace collector | Test/demo infra |

¹ Adapter subpaths default to `provisional`, but `@securitydept/client/web` and `@securitydept/client/persistence/web` are intentional `stable` exceptions because they remain foundation-owned capability adapters: narrow responsibility, no product semantics, and only wire foundation protocols to host capabilities.

² `/backend-oidc-mode*` is the canonical target contract in this document. It already exists as the real exported subpath family; its stability remains `provisional` because the capability / adapter surface is still freezing, not because it still depends on other transitional subpaths.

³ The orchestration capability is accessible via the explicit `@securitydept/token-set-context-client/orchestration` subpath. It lives inside the same npm package, not a separate package. Adopters can use `AuthMaterialController` (thin lifecycle controller) and its `applyDelta()` externally-driven update entry, or individual low-level helpers such as `bearerHeader`, `createAuthStatePersistence`, and `createAuthorizedTransport`. The controller only owns token material lifecycle; it does not provide acquisition, redirect, or refresh scheduling. By itself it is not a complete mode or complete flow entry; it is the shared token-lifecycle substrate inside the frontend product surface, reused by subpaths such as `/backend-oidc-mode` and `/frontend-oidc-mode`, while remaining aligned with the higher-level auth-context / mode layering. The official frontend OIDC wrapping uses `oauth4webapi`; `oidc-client-ts` serves as a comparison case (see [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md)). Stability is still freezing-in-progress (`provisional`): publicly accessible with an explicit entry, but not a full `stable` promise.

⁴ The `/frontend-oidc-mode` subpath implements `frontend-oidc` mode with `oauth4webapi` as the official base. It is currently `provisional`: it has an explicit entry, browser runtime, Rust-aligned `ConfigProjection`, and richer client APIs such as claims check, refresh, and `userInfo()`. Adopters using `/frontend-oidc-mode` must install `oauth4webapi` (`optional peerDependency`).

⁵ The `/access-token-substrate` subpath carries shared access-token substrate vocabulary. It is not another mode; it is the shared contract surface aligned with Rust `securitydept-token-set-context::access_token_substrate`.

⁶ The `-angular` package is the Angular integration family. Unlike the per-concern React adapters (`-react` package on each client family), Angular needs a cohesive entry covering five integration dimensions: SDK signal → Angular Signal bridging, SDK signal → RxJS Observable bridging, bearer token injection via Angular `HttpInterceptorFn`, provider lifecycle management (construct + auto-dispose on `DestroyRef`), and OIDC callback resume helpers. All interfaces are duck-typed; no `@angular/*` or `rxjs` build-time dependency is required.

Shared reading rules:

- `stable` means the current public contract is already explainable as a 0.x external contract, even though additive evolution may still happen
- `provisional` means public and usable, but still under a stricter adapter freeze bar
- `experimental` means test/demo/workbench-facing rather than adopter-facing
- automation currently locks export maps, `sideEffects: false`, and build entry alignment; stability labels themselves remain a documentation-layer judgment

#### How To Read `token-set-context-client` Subpaths

Read `@securitydept/token-set-context-client` first as the **frontend product surface**, then read its internal subpath family:

- root (`.`) and legacy `./web` / `./react` bridges have been removed and no longer exist in the package exports
- `/backend-oidc-mode*` is the canonical family for frontend consumption of `backend-oidc`
- `/frontend-oidc-mode` is the mode-aligned frontend implementation subpath for `frontend-oidc`
- `/access-token-substrate` is the explicit shared contract entry for access-token substrate
- `/orchestration` is shared token-lifecycle substrate, not a complete mode or complete flow
- the OIDC mode family lives at the cross-stack design layer; the subpath family lives inside the frontend product surface, so they should not be read as the same axis
- the Rust side should likewise converge on top-level `*_mode` / shared modules; TS subpaths and Rust crate modules should describe the same mode/shared boundaries

#### Capability Boundary Rules

Use these rules to answer "which layer owns this capability?" without rereading the whole guide:

- **redirect / location / history** → `./web` subpaths or app glue, not foundation root exports
- **fetch / AbortSignal** → foundation transport can express cancellation; browser convenience stays in `./web`
- **persistence / web storage** → protocols & codecs are foundation; `localStorage` / `sessionStorage` adapters belong in `persistence/web`
- **React state / subscription** → independent `-react` packages, not root exports
- **traceSink / lifecycle trace** → SDK contract
- **trace timeline UI / DOM harnesses / propagation probes / business helpers** → reference app glue, not SDK surface

#### token-set-context-client Frontend Subpath / Abstraction Split

Based on the current `outposts` single-provider / single-app integration against `oauth-resource-server`, `token-set-context-client` has introduced a clearer internal module boundary:

- **generic token orchestration** (`src/orchestration/`)
  - owns combined `access_token` / `id_token` / `refresh_token` state
  - owns restore / refresh / persistence / disposal / transport projection
  - does not need to know whether the token source is standard OIDC, backend-issued OIDC, or one particular backend-oidc preset
- **backend-oidc adapter**
  - owns callback returns, refresh payloads, metadata fallback, and unified OIDC metadata fallback
  - understands preset augmentation such as sealed / redemption only when the active capability bundle requires it, while the public surface stays unified under `backend-oidc-mode*`

First internal module slice delivered:

| Internal Module | Contents |
|---|---|
| `orchestration/types.ts` | `TokenSnapshot`, `TokenDelta`, `AuthSnapshot`, `AuthPrincipal`, `AuthSource` — protocol-agnostic types |
| `orchestration/token-ops.ts` | `mergeTokenDelta()`, `bearerHeader()` |
| `orchestration/persistence.ts` | `createAuthStatePersistence()` and strongly typed config `CreateAuthStatePersistenceOptions` |
| `orchestration/auth-transport.ts` | `createAuthorizedTransport()` |
| `orchestration/controller.ts` | `AuthMaterialController` / `createAuthMaterialController()` — thin control layer composing snapshot read/write, persistence, bearer projection, and transport; provides `applyDelta()` for externally-driven renew/update |
| `frontend-oidc-mode/types.ts` | `FrontendOidcModeClientConfig` / `FrontendOidcModeTokenResult` / `FrontendOidcModeAuthorizeResult` / `FrontendOidcModeUserInfo` — browser runtime config and protocol vocabulary |
| `frontend-oidc-mode/client.ts` | `createFrontendOidcModeClient()` / `FrontendOidcModeClient` — wraps `oauth4webapi` for standard browser OIDC Authorization Code + PKCE flow |
| `frontend-oidc-mode/contracts.ts` | `FrontendOidcModeConfigProjection` — Rust-aligned config projection plus adapters (`configProjectionToClientConfig`, `tokenResultToAuthSnapshot`) |
| `frontend-oidc-mode/config-source.ts` | `ConfigProjectionSource*` — async config projection source contract: source types (`inline`, `network`, `persisted`, `bootstrap_script`), `resolveConfigProjection()` precedence resolver, `ClientReadinessState`, and `networkConfigSource()` convenience helper |
| `access-token-substrate/contracts.ts` | `TokenPropagation` / `AccessTokenSubstrateIntegrationInfo` — shared substrate vocabulary |
| `backend-oidc-mode/contracts.ts` | `BackendOidcModeCapabilities` / `BackendOidcModePreset` / `BackendOidcModeCallbackReturns` / `BackendOidcModeRefreshReturns` / `BackendOidcModeRefreshPayload` / `BackendOidcModeRefreshResult` / `BackendOidcModeUserInfoRequest` / `BackendOidcModeUserInfoResponse`; plus parsers and orchestration adapters |

Existing v1 types such as `AuthTokenSnapshot` and `AuthStateSnapshot` are now re-export aliases of the orchestration types, fully backward compatible.

#### Config Projection Source Contract (`frontend-oidc-mode/config-source.ts`)

The `frontend-oidc-mode` subpath now owns a formal **async config projection source** contract. This is a core/shared capability — not an Angular-only or React-only concern.

**Problem solved**: Before this contract, adopters who wanted to fetch their OIDC client config from a backend endpoint (e.g. `/api/auth/config`) had to create app-local workarounds (Angular `APP_INITIALIZER` + closure hack, React `useEffect` + context). These hacks leaked SDK ownership to the adopter layer and prevented framework adapters from expressing readiness semantics properly.

**Source types** (`ConfigProjectionSourceKind`):

| Source Kind | Resolution | Use Case |
|---|---|---|
| `inline` | Sync — config provided at registration time | Hardcoded config, test environments |
| `network` | Async — fetches from backend endpoint | Production backend-driven config projection |
| `persisted` | Async — restores from localStorage/sessionStorage | Offline-first, warm restart optimization |
| `bootstrap_script` | Sync — reads from `window.__BOOTSTRAP__` globals | SSR-injected config, CDN edge config |

**Resolution semantics** (`resolveConfigProjection(sources[])`):
- Sources are tried in declaration order (highest priority first)
- First successful source wins; failures skip to next with diagnostic logging
- All sources exhausted → throws with diagnostic summary
- Results include `sourceKind` for telemetry and caching decisions

**Readiness state** (`ClientReadinessState`):
- `not_initialized` → `initializing` → `ready` | `failed`
- Both the Angular and React adapters now surface this state through the shared `@securitydept/token-set-context-client/registry` core
- React `useTokenSetCallbackResume` / `TokenSetCallbackOutlet` drive the canonical callback path through `registry.whenReady(clientKey)` before invoking `handleCallback()`, so async / lazy clients are materialised on demand rather than silently dropped (iteration 110 review-1 fix)
- Route guards (`createTokenSetRouteAggregationGuard`) and callback service (`CallbackResumeService`) use `registry.whenReady(key)` to await async initialization
- Bearer interceptors intentionally do **not** await readiness — they use `registry.get()` and pass through unauthenticated when the client is not yet ready (guards are the enforcement layer)

**Convenience helper** (`networkConfigSource(options)`):
- Builds a `ConfigProjectionSourceNetwork` from an API endpoint URL
- Constructs the correct `GET /api/auth/config?redirect_uri=...` URL
- Handles HTTP error status and delegates validation to `parseConfigProjection()`

**Canonical usage** (Angular adapter):

```ts
import { resolveConfigProjection, networkConfigSource, createFrontendOidcModeClient }
  from "@securitydept/token-set-context-client/frontend-oidc-mode";

provideTokenSetAuth({
  clients: [{
    key: "main",
    // Async clientFactory — registry tracks readiness automatically
    clientFactory: async () => {
      const resolved = await resolveConfigProjection([
        networkConfigSource({
          apiEndpoint: "https://api.example.com/api",
          redirectUri: `${location.origin}/auth/callback`,
        }),
      ]);
      return createFrontendOidcModeClient(resolved.config, runtime);
    },
    urlPatterns: ["/api/"],
    callbackPath: "/auth/callback",
  }],
});
```

**Key design decisions**:
- Config source resolution is framework-agnostic by design — the `resolveConfigProjection()` / `networkConfigSource()` API lives in the core `frontend-oidc-mode` subpath, not in any framework adapter. Both the Angular adapter (`TokenSetAuthRegistry`) and the React adapter (`TokenSetAuthProvider` + `useTokenSetCallbackResume`) consume it via async `clientFactory`; the React callback path awaits `registry.whenReady(clientKey)` before calling `handleCallback()` so async / lazy clients are driven end-to-end without adopter glue.
- `TokenSetClientEntry.clientFactory` now accepts `() => Promise<OidcModeClient>` in addition to sync return
- `TokenSetAuthRegistry.register()` uses TypeScript overloads to preserve backward-compatible sync return type inference
- Metadata (urlPatterns, callbackPath, requirementKind, providerFamily) is registered eagerly before async resolution completes — lookup dimensions work immediately
- Route guards (`createTokenSetRouteAggregationGuard`) use `registry.whenReady(key)` to await async client materialization before evaluating auth — first protected navigation will block until all relevant clients are ready
- Callback service (`CallbackResumeService`) uses `registry.whenReady(clientKey)` before calling `handleCallback()` — no timing assumption about client readiness
- Bearer interceptors use `registry.get(key)` (not `whenReady`) — explicit design: if a client is still initializing, the request passes through without an `Authorization` header. Guards (not interceptors) are the enforcement point for "client must be ready before the user reaches this route".

Current status:

- `@securitydept/token-set-context-client/orchestration` is the **explicit recommended subpath** for protocol-agnostic usage
- `/orchestration` is the sole entry for protocol-agnostic orchestration exports (the root bridge has been removed)
- these exports are **not** a separate npm package — still inside `@securitydept/token-set-context-client`
- `backend-oidc-mode/contracts.ts` is already part of the canonical frontend-facing contract surface
- `AuthMaterialController` (`createAuthMaterialController()`) is the **thin control layer** entry — it composes snapshot read/write, bearer projection, persistence restore/save/clear, and authorized transport in a single manageable object; see `examples/auth-material-controller-contract.test.ts`
- when to use the controller vs raw helpers:
  - prefer the controller when you want a managed token lifecycle (apply, persist, and transport as a unit)
  - use raw helpers such as `bearerHeader` and `createAuthStatePersistence` for targeted composition where you control the lifecycle yourself
  - the controller does NOT handle acquisition, callback redemption, or refresh scheduling — those remain OIDC-mediated-specific
- `AuthMaterialController.applyDelta()` is the protocol-agnostic entry for externally-driven renew/update:
  - accepts a `TokenDelta` (only the changed fields); internally calls `mergeTokenDelta()` to merge
  - when `options.metadata` is absent, current metadata is preserved (refresh does not change principal)
  - when `options.metadata` is provided, metadata is replaced (re-auth or source change scenarios)
  - auto-saves the merged snapshot to persistence (same as `applySnapshot`)
  - throws if no existing snapshot — `applySnapshot` must be called first for initial token material
- `BackendOidcModeClient` now builds more of its lifecycle on top of the controller:
  - `restoreState()` / `clearState()` / `restorePersistedState()` route through the controller
  - `authorizationHeader()` is served directly by the controller
  - `refresh()` success path routes through `_authMaterial.applyDelta()` for token merge + persistence
  - Methods utilizing configuration objects now declare well-defined options contracts (such as `BackendOidcModeRefreshOptions`, `BackendOidcModeFetchUserInfoOptions`, and `BackendOidcModeMetadataRedemptionOptions`) safely exported from the canonical `backend-oidc-mode` subpath.
- `/orchestration` should no longer be abstracted forward in isolation as the final frontend OIDC answer; the next shape decision should come from `oauth4webapi`, `oidc-client-ts`, and a real Angular host case to calibrate the `frontend-oidc` mode implementation
- for the Angular case, prefer a real downstream host such as `outposts`; its current `angular-auth-oidc-client`-based bridge is migration input, not the template for the SDK's public Angular contract
- the planned official `frontend-oidc` implementation still lives inside `token-set-context-client` (`/frontend-oidc-mode` subpath), wrapping `oauth4webapi` and reusing the same-package orchestration substrate. The backend-facing frontend entry is `/backend-oidc-mode`
- the default expectation is continued evolution through subpaths / additive surface inside the same package, not an immediate split into a parallel package
- the frontend public surface should now be read through the exact mode-aligned canonical subpath family rather than a root bridge:
- `/backend-oidc-mode` — canonical frontend-facing subpath for `backend-oidc` (`provisional`)
- `/backend-oidc-mode/web` — backend-oidc browser-adapter subpath (`provisional`)
- `/orchestration` — shared protocol-agnostic token-lifecycle substrate reused by `/backend-oidc-mode` and `/frontend-oidc-mode` (`provisional`)
- `/frontend-oidc-mode` — mode-aligned frontend subpath for `frontend-oidc`, wrapping `oauth4webapi` and exposing a richer browser client plus `ConfigProjection` adapter and **config projection source contract** (`provisional`)
- `/access-token-substrate` — shared substrate contract subpath aligned with Rust `access_token_substrate` (`provisional`)
- root (`.`) and legacy `./web` / `./react` bridges have been removed; the canonical subpath family is now the only public surface
- the Rust side already exposes top-level `*_mode` / shared modules for frontend-consumable config, cross-boundary contracts, and shared substrate
- dependency semantics:
  - `oauth4webapi` = official base, `optional peerDependency` + `devDependency`
  - `oidc-client-ts` = comparison/reference case, `devDependency` only

### Framework Router Adapters

Route-level auth orchestration requires mapping framework-specific matched route trees into the SDK's `RouteMatchNode[]` contract. The SDK provides dedicated adapter subpaths for supported router frameworks:

| Adapter Path / Package | Framework | Stability | Purpose |
|---|---|---|---|
| `@securitydept/client-react/tanstack-router` | `@tanstack/react-router` | `provisional` | **Canonical owner.** Full route-security contract aligned with Angular sibling. Canonical adopter-facing entry: `createSecureBeforeLoad()` — root-level beforeLoad factory that wires non-serializable runtime policy into TanStack Router execution semantics (throws `redirect` or `RouteSecurityBlockedError`); child routes use `withTanStackRouteRequirements()` for serializable `staticData` declaration only. Full-route aggregation via `extractTanStackRouteRequirements()` with `merge` / `replace` / `inherit` composition. Lower-level primitives: `createTanStackRouteSecurityPolicy()`, `projectTanStackRouteMatches()`, `createTanStackRouteActivator()` |
| `@securitydept/client-angular` | Angular Router | `provisional` | **Canonical owner.** Route-metadata helpers (`withRouteRequirements`, `extractFullRouteRequirements`, `resolveEffectiveRequirements`) with `merge` / `replace` composition; planner-host DI wiring; signal/Observable bridge utilities (`bridgeToAngularSignal`, `signalToObservable`); `AuthRouteAdapter` injectable service |

Design rules:

- Adapters use **duck-typed interfaces** and do **not** introduce build-time dependencies on framework packages (`@tanstack/react-router`, `@angular/router`)
- Adopters bring their own framework dependency; adapters accept structurally compatible objects
- Adapters project and integrate, but **do not** own router lifecycle, navigation, or UI
- The headless orchestration core (`/orchestration`) remains framework-agnostic
- Auth requirements are declared in route configuration (TanStack `staticData`, Angular route `data`) under a well-known key (`authRequirements` by default)

#### Framework adapter independent packages audit (iteration 100 decision)

Framework adapters (both React and Angular) have been split into dedicated npm packages. Angular adapters use `ng-packagr` to generate APF / FESM2022 output, while React adapters use `tsdown`.

| Surface | React adapter package | Angular adapter package | Status |
|---|---|---|---|
| `basic-auth-context-client` | `@securitydept/basic-auth-context-client-react` | `@securitydept/basic-auth-context-client-angular` | **Landed**: React: `BasicAuthContextProvider` + hooks; Angular: `@Injectable()` service + InjectionToken + provideBasicAuthContext() |
| `session-context-client` | `@securitydept/session-context-client-react` | `@securitydept/session-context-client-angular` | **Landed**: React: `SessionContextProvider` + hooks + `SessionContextValue`; Angular: `@Injectable()` service + Angular signal state + provideSessionContext() |
| `token-set-context-client` (cross-mode) | `@securitydept/token-set-context-client-react` | `@securitydept/token-set-context-client-angular` | **Landed**: Angular: multi-client registry + interceptor + canonical `secureRouteRoot` / `secureRoute` route-security builders; React: Auth hooks. (Framework route projection lives in `@securitydept/client-react` and `@securitydept/client-angular`) |

> **Note**: API contract shapes are landed and test-covered. Live `outposts` host integration has not yet started and may surface ergonomics adjustments during actual consumption.


### token-set-context-client v1 Scope Baseline


Read `@securitydept/token-set-context-client` as a frozen browser-owned v1
baseline, not as an umbrella for every future custody model.

| In the current baseline contract | Not part of the current baseline contract |
|---|---|
| browser-owned `backend-oidc` consumption | mixed-custody token family management |
| callback returns parsing, metadata fallback | stateful BFF token ownership |
| in-memory auth-state signals | server-side mediated token ownership / SSR token stores |
| persisted restore, explicit clear | cross-tab sync / visibility re-check and larger browser lifecycle hardening |
| refresh-token-driven refresh | multi-provider orchestration / token-family policy |
| bearer authorization-header projection | product-specific resource helpers / propagation probes / trace timeline UI |
| transport convenience such as `createBackendOidcModeAuthorizedTransport()` | popup-based login flow |
| `./web` browser bootstrap / callback returns capture / reset helpers |  |
| framework-specific independent adapter integration (`-react` and `-angular` package families) |  |

The right-hand column does **not** mean "all deferred beyond 2.0".
After the current `2.0-alpha` re-audit, these topics split into three groups:

- `2.0` backlog: popup login, cross-tab / visibility lifecycle hardening, and multi-provider orchestration
- `3.0` deferred: mixed-custody / BFF / server-side mediated token ownership
- non-SDK surface by design: product-specific helpers, probes, and timeline UI

Why these topics stay out of the current baseline contract:

- mixed-custody / BFF / server-side mediated token ownership materially change the ownership model rather than extend the current one
- larger browser lifecycle work belongs to later adapter hardening, not the first root-contract freeze
- app-specific helpers and probes depend on reference-app API shapes and product models, so leaving them in `apps/webui` keeps the SDK surface understandable

### 2.0-alpha Re-audit of Unfinished Items

This guide mixes three kinds of content:

- current implemented contract
- design rules / intended architecture
- unfinished but still intended product features

To reduce ambiguity during the current `2.0-alpha.x` stage, the following
table is the authoritative re-audit view of the major unfinished items still
mentioned in this document.

| Topic | Current audit status | Required direction before 2.0 GA |
|---|---|---|
| `@standard-schema` support | **Multi-path adoption implemented.** Foundation validation entry (`createSchema`, `validateWithSchema`, `validateWithSchemaSync`) in `@securitydept/client`. Real adoption: `session-context-client.fetchMe()`, `frontend-oidc-mode.parseConfigProjection()`, `BasicAuthContextClient` config validation, `parseBackendOidcModeCallbackBody` / `parseBackendOidcModeRefreshBody`. Behavioral evidence in `standard-schema-adoption.test.ts` and `standard-schema-expanded-adoption.test.ts`. | Incremental expansion to remaining cross-boundary payloads as needed. |
| Scheduling and unified input sources | **Foundation baseline implemented.** `Scheduler` / `Clock` abstractions + default runtimes + new foundation helpers: `timer()`, `interval()`, `scheduleAt()`, `fromEventPattern()` in `@securitydept/client`. Browser adapter: `fromVisibilityChange()` in `@securitydept/client/web`. Real adoption: `FrontendOidcModeClient` metadata refresh uses `interval()`. | `fromSignal`, storage adapter, and cross-tab leader election remain deferred. |
| `basic-auth-context-client` thin browser helper | **Implemented baseline.** Zone-aware login/logout URL construction, neutral redirect instructions, `./web` redirect helper (`performRedirect`) and `loginWithRedirect()` convenience with named `LoginWithRedirectOptions`, and focused tests already exist. | Keep thin; no large product-UI expansion required for 2.0. |
| `session-context-client` login-trigger convenience | **Baseline implemented.** `loginWithRedirect()` convenience exists in `@securitydept/session-context-client/web`; behavior-level tests confirm pending redirect state and browser navigation. | Keep thin; expand only if adopter feedback requires additional convenience. |
| Redirect-based token-set login convenience | **Baseline implemented.** `loginWithBackendOidcRedirect()` in `backend-oidc-mode/web` and `FrontendOidcModeClient.loginWithRedirect()` in `frontend-oidc-mode` provide one-shot redirect convenience; behavior-level tests cover both. | Keep thin; expand only if adopter feedback requires additional convenience. |
| Popup-based login for `backend-oidc-mode` / `frontend-oidc-mode` | **Baseline implemented.** Shared popup infra (`openPopupWindow`, `waitForPopupRelay`, `relayPopupCallback`, `PopupErrorCode`) in `@securitydept/client/web`. `loginWithBackendOidcPopup` + `relayBackendOidcPopupCallback` in `backend-oidc-mode/web`. `FrontendOidcModeClient.popupLogin()` in `frontend-oidc-mode`. Stable error codes for blocked, closed, timeout, and relay error semantics. | Cross-tab lifecycle hardening, chooser UI, and multi-provider orchestration are explicitly deferred beyond the baseline. |
| Multi-OIDC-client / multi-requirement route orchestration | **Headless primitive baseline implemented.** `createRequirementPlanner()` in `@securitydept/client/auth-coordination` provides a mode-agnostic, sequential requirement planner with `AuthRequirement`, `PlanStatus`, `ResolutionStatus`, and `PlanSnapshot`. `kind` is an opaque `string`; no `RequirementKind` constant is exported. Supports ordered progression, mixed resolution statuses, reset/retry, and error paths. `createRouteRequirementOrchestrator()` provides route-level glue for matched-route-chain semantics. | Chooser UI, app router integration, cross-tab orchestration, and non-sequential (parallel / conditional) flows remain deferred. |
| `basic-auth-context` SSR / server-render-host support | **Server helper baseline implemented.** `createBasicAuthServerHelper()` in `@securitydept/basic-auth-context-client/server` provides host-neutral `handleUnauthorized()`, `loginUrlForPath()`, and `logoutUrlForPath()` with `ServerRequestContext` / `ServerRedirectInstruction` contracts. Contract-level evidence in `ssr-server-helper-baseline.test.ts`. | Framework-specific adapters (Next.js, Remix) remain deferred. |
| `session-context` SSR / server-render-host support | **Server helper baseline implemented.** `createSessionServerHelper()` in `@securitydept/session-context-client/server` provides host-neutral `fetchMe()` with cookie-forwarding transport, `loginUrl()`, and `logoutUrl()`. Contract-level evidence in `ssr-server-helper-baseline.test.ts`. | Framework-specific adapters and response mutation abstraction remain deferred. |
| TS SDK freeze and release-gate discipline | **Fully implemented for 0.x baseline.** `public-surface-inventory.json` provides authoritative inventory with stability, evidence, docs anchors, and `changeDiscipline` per subpath. `release-gate.test.ts` (14 tests) validates export alignment, evidence, docs anchors (EN heading + ZH parity), stability, discipline/stability alignment, and migration ledger existence. `110-TS_SDK_MIGRATIONS.md` serves as the adopter-facing migration ledger. | Full semver / release automation / changelog generation remain deferred. |
| Mixed-custody / BFF / server-side token ownership | Important design boundary, but still high-complexity and not part of the browser-owned 2.0 baseline. | Explicitly defer to 3.0 rather than letting it distort the 2.0 release target. |

This table intentionally audits TS SDK surface only. Rust backend service
support is a separate repository concern and must not be confused with the
SSR / server-side support terminology used here.

#### Popup-based Login Design Direction

Popup login baseline is **implemented**. The following components are available:

Current implementation:

- shared popup infrastructure in `@securitydept/client/web`:
  - `openPopupWindow()` — popup open with blocked detection
  - `waitForPopupRelay()` — `postMessage` relay wait with closed/timeout handling
  - `relayPopupCallback()` — generic relay helper for callback pages
  - `PopupErrorCode` — stable error codes (`popup.blocked`, `popup.closed_by_user`, `popup.relay_timeout`, `popup.relay_error`)
  - `computePopupFeatures()` — centered popup features string
- `backend-oidc-mode/web`:
  - `loginWithBackendOidcPopup()` — top-level popup login, relays fragment back to existing bootstrap pipeline, respects `callbackFragmentKey` / `sessionStore` namespacing
  - `relayBackendOidcPopupCallback()` — mode-local callback relay helper
- `frontend-oidc-mode`:
  - `FrontendOidcModeClient.popupLogin()` — instance method, combines `authorizeUrl()` → popup → relay → `handleCallback()` → persist
  - `relayFrontendOidcPopupCallback()` — mode-local callback relay helper

Explicitly deferred beyond the baseline:

- cross-tab lifecycle hardening / leader election
- chooser UI or multi-provider orchestration
- auto-fallback (popup blocked → redirect) — left to the caller

### Adopter Checklist

Use this section to decide quickly whether the current SDK fits your use case and where to enter it.

| If you need... | Use / Expect | Do not assume |
|---|---|---|
| browser app / SPA consuming `backend-oidc` | enter directly via `@securitydept/token-set-context-client/backend-oidc-mode` | timeline UI, propagation probes, or `apps/webui/src/api/*` are SDK surface |
| frontend consumption of a specific preset | still use `@securitydept/token-set-context-client/backend-oidc-mode`, then react to capability/preset information in the returned contracts | pure / mediated map to separate long-lived canonical families |
| React integration | `@securitydept/*-react` for minimal Provider, hook integration; `session-context-client-react` can start directly from the React entry below | route guards, pending-redirect UI, or reference-page interaction forms are part of the adapter contract |
| mediated token ownership beyond the browser-owned baseline | read it as explicitly deferred to `3.0`, not as part of the `2.0` public surface | mixed-custody / BFF / SSR token-store support already exists |

What must not be treated as SDK surface:

| Item | Where It Lives | Why |
|---|---|---|
| `apps/webui/src/api/*` business helpers | reference app | depends on reference-app API shapes and product models |
| trace timeline UI / DOM harnesses | reference app | debugging/demo glue, not external contract |
| propagation smoke / same-server probes | reference app, server config | depends on product routes and service config |
| SSR session redirect glue (full form) | app/server layer | framework response boundary belongs to the app |
| cross-tab sync / visibility lifecycle hardening | future adapter hardening backlog | not part of the current public adapter contract yet; `2.0` should still add a baseline before GA |

Before you adopt:

- your runtime has `fetch` / `AbortSignal` support for browser-facing paths
- your storage needs fit `localStorage` / `sessionStorage`, or you are ready to inject a custom store
- you understand that `./web` and `-react` independent packages are still `provisional`
- you do not expect the SDK to absorb product concerns such as route guards, login redirects, or timeline UI
- if you use React, you are ready to provide transport / scheduler / clock from the host

### Verified Environments / Host Assumptions

"Currently verified" here means capability prerequisite plus test-environment granularity, not a brand-browser matrix.

| Scope | Required Host Capability | Currently Verified | Assumed but Not Broadly Verified | Not Yet Verified / Not Promised |
|---|---|---|---|---|
| Foundation packages | ES2020+, `Promise`, `Map` / `Set` / `WeakRef` | Node.js (vitest), modern browser (Vite build) |  | IE / legacy environments, non-ES-module hosts, CJS consumers |
| Browser capability adapters | `fetch`, `AbortSignal`, `localStorage` / `sessionStorage` semantics | apps/webui dogfooding, vitest jsdom | `sessionStorage` cross-tab isolation, storage-event exact behavior | Service Worker environments, non-standard storage hosts, per-browser matrices |
| Auth-context `./web` adapters | `location.href`, `history.replaceState`, `fetch`, flow-state storage | apps/webui dogfooding, backend-oidc-mediated browser focused lifecycle tests | SPA-router edge behavior, iframe / webview suitability | non-SPA router scenarios, SSR hosts, React Native / Electron |
| React adapters | React 18+ (`useSyncExternalStore`), host-provided transport / scheduler / clock | vitest focused adapter test(s), apps/webui dogfooding | React 17, React Server Components, concurrent-mode edge behavior | non-React hosts, React Native |

### Minimal Entry Paths

These are intentionally small “how do I start?” snippets, not replacements for the reference app.

#### 1. Foundation entry: runtime stays explicit

Use the foundation packages when the host wants to own transport/runtime wiring itself.

```ts
import { createRuntime } from "@securitydept/client";
import { SessionContextClient } from "@securitydept/session-context-client";

const runtime = createRuntime({
	transport: {
		async execute(request) {
			const response = await fetch(request.url, {
				method: request.method,
				headers: request.headers,
				body: request.body,
			});

			return {
				status: response.status,
				headers: Object.fromEntries(response.headers.entries()),
				body: await response.json().catch(() => null),
			};
		},
	},
});

const sessionClient = new SessionContextClient({
	baseUrl: "https://auth.example.com",
});

const session = await sessionClient.fetchMe(runtime.transport);
```

#### 2. Browser entry: `./backend-oidc-mode/web` owns browser glue

Use `./backend-oidc-mode/web` when the host wants browser capability helpers such as `fetch`, storage-backed flow state, and callback bootstrap.

`createBackendOidcModeBrowserClient()` accepts **every field** of `BackendOidcModeClientConfig` (`baseUrl`, `loginPath`, `refreshPath`, `metadataRedeemPath`, `userInfoPath`, `refreshWindowMs`, `persistentStateKey`, `defaultPostAuthRedirectUri`) plus browser-specific runtime wiring (`persistentStore`, `sessionStore`, `transport`, `fetchTransport`, `scheduler`, `clock`, `logger`, `traceSink`). If you need full control over the `ClientRuntime`, construct `BackendOidcModeClient` directly instead.

**`transport` vs `fetchTransport` priority:**

- When `transport` is provided, it is used as the runtime transport directly; `fetchTransport` is ignored.
- When `transport` is omitted, the entry creates a default `fetch`-based transport via `createWebRuntime`. In that path, `fetchTransport` options are merged with the SDK default (`redirect: "manual"`) so adopters can tune fetch behavior without replacing the entire transport.
- The SDK default `redirect: "manual"` is the safe default required for backend-oidc browser protocol handling.

**Storage isolation for multiple integrations on the same origin**: when multiple independent backend-oidc integrations share the same origin and storage:

- `persistentStateKey` isolates persisted auth state (token snapshots)
- Callback fragment isolation is handled by passing `callbackFragmentKey` + `sessionStore` to `bootstrapBackendOidcModeClient` and `resetBackendOidcModeBrowserState`; use `resolveBackendOidcModeCallbackFragmentKey(persistentStateKey)` to derive a namespaced key
- `resetBackendOidcModeBrowserState` accepts the same `callbackFragmentKey` / `sessionStore` convenience parameters as bootstrap, so cleanup correctly targets the namespaced fragment store. When `callbackFragmentStore` is explicitly provided, it takes priority over `callbackFragmentKey` / `sessionStore`

> [!NOTE]
> All browser convenience helpers provide named configuration types exported directly from `@securitydept/token-set-context-client/backend-oidc-mode/web`. For example, `BootstrapBackendOidcModeClientOptions` and `ResetBackendOidcModeBrowserStateOptions` can be imported for explicit contract typing.

**One-shot login redirect:** `loginWithBackendOidcRedirect(client, options?)` is the recommended one-step browser entry point for triggering a backend-oidc login. It resolves the authorize URL and navigates the window. Its options contract `LoginWithBackendOidcRedirectOptions` is exported from `@securitydept/token-set-context-client/backend-oidc-mode/web`.

**Session-context browser convenience:** `@securitydept/session-context-client/web` provides `loginWithRedirect(client, options?)` — a one-shot redirect helper for session-based login that saves the post-auth redirect intent and navigates to the login URL. Its options contract `LoginWithRedirectOptions` is exported from the `/web` subpath.

**Basic-auth browser convenience:** `@securitydept/basic-auth-context-client/web` provides `loginWithRedirect(client, options?)` — a one-shot zone-aware redirect helper that resolves the matching zone from the current path and navigates to the zone's login URL. Its named options contract `LoginWithRedirectOptions` is exported from the `/web` subpath. Returns `true` if a redirect was initiated, `false` if no zone matched.

**Frontend-oidc login redirect:** `FrontendOidcModeClient.loginWithRedirect(options?)` builds the OIDC authorize URL (with PKCE + nonce), stores pending state, and navigates the browser. Its options contract `FrontendOidcModeLoginWithRedirectOptions` is exported from `@securitydept/token-set-context-client/frontend-oidc-mode`.

```ts
import {
	bootstrapBackendOidcModeClient,
	createBackendOidcModeBrowserClient,
	resolveBackendOidcModeAuthorizeUrl,
	resolveBackendOidcModeCallbackFragmentKey,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";

const INTEGRATION_KEY = "my-app:backend-oidc";
const mySessionStore = /* custom session store */ undefined;

const client = createBackendOidcModeBrowserClient({
	baseUrl: "https://auth.example.com",
	defaultPostAuthRedirectUri: window.location.href,
	loginPath: "/auth/token-set/login",     // adopter-specific path override
	persistentStateKey: INTEGRATION_KEY,    // namespaces persisted auth state
	sessionStore: mySessionStore,           // custom session storage
});

// callbackFragmentKey + sessionStore together provide end-to-end fragment isolation
const bootstrap = await bootstrapBackendOidcModeClient(client, {
	sessionStore: mySessionStore,
	callbackFragmentKey: resolveBackendOidcModeCallbackFragmentKey(INTEGRATION_KEY),
});

if (bootstrap.source === "empty") {
	window.location.href = resolveBackendOidcModeAuthorizeUrl(client);
}
```

```ts
import {
	bootstrapBackendOidcModeClient,
	createBackendOidcModeBrowserClient,
	createBackendOidcModeCallbackFragmentStore,
	resolveBackendOidcModeAuthorizeUrl,
	resolveBackendOidcModeCallbackFragmentKey,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";

const INTEGRATION_KEY = "my-app:backend-oidc";

const client = createBackendOidcModeBrowserClient({
	baseUrl: "https://auth.example.com",
	defaultPostAuthRedirectUri: window.location.href,
	// Adopter-specific path overrides (SDK defaults to /auth/oidc/*)
	loginPath: "/auth/token-set/login",
	// Namespaces persisted auth state in localStorage
	persistentStateKey: INTEGRATION_KEY,
});

// Use the matching namespaced fragment key for sessionStorage isolation
const fragmentStore = createBackendOidcModeCallbackFragmentStore({
	key: resolveBackendOidcModeCallbackFragmentKey(INTEGRATION_KEY),
});

const bootstrap = await bootstrapBackendOidcModeClient(client, { callbackFragmentStore: fragmentStore });

if (bootstrap.source === "empty") {
	window.location.href = resolveBackendOidcModeAuthorizeUrl(client);
}
```

#### 3. React entry: `session-context-client-react` starts with Provider, hook wiring

If an adopter wants a React entry for session-context, start with `SessionContextProvider`, `useSessionPrincipal`; route guards, page-level UI, and app glue still stay with the host.

```tsx
import {
	SessionContextProvider,
	useSessionPrincipal,
} from "@securitydept/session-context-client-react";

function SessionBadge() {
	const principal = useSessionPrincipal();

	return <output>{principal?.displayName ?? "guest"}</output>;
}

export function App() {
	return (
		<SessionContextProvider
			config={{ baseUrl: "https://auth.example.com" }}
			transport={{
				async execute(request) {
					const response = await fetch(request.url, {
						method: request.method,
						headers: request.headers,
						body: request.body,
					});

					return {
						status: response.status,
						headers: Object.fromEntries(response.headers.entries()),
						body: await response.json().catch(() => null),
					};
				},
			}}
		>
			<SessionBadge />
		</SessionContextProvider>
	);
}
```

#### 4. SSR / server-host entry: dedicated `./server` helpers

In SSR or server-side request handlers (Next.js `getServerSideProps`, Remix `loader`, Astro endpoints, plain Node handlers, etc.), use the dedicated **`./server` subpath** for each auth-context package. These helpers provide host-neutral, cookie-aware operations without browser globals.

**Architectural boundary:**

| Responsibility | Owner |
|---|---|
| Login / logout / redirect URL construction | SDK `./server` helpers |
| Session probe with cookie forwarding (`fetchMe`) | SDK `./server` helpers, via host-provided transport |
| Zone-based 401 → redirect instruction | SDK `./server` helpers (`handleUnauthorized`) |
| HTTP response construction (302, Set-Cookie, body) | Host / framework |
| Browser navigation (`window.location`) | `/web` subpath only (not imported in SSR) |

##### session-context: login redirect + session probe (recommended baseline)

```ts
import { createSessionServerHelper } from "@securitydept/session-context-client/server";

const helper = createSessionServerHelper({
	config: { baseUrl: "https://auth.example.com" },
	transport: fetchTransport, // your fetch-based HttpTransport
});

export async function getServerSideProps(context) {
	const session = await helper.fetchMe({
		headers: { cookie: context.req.headers.cookie ?? "" },
	});

	if (!session) {
		return {
			redirect: {
				destination: helper.loginUrl(context.resolvedUrl),
				permanent: false,
			},
		};
	}

	return { props: { user: session.principal } };
}
```

##### basic-auth-context: zone-based redirect instruction (recommended baseline)

```ts
import { createBasicAuthServerHelper } from "@securitydept/basic-auth-context-client/server";

const helper = createBasicAuthServerHelper({
	config: {
		baseUrl: "https://auth.example.com",
		zones: [{ zonePrefix: "/api" }],
	},
});

export async function handleRequest(request: Request) {
	const url = new URL(request.url);

	// After receiving a 401 from upstream:
	const redirect = helper.handleUnauthorized({ path: url.pathname });
	if (redirect) {
		return Response.redirect(redirect.destination, redirect.statusCode);
	}

	// ...
}
```

##### Low-level escape hatch: root client + custom transport

If the `./server` helpers do not cover your use case, you can still import directly from the root subpath and construct a custom transport manually. This is the pre-helper approach and remains available as an escape hatch:

```ts
import { SessionContextClient } from "@securitydept/session-context-client";

const sessionClient = new SessionContextClient({
	baseUrl: "https://auth.example.com",
});

// Manual transport with cookie forwarding
const ssrTransport = {
	async execute(request) {
		const response = await fetch(request.url, {
			method: request.method,
			headers: { ...request.headers, cookie: incomingCookies },
		});
		return {
			status: response.status,
			headers: Object.fromEntries(response.headers.entries()),
			body: await response.json().catch(() => null),
		};
	},
};

const session = await sessionClient.fetchMe(ssrTransport);
```

> [!IMPORTANT]
> In SSR contexts, import from `./server` (recommended) or the **root** subpath. **Never** import from `/web` — it depends on browser globals (`window.location`) and must not be used in server-side code.

### Provisional Adapter Maintenance Standard

`./web` and `./server` subpaths plus dedicated framework adapter packages (`*-react`, `*-angular`) are usable, but maintained under a stricter `provisional` bar than foundation root exports. Foundation-owned stable exceptions (`@securitydept/client/web`, `@securitydept/client/persistence/web`) are explained in the [Capability Checklist](#current-public-contract-and-capability-checklist) footnote ¹.

Maintenance rules:

- keep responsibilities isolated: browser capability in `./web`, React integration in dedicated `*-react` packages, Angular integration in dedicated `*-angular` packages, business helpers outside the SDK
- keep import-time behavior stable: no global patching, no implicit polyfills, no side effects on import
- allow additive convenience evolution; avoid shape churn that forces consumers to relearn every iteration
- guard adapter contract with reference-app dogfooding plus focused smoke/regression tests, not prose alone
- current minimum evidence baseline: external-consumer scenarios, token-set web lifecycle tests, at least one React focused test and one Angular focused test

#### Provisional Adapter Promotion Checklist

All conditions must be satisfied before re-evaluating promotion to `stable`:

| Condition | Judgment Criterion |
|---|---|
| Capability boundary is stable | No significant reshuffling across multiple iterations and reviews |
| Minimal entry path is clear | Standalone minimal example exists, not dependent on full reference-app pages |
| Ordinary usage independent of reference-app glue | Standard use case explainable without `apps/webui` product glue |
| Focused automation covers adapter lifecycle | Key export facts and main lifecycle path have focused guardrails |
| Verified environments described accurately | Host prerequisites match actual verification granularity (see [Verified Environments](#verified-environments--host-assumptions)) |

#### Current Promotion Readiness (snapshot, not roadmap)

| Adapter | Strongest Evidence | Current Gap |
|---|---|---|
| `token-set-context-client/backend-oidc-mode` | Standalone minimal entry example (`backend-oidc-mode-minimal-entry.test.ts`), subpath contract test, wrapper contract comparison | Platform-neutral root; browser/React coverage via web subpaths and `-react` packages |
| `token-set-context-client/backend-oidc-mode/web` | Standalone minimal entry example (`backend-oidc-web-minimal-entry.test.ts`), focused lifecycle tests (callback precedence/recovery, retained JSON body replacement, shared-store fresh-client restore/reset), popup login baseline, visibility hardening baseline (`visibility-hardening-baseline.test.ts`), cross-tab sync baseline (`cross-tab-sync-baseline.test.ts`), reference-app dogfooding | Broader browser-matrix coverage and real downstream adopter integration are still unverified |
| `token-set-context-client-react` | Standalone minimal entry example (`backend-oidc-react-minimal-entry.test.ts`), dedicated React adapter focused test (`adapter.test.ts`) covering signal sync/disposal/StrictMode/reconfigure, subpath contract test | React 17 / concurrent mode not verified; broader host matrix still uncovered |
| `basic-auth-context-client/web` | Redirect-contract focused root tests, zone-aware external-consumer scenario coverage, zone-aware standalone minimal entry example, query/hash-bearing browser-route forwarding focused web tests, zone-aware `loginWithRedirect` convenience with named options contract | Broader browser-host semantics remain unverified |
| `basic-auth-context-client-react` | Dedicated React provider/hook focused test (`adapter.test.ts`), standalone minimal entry example (`basic-auth-react-minimal-entry.test.ts`) proving provider wiring, hook consumption, and zone-aware contract usage | Broader browser-host semantics remain unverified |
| `session-context-client/web` | Standalone minimal entry example (`session-web-minimal-entry.test.ts`), multi-line convenience baseline (`login-redirect-convenience.test.ts`), `loginWithRedirect` + named `LoginWithRedirectOptions` | Broader browser-host semantics remain unverified |
| `session-context-client-react` | Standalone minimal entry example, dedicated React provider/hook, `SessionContextValue` type exports, refresh/cleanup focused test, StrictMode stale-fetch discard focused test, reconfigure stale-result discard focused test | React 17 / concurrent mode not verified; broader host matrix still uncovered |
| `basic-auth-context-client/server` | Standalone minimal entry example (`basic-auth-server-minimal-entry.test.ts`), shared SSR baseline (`ssr-server-helper-baseline.test.ts`), dedicated helper focused test | Framework-specific server adapter coverage (Next.js, Remix, etc.) |
| `session-context-client/server` | Standalone minimal entry example (`session-server-minimal-entry.test.ts`), shared SSR baseline (`ssr-server-helper-baseline.test.ts`), dedicated helper focused test | Framework-specific server adapter coverage (Next.js, Remix, etc.) |
| `token-set-context-client/frontend-oidc-mode` | Standalone minimal entry example (`frontend-oidc-minimal-entry.test.ts`), wrapper contract comparison (`oidc-client-wrapper-contract.test.ts`), scheduling input source baseline | Real OIDC provider integration and framework-level adapter validation are still incomplete; popup/callback round-trip coverage remains limited |
| `token-set-context-client/access-token-substrate` | Standalone minimal entry example (`access-token-substrate-minimal-entry.test.ts`) | Substrate vocabulary only; no runtime propagation integration tested |
| `client/auth-coordination` | Requirement planner unit tests (`packages/client/src/auth-coordination/__tests__/requirement-planner.test.ts`), multi-requirement orchestration example (`examples/multi-requirement-orchestration.test.ts`), route orchestration baseline (`examples/route-orchestration-baseline.test.ts`) covering matched-route-chain semantics, chooser decisions, and route transition; TanStack Router adapter (`examples/tanstack-react-router-adapter.test.ts`), Angular Router adapter (`examples/angular-router-adapter.test.ts`) | Conditional flows, parallel orchestration, and real adopter end-to-end calibration remain open |

## Raw Web Router Baseline

**Subpath**: `@securitydept/client/web-router` (provisional, iteration 110).

Non-framework adopters (vanilla TS, Web Components, Lit) need a security-aware router on par with the React / Angular / TanStack integrations. The raw web router baseline is the canonical answer: a small, framework-neutral router core that layers requirement-based guarding on top of native browser navigation primitives.

Design choices:

- **Navigation API first, History API fallback.** `createNavigationAdapter()` probes `window.navigation`. When present, the router uses the Navigation API's `navigate` event for synchronous intent interception and `intercept({ handler })` to commit after requirement evaluation. When absent, the router installs a thin wrapper over `history.pushState` / `history.replaceState` + `popstate` that provides the same pre-commit hook shape. Both backends pass the same evidence suite.
- **PlannerHost is the authority.** The router does not reimplement requirement planning. Each route segment may declare `requirements?: readonly AuthGuardClientOption[]` (see `@securitydept/client/auth-coordination`). On every navigation intent the router walks the matched root→leaf `WebRouteDefinition` chain, calls `extractFullRouteRequirements(chain)` once to build a flat candidate list, and — when that list is non-empty — `await`s `plannerHost.evaluate(candidates)`. It then applies the returned `PlannerHostResult`: if `allAuthenticated` is false, it invokes `pendingCandidate.onUnauthenticated()`; the return value is `true` (allow the navigation), `false` (cancel via `preventDefault` on the intent), or a URL string (redirect). Unauthenticated handling is **per candidate** via each option's `onUnauthenticated` — there is no top-level `onUnauthenticated` on `createWebRouter`. Segments with an empty aggregated list skip the planner pass.
- **Adapter surface.**
  - `createNavigationAdapter(options?)` — returns a `NavigationAdapter` with `kind: "navigation-api" | "history"`.
  - `isNavigationApiAvailable()` — explicit capability probe; adopters can assert or downgrade explicitly.
  - `createWebRouter({ navigationAdapter?, plannerHost?, routes?, onNavigate?, defaultComposition? })` — returns a `WebRouter` with `navigate(url)`, `back()`, `forward()`, `match(url)`, `currentMatch()`, `currentUrl()`, `extractRequirements(match)`, `onNavigate(listener)` (returns unsubscribe), `addRoute`, `routes()`, `destroy()`, and `readonly adapter`. Pass `navigationAdapter` either as a ready `NavigationAdapter` or as options forwarded to `createNavigationAdapter()`.
  - `NavigationAdapterKind` — exported string-constant union for telemetry and tests.
- **Full-route requirement aggregation.** Routes form a tree via `WebRouteDefinition.children`; each segment may declare its own `requirements` and an explicit `composition: "inherit" | "merge" | "replace"` (default `"merge"`). On every navigation the router resolves the matched leaf to its full root→leaf chain, calls `extractFullRouteRequirements(chain)` once to compose the effective candidate set, and hands that single list to `plannerHost.evaluate()`. This contract depth mirrors the Angular `createTokenSetRouteAggregationGuard` / `extractFullRouteRequirements` pair and the TanStack Router adapter — non-framework adopters no longer have to hand-roll per-level requirement merging.
- **No framework bindings.** The router ships zero React / Angular / TanStack imports. Framework packages may wrap it, but it works standalone.

Minimal example (framework-neutral; matches the evidence tests):

```ts
import { createPlannerHost } from "@securitydept/client/auth-coordination";
import { createNavigationAdapter, createWebRouter } from "@securitydept/client/web-router";

const plannerHost = createPlannerHost();
const navigationAdapter = createNavigationAdapter();
const router = createWebRouter({
  navigationAdapter,
  plannerHost,
  routes: [
    {
      id: "dashboard",
      match: "/dashboard",
      requirements: [
        {
          requirementId: "session",
          requirementKind: "session",
          checkAuthenticated: () => false,
          onUnauthenticated: () => "/login",
        },
      ],
    },
    { id: "public", match: "/public" },
  ],
});

const off = router.onNavigate((commit) => {
  console.log("committed", commit.url.href);
});

await router.navigate("/dashboard");
off();
router.destroy();
```

Evidence: [`examples/web-router-navigation-api.test.ts`](../../sdks/ts/examples/web-router-navigation-api.test.ts) and [`examples/web-router-history-fallback.test.ts`](../../sdks/ts/examples/web-router-history-fallback.test.ts) prove both backends exercise the same public contract, including redirect, block, and commit paths. [`examples/web-router-full-route-aggregation.test.ts`](../../sdks/ts/examples/web-router-full-route-aggregation.test.ts) extends the contract with evidence for nested routes: `inherit` / `merge` / `replace` composition, root→leaf chain exposure on `WebRouteMatch.chain`, and `plannerHost.evaluate()` receiving the full aggregated candidate set in a single call (blocking navigation when a nested requirement fails).

## Shared Client Lifecycle Contract

**Subpath**: `@securitydept/token-set-context-client/registry` (provisional, iteration 110).

Iteration 110 extracts the framework-neutral multi-client management core out of the Angular adapter so React and raw-Web consumers share identical readiness, lifecycle, and lookup semantics. The Angular `TokenSetAuthRegistry` is now a thin DI wrapper over this core; the React `TokenSetAuthProvider` registers against the same core.

Readiness state machine (`ClientReadinessState`):

```
not_initialized --(register primary | preload lazy)--> initializing
initializing    --(factory resolves)----------------> ready
initializing    --(factory rejects)-----------------> failed
failed          --(reset(key))----------------------> not_initialized
```

Key concepts:

- **`ClientInitializationPriority`** — `"primary"` (materialized eagerly on `register`) vs `"lazy"` (materialized only when `whenReady` / `preload` / `idleWarmup` forces it, or when a requirement evaluates through the client). The default is `"primary"` to preserve iteration-109 behavior.
- **`preload(key)`** — forces a lazy client to materialize without waiting for a requirement. Returns the resolved service or the rejected promise.
- **`whenReady(key)`** — waits for `ready`, triggers `preload` for `lazy` entries, throws `failed`. Idempotent.
- **`idleWarmup()`** — schedules `preload` for every `lazy + not_initialized` client via `requestIdleCallback` (with a `setTimeout` fallback). Returns a `cancel()` thunk. Intended for production shells to amortize OIDC metadata fetches during browser idle time.
- **`reset(key)`** — tears down a service and moves the entry back to `not_initialized`, enabling re-registration after transient failure.
- **Multi-axis discrimination.** The registry indexes clients by `urlPatterns`, `callbackPath`, `requirementKind`, and `providerFamily`. `clientKeyGenFor*` are lazy generators; `clientKeyListFor*` snapshots the generator result. Adapters layer framework-specific sugar on top but never reimplement indexing.

Error shape: `require("missing")` throws `[TokenSetAuthRegistry] No client registered for key "missing" (and ready). Available keys: ...`. The trailing `(and ready)` is intentional — it distinguishes "key never registered" from "registered but not yet ready" and is checked by Angular adapter contract tests.

Evidence: [`examples/multi-client-lazy-init-contract.test.ts`](../../sdks/ts/examples/multi-client-lazy-init-contract.test.ts) proves the `primary | lazy` discrimination, `preload`, `whenReady`, `idleWarmup`, failure propagation, and `reset`. [`examples/async-client-readiness-contract.test.ts`](../../sdks/ts/examples/async-client-readiness-contract.test.ts) proves async factory + failure semantics.

## React Query Integration

**Subpath**: `@securitydept/token-set-context-client-react/react-query` (provisional, iteration 110).

Per iteration-110 manager ruling, React ecosystem integrations must not ship as standalone packages. React Query support lives as a **subpath** inside the main React package with `@tanstack/react-query` listed as an **optional peer dependency** and mirrored in `devDependencies` for the subpath to type-check. Consumers that do not import the subpath pay zero cost.

Strict consumer-only position:

- The subpath is a **consumer** of the token-set registry and `TokenSetAuthService` readable signal. It is **never** an authority — there is no query-driven login, refresh, or lifecycle mutation path here.
- Query state is derived from the registry; the registry is not derived from query state.
- If React Query is unavailable at runtime, consumers simply do not import the subpath. The main package works standalone.

Surface:

- `tokenSetQueryKeys` — deterministic key factory: `all()`, `forClient(key)`, `readiness(key)`, `authState(key)`. Exported so adopters can invalidate / colocate queries with their own keys.
- `useTokenSetReadinessQuery(clientKey, options?)` — wraps `registry.whenReady(clientKey)` as a `useQuery`. Returns standard `UseQueryResult<TokenSetAuthService, Error>`.
- `useTokenSetAuthorizationHeader(clientKey)` — returns `{ enabled: boolean; authorization: string | null }` derived from the client's access-token signal, suitable for plugging into `fetch` / axios / Query `queryFn` headers.
- `invalidateTokenSetQueriesForClient(queryClient, clientKey)` — thin wrapper over `queryClient.invalidateQueries({ queryKey: tokenSetQueryKeys.forClient(key) })`.

Minimal example:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TokenSetAuthProvider } from "@securitydept/token-set-context-client-react";
import {
  useTokenSetReadinessQuery,
  useTokenSetAuthorizationHeader,
} from "@securitydept/token-set-context-client-react/react-query";

function Dashboard() {
  const ready = useTokenSetReadinessQuery("main");
  const header = useTokenSetAuthorizationHeader("main");
  if (ready.status !== "success") return null;
  // header.authorization can be passed into other queries' fetch layer.
}
```

Evidence: [`examples/react-query-integration-evidence.test.ts`](../../sdks/ts/examples/react-query-integration-evidence.test.ts) proves the subpath resolves through vitest alias, drives `useQuery` from `whenReady()`, mirrors the access-token signal, and supports targeted invalidation.

## Examples and Reference Implementations

### Primary Real Reference Apps

- `apps/server`
- `apps/webui`

These should be treated as the first-priority dogfooding and reference applications.

The current intended reading is:

- `apps/server`: the reference server, providing real auth, forward-auth, and propagation semantics for the client SDKs
- `apps/webui`: the reference app, validating real read/write flows, auth lifecycle behavior, trace timeline usage, and minimal usable propagation dogfood
- business helpers under `apps/webui/src/api/*`: reference app glue, not SDK public surface
- `apps/webui/src/routes/tokenSet/*`: reference-page UI / observability glue, used to explain and regression-test SDK boundaries, not an SDK package
- `sdks/ts/packages/test-utils`: test/demo infrastructure, and should not be conflated with reference app glue

### Downstream Reference Case: Outposts

In addition to `apps/server` and `apps/webui`, `~/workspace/outposts` should be treated as a high-value downstream adopter reference case:

- it does not replace the primary reference-app / dogfooding path
- its value is validating real multi-backend, multi-OIDC-client, route-level requirement-orchestration scenarios
- it is more useful for guiding future headless orchestration primitive / scheduler direction than for being read as a current completed capability
- the Angular integration path in `outposts` should be treated as a real browser OIDC / router host case for shaping the SDK
- but its current `angular-auth-oidc-client`-based auth module carries obvious migration-era constraints and should be treated as migration input plus host constraints, not as the source of truth for the SDK's public Angular API

See the staged planning document:

- [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md)

### Current Bundle / Code Split Judgment

- the `/backend-oidc-mode` page has already removed the most obvious chunk warning through a local route split
- because of that, bundle/code splitting can currently be downgraded from “blocking issue” to “follow-up engineering topic”
- if more work is needed later, the next reasonable split points should be other dense reference routes or shared UI hot paths, not repeated mechanical splitting of the same OIDC-mediated page
- at the current stage, this topic should stay behind SDK public contract, capability requirement, and boundary hardening

### Demo and OIDC Provider

- fake/test infrastructure can be reused to build interactive demos such as timeline and trace visualizers
- if a full OIDC flow demo is needed, use a lightweight container-friendly demo provider
- Dex is the current preferred first option
- demos themselves should support Docker / `docker compose`

## Requirements for Future Developers and AI Agents

- do not rename or reframe the client SDK as `auth-runtime`
- do not let platform adapters leak back into `foundation`
- do not add global polyfills or import-time side effects by default
- do not let v1 `token-set-context-client` expand into an unconstrained monolith covering all mixed-custody / BFF complexity
- before adding abstractionsfirst check whether `apps/server` and `apps/webui` can serve as the real integration target

[English](007-CLIENT_SDK_GUIDE.md) | [中文](../zh/007-CLIENT_SDK_GUIDE.md)
