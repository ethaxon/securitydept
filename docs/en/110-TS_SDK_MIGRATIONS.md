# TypeScript SDK Migrations

SecurityDept is pre-1.0. Breaking changes are intentional when they remove an incorrect ownership model, make a capability explicit, or reduce a public ambiguity. This document lists migrations that remain relevant to current adopters; released history belongs in [CHANGELOG](../../CHANGELOG.md).

## Migration Rules

For each SDK breaking change:

1. change package exports and `public-surface-inventory.json` together;
2. update the focused API contract and migration note;
3. add type-level and behavior coverage;
4. remove obsolete aliases unless compatibility has a clear, bounded value.

## Explicit `FoundationEnvironment`

Environment construction is now capability based. The canonical base transport key is `environment.transport`; `externalTransport` is not a compatibility alias. `time`, `realmStorage`, `span`, and `tracing` are required baseline capabilities. Browser-only capabilities remain optional.

Update composition roots to build a `FoundationEnvironment` through the relevant host creator, then pass it to clients. Do not let helper functions fetch browser globals or storage implicitly.

## Base Transport And Authorized Transport

`BaseTransportTrait` is the neutral HTTP executor. `ExternalTransportTrait` and `ManagedTransportTrait` are role types derived from that base. Environment carries neutral `transport`; authorization is projected by a derived managed transport from a base transport and an authorization-header replay signal.

Rename option fields from `externalTransport` to `baseTransport` when constructing an authorized transport. Do not maintain two environment transport concepts.

## Reactive Interoperability

`SignalTrait`, `EventStreamTrait`, and `CancellationTokenTrait` now provide observable interop. Public interfaces remain these SDK traits, while internal implementations may use RxJS operators directly and `@securitydept/client/rx` utilities for composition.

Replace custom Observable wrapper layers with direct RxJS interop, for example `from(client.authSnapshot)`, where they only forward subscriptions. Use `createNeverEventStream()` or `createEmptyEventStream()` when a public trait API needs RxJS `NEVER` or `EMPTY` semantics. Do not replace a public SDK trait with a raw Observable.

## Span And Trace Context

Span is a foundation capability, not a telemetry subfeature. Fork a child span at a top-level workflow boundary and run/record local work under it. Trace/event consumers may depend on span context, but public APIs must not assume host-level automatic propagation.

Remove token-set-specific global outcome/source carrier fields that only duplicate span nesting. Record local trace attributes at the behavior boundary instead.

## Token-Set Workflow And State Ownership

`BaseOidcModeClient` is the lifecycle host and sole in-memory snapshot authority. Restore, freshness/refresh, and clear logic use closed planners that return a discriminated final candidate; a serialized top-level workflow commits one final determination.

Remove controller-era duplicate snapshot/header state and refresh-barrier concepts. `start()` is the initial bootstrap API. `restorePersistedState()` remains public only as a manual persistence re-sync command, for example after external storage changes.

Workflow sources replace auth-check trigger terminology. Page-resume and refresh-timer sources enqueue lifecycle work; they do not own state or provide a bypass around serialization.

## Token-Set Events

Auth events are a direct discriminated union. The event `type` fixes its payload shape. The obsolete `TokenSetAuthEventPayloadMap`, `AuthCheck*` events, `TokenSetAuthFlowReason`, `TokenSetAuthFlowOutcome`, and `authCheckReason` contracts must not be used.

Only refresh events carry freshness and refresh-material facts. Auth event payloads never expose raw token material or authorization headers. Consumers that aggregate events must preserve the source contract or explicitly model an aggregation-only envelope rather than silently backfilling source fields.

## Persistence

Persistence follows the committed snapshot policy rather than being a second snapshot authority. A determination uses `persistPolicy: "follow_client" | "skip"`; `snapshot === null` under the follow policy naturally implies persistence clearing. The client commits the in-memory snapshot first, then attempts the corresponding persistence update. A persistence failure is recorded as a trace event and does not roll back or reject an otherwise successful authentication determination.

## Router And Callback Composition

Router integrations use `RouterTrait` and URI reference types. Token-set factories own callback input resolution and are started as part of factory construction. Registry readiness, not a direct persisted-restore call, is the initial readiness boundary for registry-owned clients.

## Framework Composition

| Previous integration pattern | Current contract |
| --- | --- |
| A domain-specific React Provider or Context for each auth family | Compose an environment with `createEnvironmentForReact(...)`, install one `SecuritydeptProvider`, and resolve dependencies with `useSecuritydeptContext()`. Context-family React packages expose focused hooks and callback bridges, not competing state contexts. |
| Browser globals or an app-local fetch layer discovered by a client | Build an explicit Web environment at the composition root with `createEnvironmentForNativeWeb(...)`, then pass the resulting environment or injector into the client composition. |
| Angular services that separately own router/transport/client state | Use `provideEnvironment(...)` for Angular router, `HttpClient`, injector, and destruction wiring. Context adapters consume that foundation environment. |
| App-local token-set callback parsing | In React use `useTokenSetFrontendCallback()` / `useTokenSetBackendCallback()`; in Angular use `TokenSetFrontendCallbackComponent` / `TokenSetBackendCallbackComponent` where the supplied behavior matches the host route. |

## Token-Set Registry And Route Security

The registry is the keyed lifecycle owner, not a second auth-state model. Register entries through `provideTokenSetClientRegistry(...)`; access a materialized client through `clientResourceFor(key)` and await `whenValue()` when asynchronous readiness is needed. `unregister(key)` removes the registration and disposes its materialized client.

Migrate obsolete service-wrapper access, including the removed `TokenSetAuthService`, to the mode client itself. Read its `authSnapshot`, `isAuthenticated`, `authorizationHeaderValue`, operation signals, and public events according to the host concern rather than reconstructing a combined adapter-local state machine.

For route protection, declare requirements with `secureTokenSetRouteRoot(...)` and `secureTokenSetRoute(...)`. React's TanStack Router helper runs through the registry planner; Angular additionally provides `provideTokenSetRequirementPlannerHost()`, `createTokenSetCanActivate()`, and `createTokenSetCanActivateChild()`. These APIs express authentication requirements only; application redirect policy and route UI remain host-owned.

For first boot, call `start()` for directly created clients. Do not call `restorePersistedState()` merely to make a registry-owned client ready; it remains a manual persistence re-sync command after external persistence changes.

## Verification Checklist

Before considering a migration complete:

- run the relevant TypeScript typecheck and tests under `mise`;
- validate exports against the public-surface inventory;
- search for removed vocabulary and old import keys;
- run `just lint-ts` and `git diff --check`;
- update both language documents and downstream examples/wrappers.

---

[English](110-TS_SDK_MIGRATIONS.md) | [中文](../zh/110-TS_SDK_MIGRATIONS.md)
