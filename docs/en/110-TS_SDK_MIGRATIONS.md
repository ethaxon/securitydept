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

### 2026-04-25 Iteration 151 beta-readiness docs / packaging prep — no TS public-surface change

**Discipline**: no new `changeDiscipline` entry required; existing inventory disciplines remain unchanged.

**Subpath**: none.

**Change**: iteration 151 prepares `0.2.0-beta.1` by auditing docs reality, release readiness matrices, Docker readiness, and the VitePress docs pipeline. It does not add, remove, rename, or widen any TS SDK public export.

**Migration**: none. Adopters do not need to change imports or runtime usage because of the iteration 151 release-prep work.

**Justification**: the explicit ledger entry prevents the beta-readiness docs/docsite work from being misread as a silent SDK surface migration. Public-surface changes remain governed by `public-surface-inventory.json` and this ledger.

### 2026-04-25 @securitydept/token-set-context-client-angular — bearer interceptor gains `strictUrlMatch` option (additive, non-breaking)

**Discipline**: `provisional-migration-required` (the package remains `provisional`; this change is an additive surface expansion and does not break any existing adopter)

**Subpath**: `@securitydept/token-set-context-client-angular`

**Change**:

- Added `export interface BearerInterceptorOptions { strictUrlMatch?: boolean }`
- Added `export const TOKEN_SET_BEARER_INTERCEPTOR_OPTIONS = new InjectionToken<BearerInterceptorOptions>(...)`
- `provideTokenSetBearerInterceptor()` now accepts an optional `options?: BearerInterceptorOptions`, expanded via the options-object form per [TypeScript SDK Coding Standards](007-CLIENT_SDK_GUIDE.md#typescript-sdk-coding-standards). Return type tightens from `Provider` to `Provider[]` (NgModule `providers` arrays accept `Provider | Provider[]`, so all existing call sites stay compatible).
- `createTokenSetBearerInterceptor(registry, options?)` accepts the same options object.
- Default `strictUrlMatch: false`: keeps the original single-client convenience fallback so URLs that match no `urlPatterns` still fall back to `registry.accessToken()`.
- `strictUrlMatch: true`: requests that match no `urlPatterns` receive **no** `Authorization` header.

**Migration**:

- Adopters with multiple backends, multiple audiences, or any third-party HTTP traffic from the same Angular host:
  - `provideTokenSetBearerInterceptor()` → `provideTokenSetBearerInterceptor({ strictUrlMatch: true })`
  - `createTokenSetBearerInterceptor(registry)` → `createTokenSetBearerInterceptor(registry, { strictUrlMatch: true })`
- Single-backend adopters can keep the no-argument form; behavior is unchanged.

**Justification**:

Iteration 150 review 1 surfaced a real `outposts` calibration finding: the default single-client convenience fallback would inject the token on URLs that did not match any registered `urlPatterns` whenever a host had multiple backends, multiple audiences, or any third-party HTTP traffic — a cross-origin token-leakage risk. Per the AGENTS.md TS SDK API rule, optional parameters on public functions are added through the options-object form; the default stays `false` to preserve compatibility with existing single-client adopters.

### 2026-04-24 @securitydept/client / session-context / token-set-context-client — shared authenticated-principal baseline is now the canonical cross-family contract

**Discipline**: `stable-deprecation-first` (`@securitydept/client`, `@securitydept/session-context-client`) + `provisional-migration-required` (`@securitydept/token-set-context-client/*`)

**Subpath**: `@securitydept/client`, `@securitydept/session-context-client`, `@securitydept/token-set-context-client/backend-oidc-mode`, `@securitydept/token-set-context-client/frontend-oidc-mode`, `@securitydept/token-set-context-client/orchestration`

**Change**:

The repository no longer treats session and token-set as separate semantic owners for authenticated human-principal data.

- `@securitydept/client` now owns the shared TS/browser `AuthenticatedPrincipal` baseline plus `normalizeAuthenticatedPrincipal()`, `normalizeAuthenticatedPrincipalWire()`, and `projectAuthenticatedPrincipal()`
- `session-context-client` user-info normalization now requires a stable `subject` and aligns its principal contract to that shared baseline
- token-set backend/frontend user-info and orchestration principal paths now consume the same shared semantic owner instead of maintaining a parallel token-set-only principal contract
- `apps/webui` dashboard user projection now uses a shared helper-backed projection path instead of app-local per-mode fallback rules
- this consolidation is about authenticated human-principal semantics only; resource-token facts, browser-owned token material, mixed-custody, and BFF/server-side token ownership remain separate concerns

**Migration**:

1. If your TS code still treats session principal as `displayName`-only data, migrate it to the shared `AuthenticatedPrincipal` shape and provide/assert a stable `subject`.
2. If your code parses snake_case wire user-info payloads directly, prefer `normalizeAuthenticatedPrincipalWire()` so `subject`, `display_name`, `issuer`, and `claims` normalization stays in one owner.
3. If your app builds a host-facing current-user label from raw principal fields, prefer `projectAuthenticatedPrincipal()` or a thin app helper built on it instead of repeating `displayName ?? subject ?? ...` fallback logic.
4. Do not treat resource-token principal/fact surfaces as aliases of this contract; they remain substrate/token-material concerns rather than authenticated human-principal projection.

**Justification**:

Before iteration 142, session and token-set each carried overlapping but non-identical principal semantics, which made cross-family host code and cross-language authority harder to keep coherent. This iteration moves the semantic owner to the shared foundation while keeping resource-token and later mixed-custody/BFF topics outside the current baseline.

### 2026-04-24 Operation tracer / trace sink / logger layering productization — operation lifecycle correlation now has a real TS owner

**Discipline**: `stable-deprecation-first` (foundation) + `experimental-fast-break` (test-utils)

**Subpath**: `@securitydept/client`, `@securitydept/test-utils`

**Change**:

The TS/browser structured-observation baseline now includes a real operation-correlation layer instead of interfaces only.

- `@securitydept/client` now owns `createOperationTracer()` and `OperationTraceEventType`
- `OperationScope` is now backed by a canonical implementation that emits `operation.started`, `operation.event`, `operation.error`, and `operation.ended` into `TraceEventSinkTrait`
- token-set frontend callback/refresh and backend callback family/refresh now correlate their existing trace events through one shared `operationId`
- `apps/webui` timelines now surface operation lifecycle entries and `operationId` directly instead of leaving correlation trapped inside SDK-only tests
- `@securitydept/test-utils` `InMemoryTraceCollector` now supports `ofOperation()`, `operationLifecycle()`, and `assertOperationLifecycle()` for operation-level assertions

**Migration**:

1. Prefer `createOperationTracer({ traceSink, logger, clock, scope, source })` instead of hand-rolled operation lifecycle wrappers.
2. Treat `LoggerTrait` as a human-readable auxiliary channel only; do not replace machine-readable observation with console text assertions.
3. If your auth-flow tests still hand-filter trace arrays for one operation, migrate them to `InMemoryTraceCollector.ofOperation()` and `assertOperationLifecycle()`.
4. Treat `operationId` as the stable correlation key between lifecycle entries and existing family-specific trace events; exporter/OTel/span-tree work is still outside the current baseline.

**Justification**:

Before iteration 141, `OperationTracerTrait` and `OperationScope` were public types without a canonical implementation or a real auth-flow consumer path. This iteration closes that owner gap while keeping scope below a full exporter/OTel stack.

### 2026-04-24 Unified input-source helper consolidation — richer foundation/web source helpers are now part of the current public baseline

**Discipline**: `stable-deprecation-first`

**Subpath**: `@securitydept/client`, `@securitydept/client/web`

**Change**:

The richer unified input-source helper story is now productized instead of remaining a documented direction only.

- `@securitydept/client` now formally owns `fromSignal()` and `fromPromise()` alongside `timer()`, `interval()`, `scheduleAt()`, and `fromEventPattern()`
- `@securitydept/client/web` now formally owns `fromAbortSignal()` and `fromStorageEvent()` alongside `fromVisibilityChange()`
- real consumers no longer need to hand-roll these bridges in auth-flow/browser code: React signal bridging, callback-resume promise settlement, browser cancellation interop, and cross-tab storage listeners now consume the shared owners

**Migration**:

1. Replace hand-written `signal.subscribe(...)` to external-store bridge code with `fromSignal()` when you need the shared subscription shape.
2. Replace ad hoc promise settlement bookkeeping (`promise.then(...).catch(...)` plus manual stale guards) with `fromPromise()` when you are adapting async completion into host state.
3. Replace direct browser `abort` / `storage` listener glue with `fromAbortSignal()` and `fromStorageEvent()` when the owner is the shared web layer rather than app-local code.
4. Continue to treat these helpers as thin source adapters only; operator-style composition remains outside the current baseline.

**Justification**:

Before iteration 140, the docs explicitly kept these richer helpers visible but not productized, which left a real owner gap between the design discussion and current browser/auth-flow adopters. This iteration closes that gap without expanding scope into a full stream/operator framework.

### 2026-04-23 Capability-first configuration layering consolidation — frontend-mode browser materialization and adapter vocabulary now have formal owners

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/token-set-context-client/frontend-oidc-mode`

**Change**:

Capability-first configuration layering is now written as the current adopter-facing baseline instead of remaining a design direction.

- `@securitydept/token-set-context-client/frontend-oidc-mode` now owns `createFrontendOidcModeBrowserClient()` for browser-side config projection fetch, validated parsing, runtime capability wiring, and client materialization
- the same subpath now owns `resolveFrontendOidcModePersistentStateKey()` and `resolveFrontendOidcModeBrowserStorageKey()` for the persistent-state key story
- the reference app no longer owns frontend-mode config fetch + parse + `createWebRuntime()` + `createFrontendOidcModeClient()` assembly in `apps/webui/src/lib/tokenSetFrontendModeClient.ts`
- adapter/provider entry docs are now aligned on the same three layers: runtime/foundation config, auth-context config, and adapter/host config

**Migration**:

1. Replace app-local frontend-mode browser materialization with `createFrontendOidcModeBrowserClient()` when your host obtains config from a projection endpoint.
2. Treat `configEndpoint` / `redirectUri` as bootstrap input, not as the auth-context config itself.
3. Treat transport/stores/scheduler/clock/trace as runtime capability inputs, not as fields inside one flattened auth config object.
4. Keep host-only concerns such as route constants, popup host routes, registry registration, and trace rendering outside the mode/root client config.

**Justification**:

Before iteration 139, the foundation direction was already clear, but the reference app still owned the highest-friction frontend-mode materialization path and the provider/config vocabulary still read inconsistently across auth families. This iteration closes that owner gap and writes the current layering story down as authority.

### 2026-04-23 Cancellation / resource-release baseline consolidation — shared AbortSignal interop and dispose semantics are now productized

**Discipline**: `stable-deprecation-first`

**Subpath**: `@securitydept/client`, `@securitydept/client/web`

**Change**:

The TS/browser foundation now has one explicit cancellation/resource-release story instead of core contracts plus app-local glue.

- `DisposableTrait`, `CancellationTokenTrait`, `CancellationTokenSourceTrait`, `createCancellationTokenSource()`, and `createLinkedCancellationToken()` are now written down as the current shared cancellation baseline
- `CancellationTokenSourceTrait.dispose()` is the current owner-side release primitive: releasing an owned resource also cancels its token
- `@securitydept/client/web` now owns both bridge directions:
   - `createAbortSignalBridge(token)` for fetch-facing consumers that need `AbortSignal`
   - `createCancellationTokenFromAbortSignal(signal)` for browser/framework consumers that receive `AbortSignal` first and need to call SDK APIs that accept `CancellationTokenTrait`
- the reference app no longer owns an app-local `AbortSignal -> CancellationTokenTrait` wrapper in `apps/webui/src/api/tokenSet.ts`

**Migration**:

1. Replace any app-local `AbortSignal -> CancellationTokenTrait` wrapper with `createCancellationTokenFromAbortSignal(signal)` from `@securitydept/client/web`.
2. Keep `createAbortSignalBridge(token)` as the canonical path when a browser adapter must hand an `AbortSignal` to fetch or another web-native API.
3. Treat `.dispose()` as the current explicit resource-release contract; do not assume `Symbol.dispose` support.
4. If you need low-level cancellation fan-in, use `createLinkedCancellationToken()`; linked source factories or ambient cancellation trees are still outside the current baseline.

**Justification**:

Before iteration 138, the core contract existed but the browser consumer path was still split: fetch transport used a shared forward bridge while the reference app kept a second reverse bridge story. This iteration closes that owner split and writes the current release/disposal boundary down explicitly.

### 2026-04-23 Cross-runtime observability consolidation — browser hierarchy and server auth diagnosis now have formal owners with no new TS export

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**Change**:

No new TypeScript public export was added in this iteration, so `public-surface-inventory.json` did not need an update.

However, the reference-app observability and server auth-path behavior changed materially again:

- token-set frontend host and token-set backend host now share one explicit structured-trace story instead of one formal owner plus one app-local convenience surface
- `apps/webui/src/lib/authObservationHierarchy.ts` now formalizes the project observation hierarchy across token-set hosts, Basic Auth browser boundary, and browser harness verified-environment claims
- `securitydept-session-context` now exposes machine-readable diagnosis on `session.login`, `session.logout`, and `session.user_info`
- `securitydept-basic-auth-context` now exposes machine-readable diagnosis on `basic_auth.login`, `basic_auth.logout`, and `basic_auth.authorize` while keeping protocol-specific response ownership intact
- `apps/server` routes and middleware now consume those diagnosed results directly instead of treating plain route logs as the only runtime evidence on those paths

**Migration**:

1. No TS import path changes are required.
2. If your host/runtime reasoning still treats token-set frontend trace as the only formal structured surface, update that language to include backend-mode host trace under the same hierarchy.
3. If your server integrations or tests still rely on plain route logs for session/basic-auth auth-path conclusions, migrate them to the diagnosed `operation` / `outcome` / field surface instead.
4. If your docs describe Basic Auth and browser harness observation only through prose, update them to the explicit hierarchy vocabulary: public result, redirect/response instruction, structured trace/diagnosis, focused harness interaction, and human-readable log.

**Justification**:

Iteration 135 closes the cross-runtime observability gap left by the earlier minimal trace/diagnosis baselines: frontend/backend token-set host traces, Basic Auth/browser harness observation positioning, and session/basic-auth server auth paths now all have formal, machine-readable owners.

### 2026-04-23 WebKit matrix consolidation — the canonical distrobox baseline now verifies the full current 10-scenario harness with no new TS export

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**Change**:

No new TypeScript public export was added in this iteration, so `public-surface-inventory.json` did not need an update.

However, the browser harness verified-environment matrix changed materially again for WebKit:

- the remaining six `frontend-oidc` scenarios now verify under the distrobox-hosted Ubuntu baseline
- both WebKit Basic Auth scenarios now also verify under that same baseline
- the canonical distrobox-hosted WebKit matrix is now 10 verified / 0 blocked / 0 unavailable across the current harness surface
- one narrower browser-specific divergence is now explicit inside that verified matrix: WebKit commits the explicit Basic Auth challenge as a `401` response with `WWW-Authenticate`, while Chromium and Firefox still surface browser-thrown auth failure channels before page render

**Migration**:

1. No TS import path changes are required.
2. If your docs or tests still describe WebKit as partially unavailable in the canonical distrobox baseline, update them to the full 10-scenario verified matrix.
3. Keep the WebKit Basic Auth divergence explicit: it is still verified, but its browser-owned challenge surface is not the same as Chromium or Firefox.

**Justification**:

Iteration 134 closes the remaining WebKit matrix under the already-productized canonical distrobox baseline and turns the last partial status narrative into one authoritative verified surface.

### 2026-04-23 WebKit verified matrix expansion — popup relay is now part of the canonical distrobox baseline with no new TS export

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**Change**:

No new TypeScript public export was added in this iteration, so `public-surface-inventory.json` did not need an update.

However, the browser harness verified-environment matrix changed again for WebKit:

- `frontend-oidc.popup.relay` is now a real verified WebKit scenario under the distrobox-hosted Ubuntu baseline
- `frontend-oidc.callback.redirect` remains verified there, so WebKit now has 2 verified scenarios in the current 10-scenario harness matrix
- the same distrobox-hosted WebKit matrix currently has 0 blocked scenarios and 8 unavailable scenarios, which remain formally unavailable rather than being described only as future work
- no new browser-specific failure divergence was introduced by this expansion; popup relay aligned with the existing Chromium/Firefox behavior shape in the browser-owned host

**Migration**:

1. No TS import path changes are required.
2. If your docs or tests still describe WebKit as having only one verified distrobox-hosted callback scenario, update that language to include popup relay as the second verified scenario.
3. Keep the remaining unverified WebKit scenarios formal: do not rewrite them as vague future plans when they still lack browser-level evidence.

**Justification**:

Iteration 133 expands the verified WebKit matrix under the already-productized canonical distrobox baseline without changing the baseline-policy contract itself.

### 2026-04-23 Browser execution baseline policy productization — dual baseline authority is now explicit with no new TS export

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**Change**:

No new TypeScript public export was added in this iteration, so `public-surface-inventory.json` did not need an update.

However, the browser harness owner now adds a formal execution-baseline policy layer:

- Chromium and Firefox explicitly keep `host-native` as `primary-authority`
- WebKit explicitly keeps `host-native` as `host-truth` while `distrobox-hosted` Ubuntu is its `canonical-recovery-path`
- the owner now rejects flattening all browsers into distrobox as the default policy because that would discard already-verified host-native browser-owned evidence
- the same frontend OIDC baseline test is now consumed as paired evidence on Firefox host-native and WebKit distrobox-hosted execution

**Migration**:

1. No TS import path changes are required.
2. If your tests or docs implied that `distrobox` should become the universal browser baseline, migrate that language to the explicit dual-policy vocabulary instead.
3. If your docs treated host-native and distrobox-hosted evidence as one flattened Linux fact, split them into authority roles: host-native can remain the primary authority or host truth, while distrobox-hosted can be the canonical recovery path.

**Justification**:

Iteration 132 turns execution-baseline policy itself into a productized owner contract instead of leaving it as prose around the browser harness.

### 2026-04-22 Third-browser bring-up — WebKit now uses a distrobox-hosted canonical execution baseline with no new TS export

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**Change**:

No new TypeScript public export was added in this iteration, so `public-surface-inventory.json` did not need an update.

However, the browser harness capability and verified-environment baseline changed in five important ways:

- WebKit is no longer flattened into one Linux conclusion: the harness now reports both executable baseline (`system-executable` vs `playwright-managed`) and execution baseline (`host-native` vs `distrobox-hosted`)
- WebKit host-native runs on Linux non-Debian/Ubuntu hosts can still be formally `blocked` with `host-dependencies-missing` when a runtime startup probe observes missing host dependencies during MiniBrowser launch
- the repo-provided `distrobox` `playwright-env` is now the canonical Ubuntu execution baseline for WebKit on those hosts
- the Playwright-managed WebKit runtime is `available` in that distrobox-hosted baseline, and `frontend-oidc.callback.redirect` now has a real verified callback run there
- managed-browser capability detection now comes from Playwright runtime executable discovery plus repo-level executable overrides rather than private cache scanning
- `playwright.config.ts` continues to derive projects from the same owner, and `PLAYWRIGHT_INCLUDE_BLOCKED_PROJECTS=1` remains available for explicit host-native blocked evidence runs

**Migration**:

1. No TS import path changes are required.
2. If your browser-facing tests or docs previously treated WebKit as a single host-blocked endpoint, migrate that language to the split baseline vocabulary: host-native blocked evidence is still real, but distrobox-hosted Ubuntu execution is the canonical bring-up path on Linux non-Debian/Ubuntu hosts.
3. If you need the canonical WebKit path locally, enter the repo-provided `distrobox` `playwright-env` and run Playwright there.
4. If you need to gather evidence for a host-native blocked browser project locally, set `PLAYWRIGHT_INCLUDE_BLOCKED_PROJECTS=1` before invoking `playwright test --project=<browser>`.
5. Browser-specific divergence remains authoritative at the browser-owned failure surface level: Chromium and Firefox still share the verified no-cached-credentials Basic Auth conclusion, while WebKit now has one verified distrobox-hosted callback scenario but not yet a complete matrix.

**Justification**:

Iteration 131 advanced the browser harness from a verified dual-browser baseline to a split third-browser baseline: host-native WebKit blocked evidence remains formal, but the canonical repo path now continues into distrobox-hosted Ubuntu execution where one real WebKit callback scenario is verified, all without introducing any new TS SDK public export.

### 2026-04-22 Second-browser verified baseline — Firefox enters the Playwright harness with no new TS export

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**Change**:

No new TypeScript public export was added in this iteration, so `public-surface-inventory.json` did not need an update.

However, the browser harness capability and verified-environment baseline changed in three important ways:

- Firefox is now detected through Playwright-managed executable discovery and reported as available with `detectionSource: "playwright-managed"`
- all 10 auth-flow scenarios (2 basic-auth + 8 frontend-oidc) are now verified on Firefox in addition to Chromium
- `playwright.config.ts` now generates multi-browser projects from the harness owner, running all e2e specs on both Chromium and Firefox

**Migration**:

1. No TS import path changes are required.
2. Basic Auth challenge error patterns differ between browsers: Chromium produces `ERR_INVALID_AUTH_CREDENTIALS`, Firefox produces `NS_ERROR_NET_EMPTY_RESPONSE`. Tests now use browser-aware patterns.
3. Popup relay timing differs between browsers: the popup `waitForURL` before close was removed because Firefox closes the popup faster than the callback URL observation completes. The test now waits only for the popup close event.

**Justification**:

Iteration 130 advanced the browser harness from single-browser to multi-browser verified baseline without introducing any new TS SDK public export.

### 2026-04-22 Browser harness capability reporting productized — verified-environment baseline is now a formal owner with no new TS export

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**Change**:

No new TypeScript public export was added in this iteration, so `public-surface-inventory.json` did not need an update.

However, the browser harness and verified-environment authority changed in four important ways:

- `apps/webui/e2e/support/browser-harness.ts` now formally owns the browser harness capability report: which Playwright browsers are available, which are unavailable and why, and which auth-flow scenarios are verified on which browser
- the verified-environment baseline explicitly distinguishes browser-native paths from harness-backed paths, and formally reports unavailable browsers instead of silently omitting them
- both the `basic-auth` and `frontend-oidc` e2e suites now consume this owner and assert the verified-environment baseline at test time
- `playwright.config.ts` derives its browser detection from the same owner instead of maintaining independent executable-detection logic

**Migration**:

1. No TS import path changes are required.
2. If your browser-facing docs or test assertions reference "this workspace only detects Chromium" as prose, prefer the formal harness capability report vocabulary instead.
3. If you add a new auth-flow browser evidence path, register it in the browser harness owner as a verified scenario with the appropriate path kind (browser-native or harness-backed).

**Justification**:

Iteration 129 turned scattered browser-environment prose facts into a formal owner with stable reporting surface, consumed by both auth-flow e2e suites, without introducing any new TS SDK public export.

### 2026-04-22 Documentation and consumer sync — Basic Auth authenticated logout evidence now includes a formal Chromium harness with no new TS export

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**Change**:

No new TypeScript public export was added in this iteration, so `public-surface-inventory.json` did not need an update.

However, the reference-app browser evidence changed in three important ways:

- `apps/webui` now exposes a verified-browser baseline section separate from browser-specific observed behavior and remaining unknowns
- the reference app now has a verified authenticated logout sequence for Chromium under a formal `Authorization`-header harness
- the current local Playwright environment still detects only Chromium, so no second-browser baseline is claimed in this iteration

**Migration**:

1. No TS import path changes are required.
2. If your host UI describes Basic Auth logout behavior, distinguish native browser-managed credential replay from harness-supplied credential replay.
3. Do not treat the new authenticated logout sequence as proof of universal browser cache eviction; it proves the Chromium harness path and documents the missing second-browser baseline explicitly.

**Justification**:

Iteration 128 changed the documented browser evidence boundary for Basic Auth logout behavior, but it did not introduce a new TS SDK export surface. The ledger should record that distinction explicitly.

### 2026-04-22 Documentation and consumer sync — Basic Auth browser evidence now distinguishes protocol guarantee from Chromium-observed behavior with no new TS export

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**Change**:

No new TypeScript public export was added in this iteration, so `public-surface-inventory.json` did not need an update.

However, the reference-app browser authority changed in two important ways:

- `apps/webui` Basic Auth playground now renders protocol guarantees separately from browser-observed state instead of describing both in one undifferentiated block
- the reference app now has browser-e2e evidence that Chromium with no cached credentials escalates explicit `/basic/login` navigation into a browser auth error, while `/basic/logout` remains a plain `401` without `WWW-Authenticate`

**Migration**:

1. No TS import path changes are required.
2. If your browser-facing docs or host UI describe Basic Auth challenge behavior, keep protocol guarantees separate from browser-specific observed outcomes.
3. Do not document Chromium's auth-error navigation behavior as a universal protocol guarantee; post-logout credential-cache eviction still remains explicit cross-browser debt.

**Justification**:

Iteration 127 changed the documented browser evidence and host authority for Basic Auth behavior, but it did not introduce a new TS SDK export surface. The ledger should record that distinction explicitly.

### 2026-04-22 Documentation and consumer sync — Basic Auth protocol exceptions are now an explicit baseline with no new TS export

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**Change**:

No new TypeScript public export was added in this iteration, so `public-surface-inventory.json` did not need an update.

However, the authority boundary for Basic Auth failures changed in two important ways:

- `securitydept-basic-auth-context` now owns an explicit protocol-specific response contract for Basic Auth challenge, plain unauthorized, and logout-poison responses
- `apps/webui` now uses a dedicated consumer helper to distinguish `WWW-Authenticate` challenge responses from plain unauthorized and logout-poison `401`s instead of treating every `401` as an ordinary shared-envelope failure

**Migration**:

1. No TS import path changes are required.
2. If your app-local browser code handles Basic Auth boundary responses, distinguish challenge-vs-poison-vs-plain-unauthorized semantics explicitly instead of assuming every `401` should parse through the shared server error envelope path.
3. Do not retrofit Basic Auth challenge or poison responses into `ServerErrorEnvelope`; they are now documented as a protocol-specific exception baseline.

**Justification**:

Iteration 126 changed the documented server/browser contract around Basic Auth protocol exceptions, but it did not introduce a new TS SDK export surface. The ledger should record that distinction explicitly.

### 2026-04-22 Documentation and consumer sync — reference-app auth paths now preserve browser/server error symmetry with no new TS export

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**Change**:

No new TypeScript public export was added in this iteration, so `public-surface-inventory.json` did not need an update.

However, the reference-app consumer boundary changed in two important ways:

- `apps/webui` frontend-mode config projection fetch now preserves structured server envelopes as `ClientError` instead of collapsing them into app-local `Error` strings
- `apps/webui` dashboard API calls now consume structured auth envelopes through `ClientError.fromHttpResponse()` instead of app-local status/message parsing

This iteration also narrowed the server-side plain-response debt by moving propagation auth-boundary middleware responses onto the shared `ServerErrorEnvelope`, while explicitly leaving Basic Auth challenge/poison protocol responses outside the baseline.

**Migration**:

1. No TS import path changes are required.
2. If your app-local code still parses auth HTTP failures via `statusText`, plain `message`, or custom `ApiError` wrappers, migrate it to `ClientError.fromHttpResponse()` plus `readErrorPresentationDescriptor()`.
3. Do not treat Basic Auth challenge / logout-poison responses as part of the current shared envelope baseline; they remain protocol-specific exceptions.

**Justification**:

Iteration 125 changed real reference-app behavior and cross-language authority, but it did not add a new TS export surface. The ledger should record that distinction explicitly.

### 2026-04-21 Documentation and consumer sync — Rust/server dual-layer error envelope adopted with no new TS export

**Discipline**: `provisional-migration-required`

**Subpath**: `behavior-only consumer alignment`

**Change**:

No new TypeScript public export was added in this iteration, so `public-surface-inventory.json` did not need an update.

However, the documented cross-language error boundary changed in two important ways:

- `securitydept-utils::error` now owns the shared Rust/server dual-layer HTTP error contract (`ServerErrorKind`, `ServerErrorDescriptor`, `ServerErrorEnvelope`)
- TS consumers such as `ClientError.fromHttpResponse()` now recognize the structured server error envelope directly instead of relying only on flatter `code` / `message` / `recovery` bodies

**Migration**:

1. No TS import path changes are required.
2. If you test server HTTP failures in TypeScript, prefer asserting the structured `error.kind` / `error.code` / `error.presentation` envelope shape rather than only plain `message` strings.

**Justification**:

Iteration 124 changed the shared server-facing error boundary and consumer behavior, but it did not introduce a new TS export surface. The ledger should record that distinction explicitly.

### 2026-04-21 Documentation authority sync — Rust/server auth-flow diagnosis baseline clarified with no TS public-surface change

**Discipline**: `provisional-migration-required`

**Subpath**: `documentation-only authority sync`

**Change**:

No TypeScript public surface changed in this iteration, so `public-surface-inventory.json` did not need an update.

The authority docs now explicitly record that:

- `securitydept-utils::observability` owns the shared Rust/server auth-flow diagnosis vocabulary
- the current productized server-side operations are `projection.config_fetch`, `oidc.callback`, `oidc.token_refresh`, `forward_auth.check`, and `propagation.forward`
- paths outside that baseline still remain plain `tracing` logs unless separately adopted

**Migration**:

1. No TS import path or runtime behavior changes are required.
2. When documenting or reviewing cross-language auth-flow observability, treat the Rust/server diagnosis vocabulary as a shared server contract rather than as ad-hoc route logging.

**Justification**:

Iteration 123 changed the authority boundary without introducing a new TS public API. Recording that distinction here avoids conflating “authority changed” with “TS SDK surface changed”.

### 2026-04-21 @securitydept/token-set-context-client/frontend-oidc-mode — popup redirect semantics now match real host-owned relay routes

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/token-set-context-client/frontend-oidc-mode`

**Change**:

`FrontendOidcModeClient.popupLogin()` now treats `popupCallbackUrl` as the actual OAuth `redirect_uri` used during authorization and code exchange, and it also accepts an optional `postAuthRedirectUri` for the opener window.

- popup callback handling no longer assumes every successful callback must use `config.redirectUri`
- host-owned popup relay routes can now complete the real authorization-code flow without app-local redirect spoofing
- the canonical reference app proves this behavior through `/auth/token-set/frontend-mode/popup-callback` plus browser e2e, and also proves cross-tab hydrate / clear authority at the host layer

**Migration**:

1. If your popup host route already passes a dedicated relay page as `popupCallbackUrl`, you no longer need any workaround that rewrites the callback back to `config.redirectUri` before code exchange.
2. If the opener window should resume on a specific page after popup success, pass `postAuthRedirectUri` explicitly instead of overloading `popupCallbackUrl` with two meanings.
3. If your tests stubbed `popupLogin()` through the old `authorizeUrl(postAuthRedirectUri, extraParams)` path, update them to reflect the popup-specific redirect behavior.

**Justification**:

Before iteration 120, the popup API surface existed but the browser was still authorized against the non-popup redirect URI, which meant a real app-owned popup relay route could not honestly own the popup callback. The fix had to land at the SDK owner boundary so reference-app popup productization and browser-e2e authority could be real rather than simulated.

### 2026-04-20 @securitydept/token-set-context-client-react — structured callback failure details for browser-owned host routes

**Discipline**: `provisional-migration-required`

**Subpath**: `@securitydept/token-set-context-client-react`

**Change**:

Browser-owned callback hosts no longer need to parse opaque callback error messages.

- `CallbackResumeState` now exposes `errorDetails` alongside the existing `error`
- `@securitydept/token-set-context-client-react` now exports `CallbackResumeErrorDetails` and `readCallbackResumeErrorDetails(error)`
- the canonical reference host route now renders stable callback-failure product states (`callback.unknown_state`, `callback.pending_stale`, `callback.pending_client_mismatch`, `callback.duplicate_state`) from structured `code` / `recovery` details rather than raw message text

**Migration**:

1. If your host route already consumes `useTokenSetCallbackResume()`, prefer `state.errorDetails` when rendering callback failures.
2. If your host route only receives an `unknown` error, use `readCallbackResumeErrorDetails(error)` instead of parsing `error.message` for callback semantics.
3. Update callback failure assertions to target stable `code` / `recovery` output rather than English message fragments.

**Justification**:

Iteration 118 formalised single-consume callback semantics in the SDK core, but host routes still had to infer product behavior from opaque error text. Iteration 119 closes that gap by making the typed callback-failure surface available at the React adapter boundary and proving it through the reference app's browser-owned callback route.

### 2026-04-20 @securitydept/client/persistence and @securitydept/token-set-context-client/frontend-oidc-mode — atomic single-consume callback state formalised on the foundation persistence contract

**Discipline**: `stable-deprecation-first` and `provisional-migration-required`

**Subpath**: `@securitydept/client/persistence` and `@securitydept/token-set-context-client/frontend-oidc-mode`

**Change**:

The browser-owned callback correctness contract now depends on a formal foundation-level single-consume capability instead of an app-level `load() + remove()` approximation.

- `RecordStore` now exposes the `take(key)` capability for atomic read-and-remove within the store's consistency domain
- repo-provided in-memory, `localStorage`, and `sessionStorage` stores implement that capability directly
- `createEphemeralFlowStore()` and `createKeyedEphemeralFlowStore()` now require `RecordStore.take()` when one-time flow state is consumed
- `frontend-oidc-mode` keyed pending callback state now treats duplicate replay, missing state, stale state, and client mismatch as formal callback semantics built on that consume contract

**Migration**:

1. If you provide a custom `RecordStore` and use it with `createEphemeralFlowStore()` or `createKeyedEphemeralFlowStore()`, add a `take(key)` implementation that reads and removes in one store-level step.
2. Do not emulate single-consume in host code by calling `get()` then `remove()` around callback or redirect state.
3. If you were reading frontend OIDC pending state from one fixed key, move to the keyed pending-state model (`pending:${state}`) and treat duplicate callback replay as `callback.duplicate_state` rather than a silent no-op.

**Justification**:

Iteration 118 hardened the browser-owned frontend OIDC flow around keyed pending state and duplicate callback detection, but that higher-level contract was still sitting on a weaker `load() + remove()` approximation. Moving the consume primitive into the shared persistence contract closes the semantic gap at the correct owner boundary.

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

### 2026-04-23 Session shared convenience moved from adapter-local glue to core owner

**Discipline**: `stable-deprecation-first` (core) + `provisional-migration-required` (adapters)

**Packages**:

- `@securitydept/session-context-client`
- `@securitydept/session-context-client-react`
- `@securitydept/session-context-client-angular`

**Change**:

Framework-neutral session browser-shell convenience no longer lives first in the React adapter.

- `SessionContextClient` now owns `rememberPostAuthRedirect()`, `clearPostAuthRedirect()`, `resolveLoginUrl()`, and `logoutAndClearPendingLoginRedirect()`
- `@securitydept/session-context-client-react` now wraps those core methods instead of implementing their composition locally
- `@securitydept/session-context-client-angular` now exposes the same convenience story via its DI/signal service facade

**Migration**:

1. Prefer the new core convenience methods when authoring framework-neutral session browser-shell flows.
2. Treat React / Angular adapters as thin host wrappers over those core methods.
3. Keep only DI, signal state, provider registration, and host state wiring in adapters.

**Justification**:

These methods are not React-specific behavior; they are canonical session browser-shell convenience and therefore belong to core so adapter parity remains honest.

---

### 2026-04-22 Session/basic-auth thin-surface parity consolidation in the reference app

**Discipline**: `provisional-migration-required`

**Packages**:

- `@securitydept/session-context-client-react`
- `@securitydept/basic-auth-context-client`
- `@securitydept/basic-auth-context-client-react`

**Change**:

The reference app (`apps/webui`) no longer treats local browser glue as the primary owner for session/basic-auth flows.

- the app-local `src/api/auth.ts` session helper module was removed
- the app-local `src/lib/basicAuth.ts` browser-boundary helper module was removed
- `SessionContextProvider` / `useSessionContext()` now own session login URL resolution, pending redirect state, user-info fetching, and logout flows across `/login`, `/playground/session`, and the dashboard shell
- `BasicAuthContextClient` plus `BasicAuthContextProvider` / `useBasicAuthContext()` now own Basic Auth login entry wiring and browser boundary consumption across `/login` and `/playground/basic-auth`

**Migration**:

1. Replace app-local session glue with `SessionContextProvider` + `useSessionContext()`.
2. Replace app-local Basic Auth login/boundary helpers with `BasicAuthContextClient` and `BasicAuthContextProvider`.
3. Keep these families thin: do not rebuild token-set callback orchestration, token persistence, or bearer transport ownership on top of them.

**Justification**:

These families are still thinner than token-set by design, but they now carry real adopter-facing owner surfaces instead of depending on undocumented reference-app glue.

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
| `@securitydept/token-set-context-client-react` | `.` (additive) | `TokenSetAuthService`, `TokenSetAuthProvider`, `useTokenSetAuthRegistry`, `useTokenSetAuthService`, `useTokenSetAuthState`, `useTokenSetAccessToken`, `useTokenSetCallbackResume`, `CallbackResumeState`, `CallbackResumeStatus`, `CallbackResumeErrorDetails`, `readCallbackResumeErrorDetails`, `TokenSetCallbackComponent` with a retained `TokenSetCallbackOutlet` compatibility alias. Angular-parity multi-client story on React. The callback hook awaits `registry.whenReady(clientKey)` before `handleCallback()`, and now exposes structured callback-failure details so browser-owned host routes can render stable failure states without parsing raw error text. |

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

**Subsequent additive updates (iteration 121)**

- `@securitydept/client` root now also owns the minimal structured trace consumption primitive: `createTraceTimelineStore()` plus the `TraceTimelineStore` / `TraceTimelineEntry` contracts. This is additive and ships on the existing stable root surface.
- `@securitydept/token-set-context-client/frontend-oidc-mode` now exports `FrontendOidcModeTraceEventType`, making popup / callback / refresh / user-info browser-flow trace taxonomy explicit and reusable instead of requiring adopters to hard-code raw event strings.
- `apps/webui` frontend-mode host now consumes that shared trace feed directly and browser e2e asserts popup relay plus cross-tab hydrate / clear through structured trace markers, not only through incidental status text.

**Subsequent additive updates (iteration 122)**

- `@securitydept/client` root now also owns the shared host-facing error presentation contract: `ErrorPresentationDescriptor`, `ErrorPresentationTone`, and `readErrorPresentationDescriptor()` bridge machine-facing runtime errors into stable host-facing recovery/presentation descriptors without making adopters parse `error.message`.
- `@securitydept/token-set-context-client/frontend-oidc-mode` now exports `describeFrontendOidcModeCallbackError()`, which keeps callback-specific host wording and restart guidance under the family owner while still building on the shared descriptor contract.
- `@securitydept/token-set-context-client-react` now includes `presentation` on `CallbackResumeErrorDetails`, so browser-owned callback hosts can render the same shared descriptor surface directly.
- `apps/webui` now consumes that shared presentation contract across the frontend callback route, frontend popup failure handling, and backend-mode refresh / clear failures, with browser e2e asserting stable `data-error-*` markers instead of relying only on prose.

**Reference-app authority update (non-breaking)**

- iteration 117 split the former generic token-set host path in `apps/webui` / `apps/server` into two explicit reference modes:
   - backend mode: `/auth/token-set/backend-mode/*` plus `/playground/token-set/backend-mode`
   - frontend mode: `/api/auth/token-set/frontend-mode/config`, `/playground/token-set/frontend-mode`, and `/auth/token-set/frontend-mode/callback`
- `TokenSetCallbackComponent` now has real host-level authority only through the frontend-mode callback route
- dashboard bearer integration and TanStack route security now operate across both token-set modes without adding any new public React secure-guard surface

---

[English](../en/110-TS_SDK_MIGRATIONS.md) | [中文](../zh/110-TS_SDK_MIGRATIONS.md)
