# Client SDK Guide

This document is the **authoritative overview** for the SecurityDept client SDK family.  
It answers three questions:

- which TypeScript public surfaces currently exist and who owns them
- which surfaces are `stable`, `provisional`, or `experimental`
- where adopters should enter and what must **not** be treated as SDK surface

It no longer tries to be the source of truth for:

- the full auth-context / mode design: see [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)
- current priorities, backlog, and deferred boundaries: see [100-ROADMAP.md](100-ROADMAP.md)
- 0.x migration and breaking-change history: see [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)

Target readers:

- human developers implementing SDK modules
- AI agents reviewing or editing SDK code/docs
- adopters who need to understand package and subpath boundaries

## Goal

The client SDK is not meant to recreate the server-side `auth-runtime`, and it is not meant to collapse every concern into one monolithic package.  
Its job is to provide:

- clear auth-context product surfaces
- an explicit framework-neutral foundation
- thin but testable browser / server / framework adapters
- public contracts that can be calibrated by both reference apps and real adopters

Current productization priority:

1. TypeScript SDK
2. Kotlin SDK (later)
3. Swift SDK (later)

Current explicit conclusion:

- TypeScript remains the only active productization track
- Kotlin / Swift are still directional commitments rather than synchronized product surfaces with a shared external contract today

## Rust / Server Diagnosis Baseline

The authoritative owner for the current Rust / server auth-flow diagnosis baseline is the shared `securitydept-utils::observability` contract.

Current stable vocabulary:

- `AuthFlowDiagnosis`
- `AuthFlowDiagnosisOutcome`
- `DiagnosedResult<T, E>`

Current operation names already adopted on real server-side auth paths:

- `projection.config_fetch`
- `oidc.callback`
- `oidc.token_refresh`
- `propagation.forward`
- `forward_auth.check`
- `session.login`
- `session.logout`
- `session.user_info`
- `basic_auth.login`
- `basic_auth.logout`
- `basic_auth.authorize`

Current owner boundary:

- `securitydept-utils` owns the shared machine-readable diagnosis contract
- `securitydept-token-set-context`, `securitydept-oidc-client`, and `securitydept-session-context` consume that contract for auth-flow operations
- `apps/server` is the HTTP boundary that logs and exposes those diagnosed results; it is not the vocabulary owner

What is already productized:

- frontend-mode config projection now returns a direct machine-readable diagnosis surface that focused Rust tests can assert
- callback / token refresh diagnosis is now shared at the OIDC client layer and consumed by session and backend-oidc server paths
- forward-auth and propagation now emit stable `operation` / `outcome` / key-field diagnosis records rather than only human-readable route logs
- session-context login / logout / user-info now emit stable diagnosed results owned by `securitydept-session-context` and consumed directly by `apps/server`
- basic-auth login / logout / authorize now emit stable diagnosed results owned by `securitydept-basic-auth-context`, while protocol-specific response semantics remain owned by the Basic Auth context itself

What is not yet productized:

- broader route coverage outside these high-value auth paths
- a full timeline/exporter/OTel pipeline
- a complete replacement of all plain `tracing` logs with diagnosed surfaces

## Rust / Server Error Baseline

The authoritative owner for the current Rust / server dual-layer HTTP error baseline is the shared `securitydept-utils::error` contract.

Current shared server error contract:

- `ErrorPresentation`
- `UserRecovery`
- `ServerErrorKind`
- `ServerErrorDescriptor`
- `ServerErrorEnvelope`

Current boundary split:

- diagnosis continues to answer what happened and is owned by `securitydept-utils::observability`
- the server error envelope answers how a host or client should interpret and recover from an HTTP failure, and is owned by `securitydept-utils::error`
- `apps/server` maps `ServerError` into the shared server error envelope; it does not own the envelope schema itself

Current productized route/path coverage:

- frontend-mode projection failures now leave the server through the shared `ServerErrorEnvelope`
- session callback failures now leave the server through the shared `ServerErrorEnvelope`
- backend-mode callback / refresh failures now leave the server through the shared `ServerErrorEnvelope`
- dashboard propagation auth-boundary failures (`propagation_auth_method_mismatch`, `propagation_disabled`) now also leave `apps/server` through the shared `ServerErrorEnvelope` instead of route-local JSON

Current envelope guarantees:

- stable machine-facing `kind` and `code`
- stable recovery vocabulary
- host-facing `presentation` descriptor embedded alongside the machine-facing fields
- compatibility for consumers that still read `error.code` / `error.message` / `error.recovery` directly

Current browser/server symmetry evidence:

- `apps/webui` frontend-mode config projection fetch now preserves structured server envelopes as `ClientError` instead of collapsing them into app-local `Error` strings
- `apps/webui` dashboard API client now consumes structured auth envelopes through `ClientError.fromHttpResponse()` instead of app-local status/message parsing
- the reference app now has direct focused evidence for `ServerErrorEnvelope -> ClientError -> readErrorPresentationDescriptor()` on both the frontend-mode config path and a dashboard auth-boundary path

What is not yet productized:

- route-local statuses and messages that do not pass through `ServerError`
- protocol-specific Basic Auth challenge / logout-poison responses still remain explicit plain-status exceptions because they must preserve `WWW-Authenticate` and poison-response semantics
- a full RFC 7807/problem-details platform
- full cross-language unification of every browser and server error schema

## Protocol-Specific Auth Exception Baseline

The authoritative owner for the current Basic Auth protocol-specific exception baseline is `securitydept-basic-auth-context`.

Current protocol-specific contract:

- `BasicAuthProtocolResponseKind`
- `BasicAuthProtocolResponse`
- `BasicAuthZone::login_challenge_protocol_response()`
- `BasicAuthZone::logout_poison_protocol_response()`
- `BasicAuthZone::unauthorized_protocol_response_for_path()`

Current boundary split:

- `securitydept-utils::error` continues to own the shared server error envelope baseline for ordinary HTTP failures
- `securitydept-basic-auth-context` owns Basic Auth responses that must preserve RFC-7235-style challenge semantics or poison/logout semantics
- `apps/server` and browser consumers should treat these paths as protocol-specific exceptions rather than trying to parse them as `ServerErrorEnvelope`

Current productized path coverage:

- the explicit `/basic/login` challenge path now resolves through the shared Basic Auth protocol-response owner instead of route-local response assembly
- the `/basic/logout` poison path now resolves through the same owner instead of a route-local plain `401`
- protected JSON paths inside the Basic Auth zone now use the same owner to distinguish plain unauthorized responses from explicit challenge responses

Current direct consumer evidence:

- crate-level tests prove that challenge responses keep `WWW-Authenticate` while poison responses do not
- `apps/webui` now has a dedicated `readBasicAuthBoundaryKind()` helper and focused tests that distinguish challenge, logout-poison, and plain unauthorized JSON probe results without treating them as ordinary envelope failures
- `apps/webui` now also has a browser-level Basic Auth reference sequence that keeps protocol guarantee separate from browser-observed behavior: under Chromium automation with no cached credentials, top-level `/basic/login` navigation is observed as a browser auth error, while `/basic/logout` still returns a plain `401` without `WWW-Authenticate` and the protected JSON probe remains plain unauthorized
- `apps/webui` now also has a second verified Chromium browser sequence for the authenticated logout path under a formal browser harness: a context that injects `Authorization` reaches `200` on the protected backend probe before logout, `/basic/logout` still returns a plain `401` without `WWW-Authenticate`, and the next protected probe remains authenticated because the harness continues to send credentials
- Chromium and Firefox now also make the browser-specific divergence explicit on the no-cached-credentials challenge path: the verified high-level conclusion stays the same, but Chromium surfaces a browser auth error while Firefox surfaces a native `NS_ERROR_*` failure page

What remains outside this baseline:

- a broader generalized challenge-framework abstraction across non-Basic protocols
- browser-specific heuristics beyond the current challenge-vs-poison-vs-plain-401 split
- native browser-managed credential-cache eviction evidence after an authenticated logout; the current browser proof covers Chromium's no-cached-credentials path plus a Chromium authorization-header harness, but still does not establish a universal cross-browser logout-eviction guarantee
- a fully verified third-browser baseline across every auth-flow scenario; Firefox is now a verified second browser (detected from the Playwright-managed cache with all 10 auth-flow scenarios passing), and WebKit now has a canonical distrobox-hosted Ubuntu execution path with one real verified callback scenario, but the broader WebKit matrix is still incomplete

## Browser Harness Capability Baseline

The authoritative owner for the current browser harness capability and verified-environment baseline is `apps/webui/e2e/support/browser-harness.ts`.

This owner formally reports:

- which Playwright browser projects are detected and available, blocked, or unavailable in the current environment
- which executable baseline produced that browser project (`system-executable` vs `playwright-managed`)
- which execution baseline the project belongs to (`host-native` vs `distrobox-hosted`)
- which execution baseline policy applies to each browser (`primary-authority`, `host-truth`, `canonical-recovery-path`, `not-adopted`)
- which browsers are unavailable or blocked and why (executable not detected, project not configured, host dependencies missing)
- which auth-flow scenarios are verified on which browser, distinguishing browser-native from harness-backed paths
- which scenarios remain unverified because the browser is unavailable or blocked

Current baseline split:

| Browser path | Availability | Executable baseline | Execution baseline | Reason |
|---|---|---|
| Chromium on the host | available | system executable | host-native | system executable detected |
| Firefox on the host | available | Playwright-managed | host-native | Playwright-managed executable detected |
| WebKit on non-Debian/Ubuntu hosts | blocked | Playwright-managed | host-native | runtime probe observed missing host dependencies during WebKit startup |
| WebKit in `distrobox` `playwright-env` | available | Playwright-managed | distrobox-hosted | repo-provided Ubuntu 24.04 execution path; the full current 10-scenario harness matrix is verified there |

Current verified auth-flow scenarios:

| Scenario | Path kind | Suite |
|---|---|---|
| `basic-auth.challenge.no-cached-credentials` | browser-native | basic-auth |
| `basic-auth.logout.authorization-header-harness` | harness-backed | basic-auth |
| `frontend-oidc.callback.redirect` | browser-native | frontend-oidc |
| `frontend-oidc.popup.relay` | browser-native | frontend-oidc |
| `frontend-oidc.popup.closed-by-user` | browser-native | frontend-oidc |
| `frontend-oidc.cross-tab.storage` | browser-native | frontend-oidc |
| `frontend-oidc.callback.duplicate-replay` | browser-native | frontend-oidc |
| `frontend-oidc.callback.unknown-state` | browser-native | frontend-oidc |
| `frontend-oidc.callback.stale-state` | browser-native | frontend-oidc |
| `frontend-oidc.callback.client-mismatch` | browser-native | frontend-oidc |

All 10 scenarios above are verified on both Chromium and Firefox in the host-native baseline. WebKit is no longer a single flattened story: the host-native path on non-Debian/Ubuntu hosts is still formally `blocked` with reason `host-dependencies-missing`, but its details now come from a runtime startup probe rather than a hard-coded library list. The canonical repo-provided distrobox-hosted Ubuntu path reports WebKit as `available` and now verifies the full current 10-scenario harness matrix through real browser-owned runs. Under that distrobox-hosted baseline, WebKit currently has 10 verified scenarios, 0 blocked scenarios, and 0 unavailable scenarios.

Both the `basic-auth` and `frontend-oidc` e2e suites consume this owner at test time and assert the verified-environment baseline directly instead of relying on prose.

Current execution baseline policy:

| Browser | Preferred execution baseline | Host-native role | Distrobox-hosted role |
|---|---|---|---|
| Chromium | host-native | primary-authority | not-adopted |
| Firefox | host-native | primary-authority | not-adopted |
| WebKit | distrobox-hosted | host-truth | canonical-recovery-path |

This policy is now part of the owner contract rather than only a documentation convention. Chromium and Firefox keep host-native browser-owned evidence as the current authority because that evidence is already verified on the host. WebKit keeps host-native bring-up failures as real host truth on unsupported Linux hosts, but distrobox-hosted Ubuntu is the canonical recovery path that can establish verified browser-owned evidence.

The `playwright.config.ts` derives its browser detection from the same owner rather than maintaining independent executable-detection logic. Managed-browser capability detection now prefers the Playwright runtime contract (`browserType.executablePath()`) plus repo-level executable overrides instead of scanning private cache layout. By default it still runs only available browsers for the current execution baseline. Setting `PLAYWRIGHT_INCLUDE_BLOCKED_PROJECTS=1` still allows a blocked browser such as host-native WebKit to be targeted explicitly for evidence gathering without breaking the default green matrix, while the repo-provided `distrobox` `playwright-env` is now the canonical way to run WebKit on Linux non-Debian/Ubuntu hosts.

The current strategy is intentionally not “put every browser into distrobox”. If Chromium and Firefox were flattened into the same containerized path today, the project would lose direct host-native authority for browser-owned challenge, popup, and callback behavior even though those host baselines are already verified.

What is not yet productized:

- runtime UI integration that renders the harness report dynamically
- cross-workspace harness reporting (only `apps/webui` is covered)

Current browser-specific divergence that is now part of authority:

- Chromium and Firefox share the same verified no-cached-credentials Basic Auth conclusion
- the browser-owned failure surface still diverges (`ERR_INVALID_AUTH_CREDENTIALS` in Chromium vs a native `NS_ERROR_*` failure surface in Firefox)
- WebKit now has two formal outcomes: host-native execution can still fail at launch time on non-Debian/Ubuntu hosts because MiniBrowser cannot start without the missing host libraries above, while the canonical distrobox-hosted Ubuntu path now has a fully verified 10-scenario harness matrix
- WebKit Basic Auth now introduces a narrower browser-specific divergence inside that verified matrix: under distrobox-hosted WebKit, the explicit `/basic/login` challenge commits a `401` response with `WWW-Authenticate`, while Chromium and Firefox still surface browser-owned auth failure channels before page render

## Top-Level Decisions

- client SDKs stay separate from server route-orchestration concepts
- public packages are split by auth context or capability
- root surfaces stay framework-neutral by default
- framework adapters ship as independent npm packages
- browser / server helpers ship as same-package subpaths such as `./web` and `./server`
- TypeScript packages are `ESM only`
- packages are side-effect free by default
- global polyfills are not bundled by default

## Terminology and Naming

Do not reuse `core` for the shared client base layer.  
The current terminology is:

- `client`: the user-facing foundation package
- `foundation`: the conceptual shared infrastructure layer, not the main public package name
- `basic-auth-context-client`: the Basic Auth zone-aware client family
- `session-context-client`: the cookie-session client family
- `token-set-context-client`: the token-set / OIDC-mode client family

Public protocol names still use the `Trait` style to avoid collisions with host or standard objects, for example:

- `ReadableSignalTrait`
- `WritableSignalTrait`
- `EventStreamTrait`
- `LoggerTrait`
- `CancellationTokenTrait`

For the full auth-context / zone / mode vocabulary, see [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md).

## Packaging Style

The TypeScript family is currently split by capability and auth context. The real package structure is:

- `@securitydept/client`
- `@securitydept/client/web`
- `@securitydept/client/persistence`
- `@securitydept/client/persistence/web`
- `@securitydept/basic-auth-context-client`
- `@securitydept/basic-auth-context-client/web`
- `@securitydept/basic-auth-context-client/server`
- `@securitydept/basic-auth-context-client-react`
- `@securitydept/basic-auth-context-client-angular`
- `@securitydept/session-context-client`
- `@securitydept/session-context-client/web`
- `@securitydept/session-context-client/server`
- `@securitydept/session-context-client-react`
- `@securitydept/session-context-client-angular`
- `@securitydept/token-set-context-client/backend-oidc-mode`
- `@securitydept/token-set-context-client/backend-oidc-mode/web`
- `@securitydept/token-set-context-client/frontend-oidc-mode`
- `@securitydept/token-set-context-client/orchestration`
- `@securitydept/token-set-context-client/access-token-substrate`
- `@securitydept/token-set-context-client/registry`
- `@securitydept/token-set-context-client-react`
- `@securitydept/token-set-context-client-react/react-query`
- `@securitydept/token-set-context-client-angular`
- `@securitydept/client-react`
- `@securitydept/client-react/tanstack-router`
- `@securitydept/client-angular`

The packaging rules stay the same:

- framework-neutral root surfaces must not require React / Angular
- framework adapters stay in independent packages
- framework peers stay in `peerDependencies`
- Angular adapters are built through `ng-packagr` and APF / FESM2022 output
- independent framework-adapter packages are the current formal product boundary; same-package subpaths should no longer be treated as the default direction

## Recommended Repository Layout

The client SDK should stay in a dedicated library workspace instead of letting `apps/webui` dictate structure.

Current recommended layout:

```text
sdks/
  ts/
    packages/
      client/
      basic-auth-context-client/
      session-context-client/
      token-set-context-client/
      basic-auth-context-client-react/
      session-context-client-react/
      token-set-context-client-react/
      basic-auth-context-client-angular/
      session-context-client-angular/
      token-set-context-client-angular/
      client-react/
      client-angular/
      test-utils/
```

`apps/webui` is the first-priority React reference app. It is **not** the source of truth for SDK build topology.

<a id="typescript-sdk-coding-standards"></a>
## TypeScript SDK Coding Standards

The following rules apply under `sdks/ts/`.

### Enum-like String Domains

For bounded string domains, prefer:

```ts
export const Foo = {
  Bar: "bar",
  Baz: "baz",
} as const;
export type Foo = (typeof Foo)[keyof typeof Foo];
```

Avoid TypeScript `enum`.

### Named Constants for Public Contracts

Extract named constants for stable vocabulary such as public error codes, trace event names, or log scope tags.  
One-off UI copy or purely local strings should remain inline.

### API Shape: Options Object First

<a id="ts-sdk-api-shape"></a>

Public SDK functions default to **options objects** for optional parameter sets.  
A bare positional second parameter is only acceptable when the meaning is self-evident and there is clear ergonomic value.

When an existing API widens, the whole second parameter should become an options object even if that is breaking.  
`0.x` does not mean silent breakage is acceptable; widening still follows a deliberate API direction.

## Foundation Design

The `@securitydept/client` family is the shared foundation. It does not own auth-context-specific business state machines; it owns reusable cross-context primitives and contracts.

### State Primitives

Direction: snapshot-first, readonly views first, state transitions owned by clients or services.  
Public shape stays centered on `ReadableSignalTrait`, `WritableSignalTrait`, and `ComputedSignalTrait`.

### Event Primitives

Direction: a minimal shared event protocol rather than a hard dependency on one observable library.  
Public shape stays centered on `EventObserver`, `EventSubscriptionTrait`, and `EventStreamTrait`.

Two extra rules remain important:

- the public event layer stays intentionally thin; richer operators such as `switchMap`, `concatMap`, `exhaustMap`, `debounce`, `throttle`, and `withLatestFromSignal` are not yet part of the current productized baseline
- event-envelope structure, timeline source taxonomy, and command/domain-event layering remain valid design directions, but only the parts that already entered inventory/evidence count as current public contract

### Transport

The foundation defines transport protocols, not one concrete HTTP client or middleware style.  
SDK adapters may consume fetch / axios / Angular HttpClient, but foundation does not own them directly.

### Persistence

`@securitydept/client/persistence` and `@securitydept/client/persistence/web` own storage protocols and browser storage adapters.  
The rules are:

- persistence protocols are stable foundation surface
- browser storage glue lives behind the `/web` subpath
- token material or projection-cache business policy should not be scattered into adopter apps

The current persistence authority also includes the one-time-use callback/redirect contract:

- `RecordStore.take(key)` is the formal atomic single-consume capability within a store's consistency domain
- the repo-provided in-memory and browser storage adapters implement that capability directly
- `createEphemeralFlowStore()` / `createKeyedEphemeralFlowStore()` are the canonical helpers for redirect and callback state that must be consumed exactly once

Persistence should still be read semantically rather than as a universal KV:

- long-lived state
- recoverable state
- ephemeral flow state

The current formal conclusions are:

- TTL and watch semantics are not mandatory foundation persistence capabilities
- key conflicts should be solved through keyspace / ownership before hooks or middleware
- persistence and signal state remain layered concerns rather than one merged store abstraction

### Auth Coordination

`@securitydept/client/auth-coordination` owns shared cross-auth-context orchestration primitives:

- requirement planner
- planner host
- matched-route-chain orchestration
- candidate selection / effective client-set composition

It is a shared capability layer and no longer a token-set-only owner.

### Configuration

The configuration system owns:

- source layering
- config normalization
- config projection
- freshness / precedence semantics

It does not own product-level route policy or business decisions.

The following also remains explicit:

- capability injection still comes before global singleton config
- runtime/foundation config, auth-context config, and adapter/host config stay layered
- there is no one big public configuration DSL today; if a future discussion shape has not entered inventory/evidence yet, it must not be described as current fact

### Scheduling and Unified Input Sources

The foundation continues to own:

- `timer`
- `interval`
- `scheduleAt`
- `fromEventPattern`
- thin browser input-source bridges such as visibility handling

These are shared scheduler/input primitives, not private implementations of one auth context.

The current public baseline is still deliberately conservative:

- `fromSignal`
- `fromPromise`
- `fromStorageEvent`
- `fromAbortSignal`

These richer helpers remain valid future directions from the original design discussion, but they are not current productized foundation entry points.

### Internal Dependency Injection

DI exists as a capability in framework adapters or internal runtime glue.  
Angular / React DI semantics must not leak back into the foundation root surface.

The current internal wiring discipline also remains explicit:

- prefer explicit capability wiring over a formal DI container
- keep runtime dependencies separate from business config
- keep composition roots concentrated
- reflective / decorator / metadata-driven resolution is still not the current foundation direction

## Context Client Design

The three auth-context client families have the following roles.

### `basic-auth-context-client`

Positioning: thin, zone-aware, browser/server convenience.  
Its job is not to grow into a full frontend runtime. It exists to help adopters handle:

- zone-aware `401 -> login`
- logout URLs and logout helpers
- redirect instructions in server-host scenarios
- login URLs that carry the unified `post_auth_redirect_uri` query parameter

### `session-context-client`

Positioning: the client family for the cookie-session auth context.  
It owns:

- login-redirect convenience
- session user-info probing
- React / Angular provider and hook integration
- server-host helpers

It is not a mode family and does not share token-set-style internal mode splits.

### `token-set-context-client`

Positioning: the product family for the token-set auth context.  
It remains the most complete client family today, but this document now keeps only the **public-surface conclusions**. The full mode / ownership design lives in [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md).

The current formal family surface is:

- `/backend-oidc-mode`
- `/backend-oidc-mode/web`
- `/frontend-oidc-mode`
- `/orchestration`
- `/access-token-substrate`
- `/registry`
- independent React / Angular adapter packages

Core rules:

- the mode family still belongs to `token-set-context`
- shared route / framework glue has moved back to `@securitydept/client*`
- the browser-owned baseline stays clearly separate from mixed-custody / BFF themes

## SSR / Server-Side Support

In the TypeScript SDK vocabulary, SSR / server-host support means **helpers and contracts for server-hosted client code**, not the Rust backend crates themselves.

### `basic-auth-context` and `session-context`

Both families now have a dedicated `./server` helper baseline.  
The current recommended entry is:

- `basic-auth-context-client/server` for unauthorized redirect instructions and login/logout URLs
- `session-context-client/server` for cookie forwarding, user-info probing, and login/logout URLs

### `token-set-context`

`token-set-context` still does **not** include server-side token ownership in the `0.2.0` baseline.  
Browser-owned token material remains the current baseline; mixed-custody, BFF, and server-side token-set ownership remain deferred in [100-ROADMAP.md](100-ROADMAP.md).

## Error Model

The error model continues to follow:

- transport / protocol / domain layering
- explicit error codes over message-only strings
- public errors that remain interpretable instead of leaking host-internal exception shapes

But the error model should not be read as “just one Error class”:

- machine-facing runtime errors
- user-facing presentation / recovery hints

These two layers remain the authoritative direction.  
Stable `code` and `recovery` are closer to public contract than message text; reference hosts should model around them instead of parsing `error.message`.

Current productized owner boundaries are now explicit:

- `@securitydept/client` owns the shared dual-layer bridge: `ClientError` remains the machine-facing runtime contract, while `ErrorPresentationDescriptor`, `ErrorPresentationTone`, and `readErrorPresentationDescriptor()` are the shared host-facing presentation/recovery contract
- `@securitydept/token-set-context-client/frontend-oidc-mode` owns the family-specific callback presentation mapping through `describeFrontendOidcModeCallbackError()`, which translates stable callback codes into host-facing titles/descriptions on top of the shared descriptor contract rather than pushing that wording into each app
- `@securitydept/token-set-context-client-react` now exposes `CallbackResumeErrorDetails.presentation`, so browser-owned callback hosts can consume a stable presentation descriptor directly instead of reverse-engineering one from `error.message`
- the reference app proves this split on real host paths: frontend callback, frontend popup failure, and backend-mode refresh / clear failures all render from the shared descriptor contract, while host-owned links/labels remain app responsibility

## Cancellation and Disposal

The public contract still expects:

- long-running browser flows can be canceled or reset
- services / controllers / providers can release resources on teardown
- adopters should not have to manually clean up SDK-owned watchers, timers, or subscriptions

The following boundaries are still intentionally unresolved rather than forgotten:

- the bridge between `CancellationTokenTrait` / `CancellationTokenSourceTrait` and `AbortSignal`
- the relation between `DisposableTrait` and `Symbol.dispose`
- whether linked cancellation sources enter a future baseline

## Logging, Tracing, and Testing

The rules stay the same:

- the foundation provides logger / trace integration points
- reference apps may build probes, timelines, and diagnostics, but those do not automatically become SDK public surface
- real authority is maintained by inventory + evidence + release-gate

Three engineering rules also remain important:

- logger, trace sink, and operation tracer should still be treated as separate layers rather than one flat logging interface
- structured trace, state snapshots, and redirect instructions stay higher-priority observation surfaces than text logs
- test-tool directions such as `FakeClock`, `FakeScheduler`, `FakeTransport`, and `InMemoryTraceCollector` remain valid methodology, but only the parts that entered public surface count as formal SDK contract

## Build, Compatibility, and Side Effects

### Output and Compatibility

The TypeScript family is ESM-first.  
Adapter packages and core packages share that direction; there is no longer a dual-track build story for legacy packaging.

### Polyfills

The SDK does not bundle global polyfills by default.  
If host capabilities must be patched, the adopter must decide explicitly.

### sideEffects / Tree Shaking

Public packages should be tree-shakeable by default.  
Any import-time side effect must be treated as serious contract pollution.

`sideEffects: false` should still be read as a design target, not as an accidental by-product of the current build.

## API Stability

### Current 0.x Freeze Semantics

The canonical meaning is now:

| Stability | Meaning | Change discipline |
|---|---|---|
| `stable` | frozen adopter-facing surface | `stable-deprecation-first` |
| `provisional` | public and usable, but still allowed to evolve under migration discipline | `provisional-migration-required` |
| `experimental` | allowed to move quickly with no stability promise | `experimental-fast-break` |

### Current Contract Snapshot

The table below is the current TS SDK public-surface authority snapshot. It must remain aligned with `public-surface-inventory.json`.

| Surface | Stability | Owner | Change discipline |
|---|---|---|---|
| `@securitydept/client` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/persistence` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/persistence/web` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/web` | `stable` | `foundation` | `stable-deprecation-first` |
| `@securitydept/client/auth-coordination` | `provisional` | `foundation` | `provisional-migration-required` |
| `@securitydept/client/web-router` | `provisional` | `foundation` | `provisional-migration-required` |
| `@securitydept/basic-auth-context-client` | `stable` | `basic-auth-context` | `stable-deprecation-first` |
| `@securitydept/basic-auth-context-client/web` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/basic-auth-context-client/server` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/basic-auth-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/session-context-client` | `stable` | `session-context` | `stable-deprecation-first` |
| `@securitydept/session-context-client/web` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/session-context-client/server` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/backend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/backend-oidc-mode/web` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/orchestration` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/access-token-substrate` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client/registry` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/test-utils` | `experimental` | `foundation` | `experimental-fast-break` |
| `@securitydept/basic-auth-context-client-angular` | `provisional` | `basic-auth-context` | `provisional-migration-required` |
| `@securitydept/session-context-client-angular` | `provisional` | `session-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-react/react-query` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/token-set-context-client-angular` | `provisional` | `token-set-context` | `provisional-migration-required` |
| `@securitydept/client-react` | `provisional` | `shared-framework` | `provisional-migration-required` |
| `@securitydept/client-react/tanstack-router` | `provisional` | `shared-framework` | `provisional-migration-required` |
| `@securitydept/client-angular` | `provisional` | `shared-framework` | `provisional-migration-required` |

#### How To Read `token-set-context-client` Subpaths

The token-set family should now be read like this:

- `/backend-oidc-mode`: platform-neutral client / service / token-material entry
- `/backend-oidc-mode/web`: browser glue
- `/frontend-oidc-mode`: frontend-owned OIDC mode
- `/orchestration`: token-material lifecycle / propagation shared layer
- `/access-token-substrate`: access-token propagation vocabulary and substrate contract
- `/registry`: shared multi-client lifecycle core

#### Capability Boundary Rules

- framework route glue belongs to `@securitydept/client-react` / `@securitydept/client-angular`
- browser token-lifecycle glue belongs to the token-set family
- app-local business helpers are not SDK public surface
- reference apps are authority evidence, not default owners

#### token-set-context-client Frontend Subpath / Abstraction Split

Frontend adopters should now reason about the stack in three layers:

1. foundation / shared coordination
2. token-set mode / substrate / registry
3. framework adapters and reference-app consumption

The token-set family should no longer be read as the sole owner of every piece of frontend glue.

#### Config Projection Source Contract (`frontend-oidc-mode/config-source.ts`)

`frontend-oidc-mode` remains the projection-source authority.  
Source precedence, freshness, restore, and revalidate semantics belong there; how a host obtains config (network / bootstrap script / persisted) is handled by the mode surface plus adopter glue.

#### Reference-App Host Evidence (`apps/webui` / `apps/server`)

The reference app now proves two distinct token-set host modes instead of one generic “Token Set” path:

- backend mode: server-owned callback and redirect completion via `/auth/token-set/backend-mode/*`, with the reference page at `/playground/token-set/backend-mode`
- frontend mode: browser-owned callback via `/auth/token-set/frontend-mode/callback`, with config projection served from `/api/auth/token-set/frontend-mode/config` and the host page at `/playground/token-set/frontend-mode`

That host split changes how React authority should be read:

- `TokenSetCallbackComponent` is now validated only through the frontend-mode callback route, not through the older backend-owned path
- bearer-backed dashboard access is proven across both token-set modes by the same keyed React Query / registry surface
- TanStack route security still closes over both token-set modes with `createSecureBeforeLoad()` + `withTanStackRouteRequirements()`; no additional React-only secure-guard convenience layer was needed in the reference app

It also changes how frontend-mode callback correctness should be read:

- pending redirect state is keyed by OAuth `state`, not stored under one global pending slot
- callback consumption is built on the foundation `RecordStore.take()` capability via keyed ephemeral flow stores
- duplicate replay, missing state, stale pending state, and client-mismatch callback paths are part of the public correctness contract rather than best-effort app glue
- React callback hosts should render from structured callback failure details (`code`, `recovery`, `kind`, `source`) rather than parsing opaque `Error.message` text
- the reference app callback route now productizes `callback.unknown_state`, `callback.pending_stale`, `callback.pending_client_mismatch`, and `callback.duplicate_state` as stable browser-visible host states with restart guidance, and browser e2e asserts those host-visible outcomes directly

Frontend-mode browser authority now also includes popup and lifecycle proof in the same host:

- popup login is no longer just an SDK helper baseline; the reference app owns a real popup relay route at `/auth/token-set/frontend-mode/popup-callback`, starts popup login from `/playground/token-set/frontend-mode`, and proves success plus a host-visible `popup.closed_by_user` failure through browser e2e
- `FrontendOidcModeClient.popupLogin()` now uses `popupCallbackUrl` as the actual OAuth `redirect_uri` and allows an optional `postAuthRedirectUri`, so host-owned popup relay pages no longer depend on redirect-uri spoofing or app-local workarounds
- cross-tab lifecycle authority is now proven at the reference-app layer as well: one tab can complete or clear frontend-mode state and another tab reconciles that persisted snapshot through browser storage events, with browser e2e asserting both hydrate and clear behavior
- structured observation now has a minimal SDK-owned product surface: `TraceEvent` remains the low-level contract, `createTraceTimelineStore()` in `@securitydept/client` provides the canonical in-memory observation feed, `FrontendOidcModeTraceEventType` names the frontend-mode browser-flow trace taxonomy, and `apps/webui` consumes that shared trace feed directly instead of inventing an app-local string timeline
- testing evidence now starts from the same structured surface: focused SDK tests assert popup and callback trace events directly, and browser e2e asserts frontend-mode popup / cross-tab behavior through `data-trace-type` markers derived from the structured trace timeline rather than only DOM prose
- token-set frontend host and token-set backend host now share one explicit structured-trace story in the reference app: both timelines are formal host-owned diagnosis surfaces rather than one formal owner plus one app-local convenience
- the project observation hierarchy is now explicit instead of implicit prose only:
  1. public result / protocol result
  2. redirect / response instruction
  3. structured trace / diagnosis surface
  4. focused fake / harness interaction
  5. human-readable text / log
- different auth families intentionally sit on different primary surfaces inside that shared hierarchy: token-set frontend/backend are primarily observed through structured trace, Basic Auth browser behavior is primarily observed through public/protocol result, and browser harness verified-environment claims are primarily observed through focused harness interaction

### Framework Router Adapters

Framework router adapters now live under the shared framework owner:

- `@securitydept/client-react/tanstack-router`
- `@securitydept/client-angular`

The canonical contract now is:

- matched-route-chain
- `inherit / merge / replace`
- a split between root-level runtime policy and child-route declarative metadata
- parity between Angular and TanStack Router

The token-set family no longer owns the shared router-adapter surface.

### token-set-context-client v1 Scope Baseline

The current `0.2.0` baseline remains:

- browser-owned token-set
- framework adapters plus reference-app and downstream-adopter calibration
- multi-client lifecycle / route orchestration / readiness / callback baselines

Still **outside** the baseline:

- mixed-custody
- BFF / server-side token ownership
- a heavier chooser-UI product layer
- synchronized productization of non-TS SDKs

### Adopter Checklist

#### Things that must not be treated as SDK surface

The following are not SDK public surface by default:

- app-local business helpers under `apps/webui/src/api/*`
- reference-page UI and diagnostics glue
- the adopter's own route tables, page state, or toast copy
- data-shaping helpers that exist only for one app

#### Checklist before integration

Before entering any surface, confirm:

1. which auth context you need, not which demo page you saw first
2. whether you are integrating in a browser host, framework host, or server host
3. whether you need a stable root contract or a provisional adapter
4. whether you accept the current `0.2.0` / `0.3.0` boundary

### Verified Environments / Host Assumptions

"Verified" in this document means there is focused evidence, reference-app proof, or downstream-adopter proof in the repo.  
It does **not** mean broad coverage across every mainstream host environment.

The main currently verified hosts are:

- Node / browser baseline
- React 19 host
- Angular host
- TanStack Router host
- raw Web Router baseline
- the real adopter lines through `apps/webui` and `outposts`

Runtime support boundaries should still be expressed in three layers rather than as a blunt “supports / does not support runtime X” table:

- ECMAScript / built-in requirements
- adapter capability requirements
- verified environments

This document does not aim to maintain a caniuse-style runtime matrix; if a host has not entered real evidence, it must not be written as “verified”.

### Minimal Entry Paths

#### 1. Foundation entry: runtime stays explicit

When you need shared primitives, enter through the `@securitydept/client` family.  
This is the capability entry, not a product-level auth shell.

#### 2. Browser entry: `./backend-oidc-mode/web` owns browser glue

When you integrate backend-owned OIDC / token-set flows in the browser, enter through:

- `@securitydept/token-set-context-client/backend-oidc-mode/web`

This subpath owns browser-specific concerns such as redirect paths, callback resume, storage, and bootstrap semantics.

#### 3. React entry: `session-context-client-react` starts with Provider, hook wiring

React adopters should prefer the independent React adapter packages instead of hand-rolling provider glue from core roots.  
That applies equally to:

- `@securitydept/basic-auth-context-client-react`
- `@securitydept/session-context-client-react`
- `@securitydept/token-set-context-client-react`

#### 4. SSR / server-host entry: dedicated `./server` helpers

Server-host adopters should prefer the dedicated `./server` helpers:

- `@securitydept/basic-auth-context-client/server`
- `@securitydept/session-context-client/server`

Do not import `/web` subpaths into server-hosted code.

### Provisional Adapter Maintenance Standard

`./web`, `./server`, and the framework adapter packages continue to be maintained against a stricter `provisional` bar than stable root surfaces.

The bar is:

- stable capability boundaries
- stable import-time behavior
- ordinary usage that does not depend on reference-app glue
- focused evidence plus real dogfooding
- verified-environment statements that match actual validation scope

#### Provisional Adapter Promotion Checklist

Only consider promotion from `provisional` to `stable` when all of the following hold:

| Condition | Requirement |
|---|---|
| capability boundary is stable | no more owner reshuffles across multiple iterations |
| minimal entry is clear | can be explained independently of a full reference page |
| ordinary usage is mature | does not depend on app-local glue |
| focused evidence is complete | lifecycle / regression / import-contract guardrails exist |
| verified environments are explicit enough | host validation is not overstated |

#### Current Promotion Readiness (snapshot, not roadmap)

| Adapter / Surface | Current judgment |
|---|---|
| `@securitydept/client/web` | stable, foundation-owned browser helper surface |
| `@securitydept/client/auth-coordination` | provisional, but the matched-route-chain / planner-host contract is already established |
| `@securitydept/client/web-router` | provisional, with the raw Web baseline in place |
| `basic-auth-context-client/web` | provisional, with thin browser convenience established |
| `session-context-client/web` | provisional, with login-redirect convenience established |
| `basic-auth-context-client/server` / `session-context-client/server` | provisional, with an SSR/server-host baseline established |
| `*-react` / `*-angular` adapter family | provisional, with real reference-app / downstream-adopter proof but not yet a broad host matrix |
| `@securitydept/token-set-context-client/frontend-oidc-mode` | provisional, with keyed pending-state ownership and single-consume callback semantics now formalised on top of the foundation persistence contract |
| `token-set-context-client-react/react-query` | provisional; SDK-owned read/write authority is established for the canonical token-set groups / entries consumer path |

## Raw Web Router Baseline

**Subpath**: `@securitydept/client/web-router`

It is the standard answer for non-framework hosts:

- Navigation API first, History API fallback
- one planner-host submission per full matched-route chain
- no reimplementation of auth logic inside the router

Its shared semantics with Angular and TanStack Router are:

- full-route aggregation
- `inherit / merge / replace`
- unauthenticated policy remains candidate-owned

## Shared Client Lifecycle Contract

**Subpath**: `@securitydept/token-set-context-client/registry`

It is the shared multi-client lifecycle core for the token-set family.  
It currently owns:

- `primary` / `lazy` initialization priority
- `preload`
- `whenReady`
- `idleWarmup`
- `reset`
- keyed lookup aligned with callback/readiness behavior

React and Angular adapters must consume this shared core instead of re-implementing registry semantics separately.

## React Query Integration

**Subpath**: `@securitydept/token-set-context-client-react/react-query`

Its current meaning must stay explicit:

- it is the token-set React consumer surface
- it is not the login / refresh / runtime authority
- query state derives from registry / auth-service state, not the other way around

What is already authoritative today:

- groups / entries read paths
- groups / entries write paths
- readiness queries
- keyed-only canonical hook ergonomics (`clientKey` is the adopter-facing selector; the hook resolves the client internally)
- authorization-header derivation
- `useTokenSetBackendOidcClient(clientKey)` as the SDK-owned lower-level backend-oidc accessor for React consumers
- the query-key namespace
- post-mutation invalidation for the canonical groups / entries flows
- token-set management entity / request / response contracts used by the React consumer hooks

What reference-app authority now proves:

- `apps/webui` dashboard consumes SDK-owned token-set query + mutation hooks directly
- `apps/webui` token-set reference page consumes the same SDK-owned mutation path for group and entry creation workflows
- `apps/webui` login / dashboard / token-set page no longer rely on app-local `getTokenSetClient()` or `service.client as ...` as the canonical React consumer path
- app-local canonical wrappers are no longer the owner boundary for token-set React Query write semantics

## Examples and Reference Implementations

### Primary Real Reference Apps

The current first-priority reference apps / hosts are:

- `apps/server`
- `apps/webui`

Their roles are:

- `apps/server`: the real auth / propagation / route-composition semantics host
- `apps/webui`: the React / browser / multi-context auth-shell / token-set reference-page / dashboard dogfooding authority

### Downstream Reference Case: Outposts

`~/workspace/outposts` is a high-value downstream adopter for validating:

- Angular hosting
- backend-driven config projection
- route-level orchestration
- real multi-requirement integration

But its historical app-local glue is not the SDK API template.  
SDK design still needs to be driven by `securitydept`'s own domain semantics and ergonomics.

### Current Bundle / Code Split Judgment

Bundle/code-splitting is now an engineering optimization topic rather than a public-contract blocker.  
Priority continues to stay below contract freeze, authority alignment, and adopter clarity.

### Demo and OIDC Provider

Interactive demos are fine, but:

- demos and providers are not authority
- provider choice must not dictate package boundaries
- demos explain contracts; they do not replace focused evidence

## Requirements for Future Developers and AI Agents

- do not rename or rebuild the client SDK as `auth-runtime`
- do not let framework adapters pollute the foundation
- do not introduce import-time side effects or default global polyfills
- do not productize reference-app glue as SDK API
- do not smuggle mixed-custody / BFF themes back into the `0.2.0` baseline
- when public surface, docs, examples, or inventory move, move them together

[English](007-CLIENT_SDK_GUIDE.md) | [中文](../zh/007-CLIENT_SDK_GUIDE.md)
