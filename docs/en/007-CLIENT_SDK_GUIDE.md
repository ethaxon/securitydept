# Client SDK Guide

This document defines the TypeScript SDK contract. It is the authority for package boundaries and host-integration rules. Application-specific code under `apps/webui` is a reference implementation, not public API.

## Package Families

| Package | Responsibility |
| --- | --- |
| `@securitydept/client` | Foundation traits: environment, transport, state/resources, events, cancellation, spans, tracing, injection, protocol and URL helpers. |
| `@securitydept/client-react` / `@securitydept/client-angular` | Framework bridges for the foundation traits. |
| `@securitydept/basic-auth-context-client*` | Basic-Auth boundary observations, login navigation, and local projection clearing. |
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
- `./test`

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
| `@securitydept/token-set-context-client/test` | Token Set client, registry entry, and registry fixtures. | Dependency-light test-only helpers; no test-runner or framework dependency. |

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

Client lifecycle event streams are hot, non-replaying edge streams. Current or stale state belongs in `SignalTrait` / `ResourceTrait`; diagnostic history belongs in an explicitly named trace timeline or event-history adapter. A late event subscriber must not re-run historical side effects such as toasts or metrics.

Failure variants carry a context-specific `ClientError` as a required `error` field. Consumers can use `from(client.events).pipe(filter(isClientErrorEvent))` to derive a default message stream without creating a second error subject. The same error instance is published to the Resource, failure event, and rejected operation. The full error is an in-process programming contract and must not be serialized directly; logging and tracing should derive secret-safe fields with `describeError(error)`, while UI adapters should use `readErrorPresentationDescriptor(error)`.

`createNeverEventStream()` and `createEmptyEventStream()` are the semantic equivalents of RxJS `NEVER` and `EMPTY` for public trait APIs.

## Span And Tracing

`SpanTrait` is a base context capability shared by tracing, errors, and future event correlation. Context propagation is explicit: clients fork a client frame, and each operation forks an operation frame. Shared attributes use the named `client.name`, `client.id`, and `operation.name` keys. Provider-specific details are written with `setAttributes(attributes, { providerId })`; a provider read sees its own attributes plus shared attributes by default, without flattening the root-to-node path. Attribute values use the immutable `SpanAttributeValue` contract. Span core relies on this readonly contract and only copies top-level records when state changes; it does not inspect, clone, or freeze nested values. Read attributes with `getAttributes()` or `getRootToNodeAttributes()`.

Tracing writes protocol and lifecycle detail under `TRACING_SPAN_ATTRIBUTE_PROVIDER_ID`. A `TracingEvent` keeps a live span reference; a buffering subscriber such as `createTraceTimelineStore()` reads and stores the tracing-visible root-to-node frames at its own consumption boundary. The timeline uses an SDK-internal fixed-capacity ring buffer and requires no additional runtime package. Its non-replaying `latestEntry` stream emits each recorded entry and `null` after clear; the `entries` getter creates a readonly array snapshot only when a consumer needs the full timeline. Operation creator options use `traceAttributes`, not the former generic `fields` input.

`ClientError` captures the first error-visible span path, preserving the concrete error instance and subclass. The snapshot contains shared attributes plus `CLIENT_ERROR_SPAN_ATTRIBUTE_PROVIDER_ID` attributes, never tracing-only details. `readErrorPresentationDescriptor()` uses the deepest client identity and operation name by default, so a generic message stream can produce source-aware UI text without an event-type mapping. Set `contextFormatter: null` to disable this prefix or provide a formatter that returns a localized context label.

Trace records describe the local action. Do not add parallel global source/outcome enums merely to reconstruct nesting that the span tree already provides. Freshness is a refresh-boundary fact, not a default field of every auth event or trace.

## Auth Context Clients

### Basic Auth

`BasicAuthContextClient` models zone-aware challenge boundaries. It does not manage or revoke the browser credential cache. The client exposes boundary snapshots, operations, and events; login navigation remains an explicit host/router action. Its `logout()` method only clears the current in-memory boundary projection and performs no network request.

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
- Token-set hosts register keyed clients with `provideTokenSetClientRegistry(...)`. The registry's `authEvents` and `errors` streams aggregate ready-client auth events and all client/factory errors without requiring hosts to flatten per-client resources. React reads the registry with `useTokenSetClientRegistry()` and callback hooks; Angular provides the same core registry and can use its callback components, route-root helpers, and guard factories.
- Route helpers express requirements and delegate evaluation to the registry/client lifecycle. The application still owns its route tree, redirects, UI, and user-facing copy.

Router navigation mode determines which host mechanism receives a target. The Angular adapter composes both mechanisms into one `RouterTrait`: pass native-web `navigation`, `location`, `history`, and `window` options beside the Angular `router` in `CreateRouterForAngularOptions` (or in `provideEnvironment({ routerForAngularCreateOptions: ... })`). Push and replace stay in Angular Router; external requests, including OIDC authorization URLs, use the internally composed native-web router. Applications do not register or choose a second environment router.

The TanStack React Router adapter maps push and replace requests to `router.navigate({ to, ... })`, while external requests use `router.navigate({ href })`. Do not pass an absolute IdP URL through `to`; TanStack treats `to` as an internal route destination.

## Lifecycle And Error Rules

- Call `start()` once the client and required host capabilities are composed.
- Consume public read-only state/event surfaces; call `dispose()` when the owning framework/container is destroyed.
- Pass cancellation tokens to cancellable operations; cancellation is cooperative and must be checked at async boundaries.
- Public failures use context-owned `ClientError` values with safe code/source/recovery metadata. Do not expose secret-bearing transport, token, or provider payloads in UI errors or events.

## Compatibility

A public change must update package exports, the inventory, focused documentation, tests, and [TS SDK Migrations](110-TS_SDK_MIGRATIONS.md), following the applicable stability discipline above. Prefer additive migration paths when they do not preserve a misleading or unsafe model. Do not introduce an alias solely to hide an ownership correction.

---

## Refresh Error Recovery

Both OIDC mode configs accept `refreshErrorPolicy`, implemented by `BaseOidcModeClient`. The default is `"revokeAsUnauthenticated"`: confirmed refresh-token revocation resolves to `null`, clears persisted credentials, and publishes resolved unauthenticated state. Registry factories remain ready, allowing a protected-route guard to start interactive login and preserve the attempted URL. The client itself does not navigate on revocation.

Use `"revokeAsUnauthenticatedOnInit"` to recover only refreshes performed while `start()` restores a persisted session, or `"throw"` to retain rejecting operations. Explicit `restorePersistedState()` is a manual operation. All policies clear credentials already proven revoked.

A synchronous or asynchronous handler receives `{ error, operation, trigger, clientId, cancellationToken }` and returns `"unauthenticated"` or `"throw"`. Operations are `"restorePersistedState"` and `"refresh"`; triggers are `"initialization"`, `"manual"`, `"refreshTimer"`, and `"pageResume"`. These contracts and their named constants are exported from `@securitydept/token-set-context-client/orchestration`.

Only protocol-classified `TokenSetAuthorizationRevocationError` (`invalid_grant` or a qualifying Bearer `invalid_token` challenge) permits unauthenticated recovery, including when a handler requests it. Plain 401, network, configuration, protocol, storage, and cancellation failures are not reclassified; callback/code-exchange failures are outside this policy. Handler failures and cancellation reject while still removing already revoked material. Existing lifecycle failure events and tracing retain the original protocol error; auth events are not replayed to late subscribers.

[English](007-CLIENT_SDK_GUIDE.md) | [中文](../zh/007-CLIENT_SDK_GUIDE.md)
