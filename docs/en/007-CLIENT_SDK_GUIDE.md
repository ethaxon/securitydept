# Client SDK Guide

This document defines the TypeScript SDK contract. It is the authority for package boundaries and host-integration rules. Application-specific code under `apps/webui` is a reference implementation, not public API.

## Package Families

| Package | Responsibility |
| --- | --- |
| `@securitydept/client` | Foundation traits: environment, transport, state/resources, events, cancellation, spans, tracing, injection, protocol and URL helpers. |
| `@securitydept/client-react` / `@securitydept/client-angular` | Framework bridges for the foundation traits. |
| `@securitydept/basic-auth-context-client*` | Basic-Auth boundary observations and login/logout navigation. |
| `@securitydept/session-context-client*` | Cookie-session refresh, user-info, login and logout integration. |
| `@securitydept/token-set-context-client*` | Token-set OIDC modes, lifecycle orchestration, registry, access-token substrate, and framework adapters. |

The `*` form includes the core package plus optional React or Angular package. Packages marked `private` in the workspace are tooling, test, or reference-app dependencies, not supported npm products.

## Public Imports

Use only declared package exports. The published `@securitydept/client` subpaths are `./web`, `./webext`, `./server`, `./rx`, and `./test`. Token-set exposes focused subpaths:

- `./orchestration`
- `./frontend-oidc-mode`
- `./backend-oidc-mode`
- `./access-token-substrate`
- `./registry`

`sdks/ts/public-surface-inventory.json` and each package's `exports` field are the enforceable source of truth. Do not import source files, reference-app glue, or undocumented internal paths.

## Stability And Change Discipline

The public-surface inventory assigns a stability level to every published package and subpath. `0.x` does not make all public surfaces equally disposable.

| Stability | Change discipline |
| --- | --- |
| stable | Deprecate first. Keep the deprecated public API for at least one minor release and add a migration note before removal. |
| provisional | A breaking change needs a migration note and review-visible justification. |
| experimental | Breaking changes may be immediate; record a brief migration note when it helps adopters. |

The current broad split is: `@securitydept/client` and core context-client roots are stable; framework adapters, host-specific subpaths, and token-set focused subpaths are generally provisional; `@securitydept/client/test` is experimental. The inventory, rather than this summary, decides an individual export's level.

## Supported Host Entrypoints

| Entrypoint | Use it for | Boundary |
| --- | --- | --- |
| `@securitydept/client/web` | A native browser page. | Creates router, page lifecycle, popup, and browser storage traits from explicit Web inputs. |
| `@securitydept/client/webext` | Browser-extension UI, background, or shared extension code. | Adapts extension routing and storage APIs without exposing extension globals to core clients. |
| `@securitydept/client/server` | Request-scoped server or SSR integration. | Builds a request-scoped environment and transport; it never assumes browser globals. |
| `@securitydept/client/rx` | Internal SDK or host-side RxJS composition. | Provides RxJS-backed SDK implementations and command/resource utilities; the public traits themselves provide observable interop. |
| `@securitydept/client/test` | SDK tests and examples. | Experimental test-only helpers, not an adopter runtime dependency. |

Use `createEnvironmentForNativeWeb`, the relevant WebExtension creator, or `createEnvironmentForServer` at a composition root. None of these helpers performs implicit host detection for a client.

## Explicit Environment

Clients receive a `FoundationEnvironment` at construction. The required baseline is:

```ts
interface FoundationEnvironment {
  injector: SecuritydeptInjector;
  transport: BaseTransportTrait;
  time: TimeTrait;
  realmStorage: SyncStorageTrait;
  span: SpanTrait;
  tracing: TracingTrait;
}
```

`persistentStorage`, `sessionStorage`, `router`, `pageLifecycle`, `popup`, and `idleCallback` are optional capabilities. A client must not silently acquire a missing host capability. Use a host-specific environment creator from `@securitydept/client/web`, `webext`, or `server`, or provide the capability explicitly at the composition root.

`transport` is a neutral base transport. An authenticated transport is derived from a base transport plus a replaying authorization-header signal; it is not a second environment field and it does not make the environment an owner of auth state.

## Public API Design Rules

- Public functions use an options object when they accept optional input; do not add an ambiguous positional second parameter.
- Define enum-like string domains as a named `const` object plus its derived type. Reuse named constants for public contracts and repeated telemetry vocabulary instead of scattering raw strings.
- Keep a short, single-use helper inline when extraction only adds a navigation hop. Extract a helper when it is reused, establishes a stable boundary, or materially clarifies a complex block.
- Required host capabilities must be passed explicitly. A helper may model an unavailable optional capability as `null` or `undefined`, but must not silently acquire a browser, storage, or environment fallback.
- All published packages declare `sideEffects: false`. Do not depend on import-time global patching or implicit polyfills; configure host polyfills and global integration explicitly at the composition root.

## State, Events, And Cancellation

The public reactive contracts are SDK traits:

- `ReadableSignalTrait<T>` exposes synchronous current state plus observable interop.
- `ResourceTrait<T>` exposes a typed loading/value/error lifecycle.
- `EventStreamTrait<T>` exposes a read-only event sequence; `EventSubjectTrait<T>` is producer-side only.
- `CancellationTokenTrait` is cooperative cancellation with observable interop.

Consumers receive read-only signals and event streams. Implementations may use RxJS directly: the traits implement observable interop, and `@securitydept/client/rx` provides RxJS-backed implementations plus command/resource utilities. Do not wrap RxJS again merely to hide it internally, and do not expose an RxJS `Observable` as the SDK's public contract.

`createNeverEventStream()` and `createEmptyEventStream()` are the semantic equivalents of RxJS `NEVER` and `EMPTY` for public trait APIs.

## Span And Tracing

`SpanTrait` is a base context capability, independent of tracing and events. A caller forks a span for nested work; tracing records the current operation under that span. This supports hosts that can propagate context automatically and hosts that use explicit propagation.

Trace records describe the local action. Do not add parallel global source/outcome enums merely to reconstruct nesting that the span tree already provides. Freshness is a refresh-boundary fact, not a default field of every auth event or trace.

## Auth Context Clients

### Basic Auth

`BasicAuthContextClient` models zone-aware challenge boundaries. It does not manage a browser credential cache or invent a normal credential-clear operation. The client exposes boundary snapshots, operations, and events; login/logout navigation remains an explicit host/router action.

### Session

`SessionContextClient` models a server-owned cookie session. It reads session user-info, exposes resource state, and initiates login/logout navigation. It does not expose the server's OIDC credentials or session storage implementation.

### Token Set

Token-set clients have one in-memory snapshot authority. Their lifecycle has four stable roles:

1. Workflow sources provide inputs such as startup, page resume, and refresh timing.
2. Closed planners evaluate restore, freshness, and refresh outcomes into a discriminated final candidate.
3. The base client serializes top-level workflows and commits exactly one determination.
4. Mode clients implement the protocol-specific OIDC work; registry code composes clients and routes callbacks.

`start()` is the canonical initial lifecycle entry. `restorePersistedState()` remains an explicit manual persistence re-sync command for cases such as cross-tab or host-driven synchronization; it is not the general readiness API. Use registry readiness APIs when a registry owns construction.

Auth events are a direct discriminated public union. Event type determines the payload shape; consumers must not rely on obsolete `AuthCheck*`, `TokenSetAuthFlowReason`, `TokenSetAuthFlowOutcome`, or payload-map contracts. Refresh events are the only auth-event family that carries freshness and refresh-material facts. No auth event may contain raw access tokens, refresh material, or authorization headers.

## Framework Adapters

React and Angular packages adapt canonical client ownership into their framework's context/injection and lifecycle facilities. They must not create a competing auth-state authority. Router adapters adapt the framework router to `RouterTrait`; they do not define product routes or UI.

- In React, call `createEnvironmentForReact(...)` outside Fiber, install its injector through `SecuritydeptProvider`, and read SDK dependencies through `useSecuritydeptContext()`. `@securitydept/client-react/tanstack-router` owns TanStack Router adaptation.
- In Angular, use `provideEnvironment(...)` to compose the Angular router, `HttpClient`, injector, and destruction lifecycle. `@securitydept/client-angular` owns the corresponding router and transport adapters.
- Token-set hosts register keyed clients with `provideTokenSetClientRegistry(...)`. React reads it with `useTokenSetClientRegistry()` and callback hooks; Angular provides the same core registry and can use its callback components, route-root helpers, and guard factories.
- Route helpers express requirements and delegate evaluation to the registry/client lifecycle. The application still owns its route tree, redirects, UI, and user-facing copy.

## Lifecycle And Error Rules

- Call `start()` once the client and required host capabilities are composed.
- Consume public read-only state/event surfaces; call `dispose()` when the owning framework/container is destroyed.
- Pass cancellation tokens to cancellable operations; cancellation is cooperative and must be checked at async boundaries.
- Public failures are `ClientError`-compatible, normalized with safe code/source/recovery metadata. Do not expose secret-bearing transport, token, or provider payloads in UI errors or events.

## Compatibility

A public change must update package exports, the inventory, focused documentation, tests, and [TS SDK Migrations](110-TS_SDK_MIGRATIONS.md), following the applicable stability discipline above. Prefer additive migration paths when they do not preserve a misleading or unsafe model. Do not introduce an alias solely to hide an ownership correction.

---

[English](007-CLIENT_SDK_GUIDE.md) | [中文](../zh/007-CLIENT_SDK_GUIDE.md)
