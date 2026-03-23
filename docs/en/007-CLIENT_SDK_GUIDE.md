# Client SDK Guide

This document defines the formal design direction for SecurityDept client SDKs. TypeScript comes first, with Kotlin and Swift expected later under the same architectural rules.

Target readers:

- human developers implementing SDK modules
- AI agents modifying SDK code or documentation

## Goal

Client SDKs should model SecurityDept auth-context behavior for client and portable runtime use cases. They must not reuse the server-side `auth-runtime` concept, and they should not collapse all behavior into one monolithic package.

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
- `foundation`: shared client infrastructure layer, usually better as an internal/workspace term than as the main public package name
- `basic-auth-context-client`: Basic Auth zone-aware helper package
- `session-context-client`: session-mode client package
- `token-set-context-client`: token-set-mode client package

For protocol-like contracts, naming currently follows a `Trait` style to avoid confusion with future global names or standard objects.

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
- expose framework adapters through subpath exports inside the same package
- do not create extra framework aggregate packages such as `@securitydept/react-client`

TypeScript examples:

- `@securitydept/client`
- `@securitydept/client/react`
- `@securitydept/client/web`
- `@securitydept/client/persistence`
- `@securitydept/client/persistence/web`
- `@securitydept/basic-auth-context-client`
- `@securitydept/basic-auth-context-client/react`
- `@securitydept/basic-auth-context-client/web`
- `@securitydept/session-context-client`
- `@securitydept/session-context-client/react`
- `@securitydept/token-set-context-client`
- `@securitydept/token-set-context-client/react`

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

`apps/webui` should keep using Vite, but Vite should not become the primary build pipeline for SDK packages.

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

State semantics should lean toward TC39 `signals`, while the public API remains a thin SDK-defined protocol layer.

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

Event semantics should lean toward `observable`, but the SDK must not expose one concrete library type directly.

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
  headers: Record<string, string>
  body?: unknown
}

interface HttpResponse {
  status: number
  headers: Record<string, string>
  body?: unknown
}

interface HttpTransport {
  execute(request: HttpRequest): Promise<HttpResponse>
}
```

`401`, redirect, and reauthentication handling belong to auth runtime policy, not to transport itself.

### Persistence

Persistence must not be reduced to a generic KV wrapper. It should distinguish:

- long-lived state
- recoverable state
- ephemeral flow state

Current direction:

```ts
interface RecordStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
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

### Configuration

Configuration should be layered, not flattened into one large options object.

Recommended layers:

- runtime / foundation config
- auth-context config
- adapter / framework config

Example:

```ts
createTokenSetContextClient({
  runtime: {
    transport,
    persistence,
    scheduler,
    clock,
  },
  auth: {
    authorizePath,
    callbackPath,
    refreshPath,
    refreshWindowMs,
  },
})
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

If complexity truly grows later, consider a reflection-free typed-token resolver.

## Context Client Design

### `basic-auth-context-client`

This module should stay intentionally thin. Its purpose is not to replace browser-native Basic Auth, but to make zone-aware routing and redirect behavior predictable.

Minimum responsibilities:

- define the active Basic Auth zone boundary
- determine whether the current route is inside that zone
- when a protected API inside that zone returns `401`, redirect to the zone login URL
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

This is expected to be the heaviest module. It should own:

- callback fragment parsing
- token snapshot / delta merge rules
- metadata redemption flow
- persistence adapters
- refresh scheduling
- multi-provider or multi-source management
- bearer header injection helpers
- refresh / redemption failure recovery policy

#### Mixed Custody and BFF Boundary

Mixed-custody must be recognized:

- `browser-owned token family`
- `bff-owned token family`

The same token family must not be owned concurrently by browser and BFF.  
Mixed-custody should appear in the formal design, but it must be clearly marked as:

- an important boundary
- high complexity
- not fully implemented in v1

## Server Support

Server support should not mean “a separate server-only client core”. It should still build on the same portable capability model.

### `basic-auth-context` and `session-context`

They should support redirect-aware SSR / server request handling.

The core is not browser navigation. The core is a neutral redirect instruction:

```ts
type AuthGuardResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "redirect"; status: 302 | 303 | 307; location: string }
```

### `token-set-context`

Server-side support should be treated as a higher-level, stateful BFF mode rather than as a small SSR extension.

Principles:

- server-side `token-set-context` support is provisional
- SSR / BFF should consume `bff-owned` token families only
- for sensitive third-party tokens, avoid making the BFF hold raw access tokens whenever possible

## Error Model

The client should not rely on a flat single-layer `Error` model.  
A two-layer model is preferred:

- machine-facing runtime error
- user-facing presentation / recovery hint

Current server-aligned base contract:

```ts
type UserRecovery =
  | "none"
  | "retry"
  | "restart_flow"
  | "reauthenticate"
  | "contact_support"

interface ErrorPresentation {
  code: string
  message: string
  recovery: UserRecovery
}
```

Current principles:

- preserve server-returned `error: { code, message, recovery }` when available
- `code` is the stable cross-layer contract; `message` is not
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
- `AbortSignal` is better treated as a web interop bridge, not as the only core cancellation primitive

## Logging, Tracing, and Testing

Foundation should formally provide an observability layer:

- `LoggerTrait`
- `TraceEventSinkTrait`
- `OperationTracerTrait`

Principles:

- leave room for an OpenTelemetry bridge, but do not bind the default core to OTel directly
- timeline / trace sinks are the primary observation surface for behavior tests, not plain text logs

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

## Build, Compatibility, and Side Effects

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
- where needed, prefer ponyfills or opt-in helpers

### sideEffects / Tree Shaking

- tree shaking is a design goal
- the SDK should be side-effect free by default
- any side effect must require explicit user mounting or initialization
- imports must not automatically trigger scheduling, storage restore, redirects, logging, tracing, or polyfills
- `sideEffects: false` should be the target capability, not a late packaging patch

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

## Examples and Reference Implementations

### Primary Real Reference Apps

- `apps/server`
- `apps/webui`

These should be treated as the first-priority dogfooding and reference applications.

### Minimal Examples

Additional smaller examples should still exist to isolate and validate:

- foundation usage
- web adapters
- React adapters
- SSR redirect behavior

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
- before adding abstractions, first check whether `apps/server` and `apps/webui` can serve as the real integration target

[English](007-CLIENT_SDK_GUIDE.md) | [中文](../zh/007-CLIENT_SDK_GUIDE.md)
