# Roadmap

This roadmap only exists to describe:

- current priorities
- the `0.2.0` backlog
- topics deferred to `0.3.0`
- which directions should keep receiving attention and which should not take over the main track yet

It does **not** try to:

- explain the conceptual layering of auth context / mode: see [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)
- list the current TS public package / subpath capability snapshot: see [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)
- serve as migration history: see [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)

This roadmap is aligned with the current project goal: turn SecurityDept into a mesh-oriented authentication and authorization toolkit, with `apps/server` acting as the proving ground.

## Phase 1: Low-Level Verification and Provider Layers

1. Finish and harden low-level creds verification
   - Basic Auth
   - static token
   - RFC 9068
   - JWT / JWE helpers
2. Finish and harden shared provider runtime
   - discovery refresh
   - JWKS refresh
   - introspection reuse
   - strict metadata parsing behavior

Status:

- mostly implemented

## Phase 2: Token Acquisition and Verification Layers

3. Harden `securitydept-oidc-client`
   - callback flow
   - refresh
   - claims normalization
   - reusable interfaces for downstream auth-context modes
4. Harden `securitydept-oauth-resource-server`
   - JWT / JWE / opaque verification
   - policy configuration
   - shared provider reuse
   - explicit principal extraction

Status:

- largely implemented

## Phase 3: Auth Context Modes

5. Implement basic-auth zone mode
   - backend routing helpers
   - documented flow
   - thin client helper for zone-aware `401 -> login` redirects and logout URL handling
6. Implement cookie-session mode
   - reusable backend auth-context extraction
   - normalized principal shape
   - optional redirect helper SDK
7. Implement stateless token-set mode
   - token snapshot / delta plus metadata snapshot / delta
   - frontend token lifecycle rules
   - multi-provider token management
   - bearer propagation policy for same-resource forwarding
   - optional future token-exchange hook

Status:

- basic-auth zone: documented, not fully productized
- cookie-session: a reference implementation exists; the reusable core already lives in `securitydept-session-context`; route-facing services (`SessionAuthServiceTrait` / `OidcSessionAuthService` / `DevSessionAuthService`) now live directly in that crate through the `service` feature
- stateless token-set mode: the core server and shared crate are in place; `securitydept-auth-runtime` has been dissolved; mode-specific and substrate-specific services are now in `securitydept-token-set-context`; `frontend-oidc` now has formal `Config / ResolvedConfig / ConfigSource / Runtime / Service / ConfigProjection`; OIDC protocol-level principal extraction shared across presets is in `securitydept-oidc-client::auth_state`; `backend-oidc` is now a single capability framework whose bundles are expressed as presets / profiles; mixed-custody / BFF / server-side token-set remain later-scope topics

## Phase 4: Frontend SDKs

8. Provide lightweight TypeScript SDKs
   - basic-auth zone helper for zone-boundary detection, `401 -> login` redirect, and logout redirect
   - cookie-session redirect helper
   - stateless token-set SDK for token storage, header injection, background refresh, and login redirect

Status:

- the TypeScript SDK is no longer only an architecture draft; the foundation packages, auth-context roots, `./web` adapters, React adapters, and reference-app dogfooding baselines are now implemented
- the repository already has external-consumer scenarios, a token-set web-focused lifecycle baseline, and a minimal React-adapter-focused test
- the current phase is no longer “start implementing the SDK”; it is contract freeze for `stable / provisional / experimental`, token-set v1 scope clarification, and clearer adopter-facing status
- mixed-custody, stateful BFF, server-side token-set, and heavier OTel / DI topics remain later-stage themes rather than the current frontend SDK track

Reference:

- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

## Current Priority Queue

The phase map above is still useful, but it no longer captures the real bottleneck of the project. The main risk is no longer “one more missing feature”; it is drift between public SDK contracts, adopter expectations, and reference-app validation.

The current priority queue should therefore be read as follows.

### Priority 0: Turn the TypeScript SDK freeze into an executable release gate

Why this is first:

- the repository already has real TS SDK code, adapters, and adopter-facing docs
- the biggest remaining risk is not raw implementation volume, but surface drift
- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) already defines `stable / provisional / experimental`, but roadmap-level execution criteria used to be too implicit

What used to be missing, but is now largely in place:

- an authoritative public-surface inventory across root exports and subpaths
- promotion / freeze gates backed by public-surface tests, example coverage, and docs alignment
- a lightweight 0.x breaking-change / migration discipline for TS SDK contracts

### Priority 1: Validate the SDK against real downstream adopters, not only in-repo demos

Why this is second:

- `apps/webui` is valuable dogfooding, but it is still an in-repo reference app
- the project already recognizes `outposts` as a high-value downstream adopter, yet the roadmap historically did not emphasize that strongly enough
- many next-step decisions depend on real adopter evidence: multi-integration layout, route-level auth orchestration, browser/runtime assumptions, and ownership boundaries

What this should validate:

- single-host / multi-backend token families
- route-level requirement orchestration and failure-policy boundaries
- a clearer split between SDK primitives and adopter app glue
- Angular / React framework adapters driven by `securitydept` domain semantics and ergonomics, not copied from an adopter’s current auth-module shape

### Priority 2: Close the browser-owned token-set v1 baseline before expanding scope

Why this remains high priority:

- the docs already state that the current token-set direction is a browser-owned v1 baseline
- after the re-audit, only mixed-custody / BFF / server-side token ownership remain explicitly deferred to `0.3.0`
- popup login, cross-tab lifecycle hardening, and the matched-route multi-requirement orchestration baseline are now implemented; the more real remaining work is framework-level adapters, real provider integration, and downstream adopter calibration
- without a roadmap-level reminder, the true `0.3.0` deferrals and the still-required `0.2.0` backlog items are too easy to misread in everyday implementation discussions

What still needs to stay explicit:

- what evidence is required before the current token-set baseline can be treated as a v1-ready external contract
- which remaining hardening topics are still inside the browser-owned baseline
- which adjacent topics belong to `0.2.0` backlog versus explicit `0.3.0` deferral
- how real framework adapters and downstream integration proof enter the authority layer instead of living only in guides or adopter code

### Priority 3: Restore auth-context product parity across the three surfaces

Why this is now a planning gap:

- token-set SDK work has advanced much faster than the other auth-context client surfaces
- the roadmap still mentions basic-auth and cookie-session helpers, but not explicitly as a current imbalance
- if left alone, the project risks having one well-shaped TS product surface and two others that are merely “documented but not equally productized”

Current parity gaps to watch:

- `basic-auth-context-client` remains intentionally thin, but still needs a clearer productized baseline
- `session-context-client` is stable at the root-contract level, but its adopter-facing helper story is still much lighter than token-set

### Priority 4: Write public-surface governance and release discipline into project docs

Why this is separate from Priority 0:

- Priority 0 is about the SDK freeze as an execution gate
- this priority is about keeping the whole project readable to future decision-makers and implementers

What the docs still need to make explicit:

- a compact roadmap-level statement of current strategic priorities
- a clearer distinction between “implemented”, “externally explainable”, and “promotable to stable”
- a project-level expectation that roadmap, SDK guide, examples, and exported surfaces move together

### Priority 5: Keep non-TS expansion explicitly deferred until the TS surface settles

Why this needs to be said directly:

- Kotlin and Swift are still listed as future SDK directions
- that is fine as a long-term architectural stance
- but the project should not spend roadmap attention on cross-language expansion before the TypeScript surface is frozen enough to serve as the reference contract

Current rule of thumb:

- TypeScript remains the only active SDK productization track
- Kotlin / Swift remain future follow-on work after the TS external contract is materially clearer

### Priority 6: Keep the still-unproductized foundation topics from the original discussion visible

Why this needs to be explicit:

- the original SDK discussion covered more than package boundaries; it also covered richer event/source models, configuration layering, observability, testing observation surfaces, and mixed-custody themes
- the formal docs have now turned some of that into authority, but other parts still remain in the state of “direction agreed, product surface not yet built”
- without roadmap visibility, those gaps are too easy to misread as either “already done” or “already rejected”

The topics that should stay visible today are:

- the richer event/operator/source surface is still intentionally thinner than the discussion draft envisioned; the current public baseline remains deliberately minimal
- capability-first configuration layering is still the direction, but it is not yet a unified adopter-facing configuration story
- logger / trace sink / operation tracer / testing observation hierarchy are no longer only design discipline: iteration 121 productized the minimal shared trace path (`TraceEvent`, `createTraceTimelineStore()`, `FrontendOidcModeTraceEventType`, reference-app trace timeline consumption, and direct trace assertions). Iteration 135 then completed the first cross-runtime consolidation pass: token-set frontend and backend now share one explicit structured-trace host story, Basic Auth and browser harness now sit on a formal observation hierarchy, and fuller operation-tracer layering / exporter stories remain future work
- the dual-layer error model is now partially productized rather than merely discussed: `@securitydept/client` owns the shared machine-facing/runtime plus host-facing presentation descriptor bridge, `frontend-oidc-mode` owns callback-specific presentation mapping on top of it, and `apps/webui` proves that shared contract across frontend callback/popup and backend browser actions. Broader cross-family presentation taxonomy hardening remains future work, but app-local message parsing is no longer the right baseline
- Rust / server-side dual-layer HTTP error handling is also no longer just a discussion topic: iteration 124 productized a shared `ServerErrorKind` / `ServerErrorDescriptor` / `ServerErrorEnvelope` baseline in `securitydept-utils::error`, mapped `apps/server` `ServerError` through it, and proved direct client/test consumption of the machine-facing plus host-facing envelope. Iteration 125 then extended that baseline to propagation auth-boundary middleware responses and reference-app browser consumers (`apps/webui` frontend-mode config fetch plus dashboard API client). Iteration 126 further carved out the remaining Basic Auth challenge/poison paths into an explicit protocol-specific exception baseline owned by `securitydept-basic-auth-context`, with direct server and browser evidence that those responses must preserve header/poison semantics rather than being forced back into the shared envelope baseline. Iteration 127 then hardened the browser-evidence side of that exception baseline: the reference app now keeps protocol guarantees separate from Chromium-observed challenge behavior, proves the no-cached-credentials path through browser e2e, and explicitly leaves post-logout credential-cache eviction as cross-browser debt instead of overclaiming it as protocol truth. Iteration 128 advanced that evidence baseline again by adding an authenticated logout browser sequence under a formal Chromium authorization-header harness, making the verified browser matrix explicit in the reference app, and recording that the local Playwright environment still exposes only Chromium rather than a verified second-browser path. Iteration 129 then productized the browser harness capability reporting itself: `apps/webui/e2e/support/browser-harness.ts` now formally owns which Playwright browsers are available, which are unavailable, which execution baseline they belong to, and which auth-flow scenarios are verified on which browser with explicit browser-native vs harness-backed distinction. Both the `basic-auth` and `frontend-oidc` e2e suites consume this owner, and `playwright.config.ts` derives its browser detection from the same owner. Iteration 130 then brought Firefox into the Playwright harness as a second verified browser: all 10 auth-flow scenarios (2 basic-auth + 8 frontend-oidc) passed on Firefox via Playwright-managed executable detection, establishing the first multi-browser verified baseline. Iteration 131 then corrected the third-browser path so Linux non-Debian/Ubuntu hosts no longer stop at “host blocked” as the canonical endpoint: host-native WebKit can still be formally `blocked` when a runtime startup probe observes missing host dependencies, but the repo-provided `distrobox` `playwright-env` now acts as the canonical Ubuntu execution baseline, where the Playwright-managed WebKit runtime is `available` and `frontend-oidc.callback.redirect` has a real verified callback run. The harness owner also stopped treating Playwright private cache layout as stable contract by moving managed-browser resolution to Playwright runtime executable discovery plus repo-level override inputs. Iteration 132 then productized execution-baseline policy itself: Chromium and Firefox formally keep host-native as `primary-authority`, WebKit keeps host-native as `host-truth` while `distrobox` Ubuntu is its `canonical-recovery-path`, and the project explicitly rejects flattening all browsers into distrobox because that would erase already-verified host-native browser-owned evidence. The same frontend OIDC baseline test now serves as paired evidence on Firefox host-native and WebKit distrobox-hosted execution, proving that the two baselines answer different questions rather than one replacing the other. Iteration 133 then expanded the verified WebKit matrix under that same canonical distrobox baseline: `frontend-oidc.popup.relay` now joins `frontend-oidc.callback.redirect` as real WebKit evidence, so the distrobox-hosted WebKit matrix now has 2 verified scenarios, 0 blocked scenarios, and 8 unavailable scenarios across the current 10-scenario harness without introducing a new browser-specific failure divergence. Iteration 134 then closed the remaining WebKit matrix under that same canonical distrobox baseline: the remaining six `frontend-oidc` scenarios and both Basic Auth scenarios now all verify in Playwright, giving distrobox-hosted WebKit a complete 10 verified / 0 blocked / 0 unavailable matrix, while also making one narrower browser-specific divergence explicit: WebKit commits the explicit Basic Auth challenge as a `401` response with `WWW-Authenticate` instead of surfacing the same browser-thrown auth error channels seen in Chromium and Firefox
- Rust / server-side structured observability is no longer only a future topic: iteration 123 established the minimal shared auth-flow diagnosis baseline in `securitydept-utils::observability`, adopted it on projection/config fetch, callback/token refresh, forward-auth, and propagation, and proved at least one direct machine-readable test-consumption path. Iteration 135 extended that same owner to session-context login/logout/user-info and basic-auth login/logout/authorize, with `apps/server` routes and middleware now consuming those diagnosed results directly. Broader route coverage and exporter/timeline work remain future topics
- mixed-custody / BFF remains an explicit later topic and must not be mistaken as “implicitly solved” just because the browser-owned baseline is now stronger

## 0.2.0 Release Backlog (Derived From the Client SDK Re-audit)

Unless a topic is explicitly deferred to `0.3.0` below, unfinished items still described in [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) should now be treated as **`0.2.0` release backlog**, not as vague future ideas.

The intent for `0.2.0` is not “perfectly complete”, but:

- basic implementation exists
- adopter-facing shape is explainable
- at least one meaningful validation path exists (tests, examples, or reference-app proof)

Current `0.2.0` backlog priorities:

1. **TS SDK freeze and release-gate discipline**
   - ~~authoritative public-surface inventory~~ (implemented: `public-surface-inventory.json` covers all packages, subpaths, stability, evidence, and docs anchors)
   - ~~promotion / freeze gates tied to docs, examples, and public-surface tests~~ (implemented: `release-gate.test.ts` validates export alignment, evidence existence, docs anchors, stability, and completeness)
   - ~~lightweight 0.x breaking-change / migration discipline~~ (implemented: the `changeDiscipline` field in inventory, `110-TS_SDK_MIGRATIONS.md` as the migration ledger, and gate validation of discipline/stability alignment plus ledger existence)

2. **Validation abstraction and input/runtime completeness**
   - ~~real SDK-level `@standard-schema` adoption rather than a guide-only preference~~ (implemented: `createSchema` / `validateWithSchema` in `@securitydept/client`; real adoption in `session-context-client.fetchUserInfo()`, `frontend-oidc-mode.parseConfigProjection()`, `BasicAuthContextClient` config validation, and `parseBackendOidcModeCallbackBody` / `parseBackendOidcModeRefreshBody`)
   - ~~a minimal unified input-source / scheduling baseline above the raw scheduler abstraction~~ (implemented: `timer`, `interval`, `scheduleAt`, `fromEventPattern` in `@securitydept/client`; `fromVisibilityChange` in `@securitydept/client/web`; real adoption in `FrontendOidcModeClient`)
   - ~~formal atomic single-consume persistence for browser redirect / callback flows~~ (implemented in iteration 118 and productized in iteration 119: `@securitydept/client/persistence` now defines the `RecordStore.take()` capability; repo-provided memory / browser stores implement it; `createEphemeralFlowStore()` and `createKeyedEphemeralFlowStore()` depend on it; `frontend-oidc-mode` callback handling now treats keyed pending state, duplicate replay, stale state, and client-mismatch as contract-level correctness, while the React callback host + browser e2e prove those failures as stable browser-visible outcomes)

3. **Login-trigger convenience completion**
   - ~~`session-context-client`: move beyond URL-only helpers and add minimal redirect-trigger convenience~~ (implemented: `loginWithRedirect()` in `session-context-client/web`)
   - ~~token-set browser entry: add a minimal redirect-trigger convenience~~ (implemented: `loginWithBackendOidcRedirect()` in `backend-oidc-mode/web`, plus `FrontendOidcModeClient.loginWithRedirect()`)
   - ~~popup login baseline for `backend-oidc-mode` / `frontend-oidc-mode`~~ (implemented in the SDK baseline and productized in iteration 120: shared infra in `@securitydept/client/web`, `loginWithBackendOidcPopup`, `FrontendOidcModeClient.popupLogin()`, and a real frontend-mode popup relay host route in `apps/webui` with browser-e2e proof for success and user-closed failure)

4. **Real multi-requirement orchestration baseline**
   - ~~move multi-OIDC / multi-requirement route orchestration beyond boundary discussion~~ (implemented: `createRequirementPlanner()` in `@securitydept/client/auth-coordination`)
   - ~~deliver at least one headless primitive / pending-requirement model before `0.2.0` GA~~ (implemented: sequential planner with `AuthRequirement`, `PlanStatus`, `ResolutionStatus`, `PlanSnapshot`; `kind` remains an opaque `string`, with no exported `RequirementKind` constant)
   - ~~add the matched-route-chain route-orchestration baseline and complete the cross-tab / visibility readiness sweep~~ (implemented in the SDK baseline and advanced in iteration 120 to reference-app authority: `createRouteRequirementOrchestrator()` in `@securitydept/client/auth-coordination`, `createCrossTabSync()`, `createVisibilityReconciler()`, focused baselines, and `apps/webui` browser-e2e proof that frontend-mode state hydrates and clears across tabs)
   - ~~framework-specific adapters for `@tanstack/react-router` and Angular Router~~ (implemented: `@securitydept/client-react/tanstack-router` and `@securitydept/client-angular`; TanStack Router now has a full route-security contract aligned with Angular, and the parity audit is documented in [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md#framework-router-adapters))
   - ~~Angular integration family split into dedicated npm packages~~ (implemented: `@securitydept/basic-auth-context-client-angular`, `@securitydept/session-context-client-angular`, and `@securitydept/token-set-context-client-angular`, built with `ng-packagr` and real `@Injectable()` support)
   - ~~React adapters split into dedicated packages~~ (implemented: React framework adapters and TanStack Router adapters are now dedicated npm packages; see migration ledger)
   - ~~planner-host coordination baseline~~ (implemented: `createPlannerHost()` with pluggable `CandidateSelector`, `RequirementsClientSetComposition` (`inherit` / `merge` / `replace`), and `resolveEffectiveClientSet()` in `@securitydept/client/auth-coordination`; Angular DI integration in `@securitydept/client-angular`; React Context integration in `@securitydept/client-react`)
   - ~~createTokenSetAuthGuard redesigned around planner-host architecture~~ (implemented: new `clientOptions` + `plannerHost` API replaced the old `query` / `clientKey` / `fromRoute` discriminated union; the old API is fully removed)
   - ~~Angular Router auth canonical path: route metadata + full-route aggregation~~ (implemented: `secureRouteRoot()` / `secureRoute()` are now the adopter-facing Angular Router path; route metadata supports `merge` / `replace`; root-level runtime policy stays non-serializable; `createTokenSetRouteAggregationGuard()` evaluates the full route chain through `canActivate` + `canActivateChild`; `createTokenSetAuthGuard()` removed; signal bridge utilities moved to `@securitydept/client-angular`)
   - ~~Angular build topology switched to pnpm recursive build~~ (implemented: Angular workspace dependencies mirror `workspace:*` peer deps via `devDependencies`, and root build uses `pnpm -r` for topological ordering)
   - remaining gaps:
     - ~~real `outposts` migration from `angular-auth-oidc-client` to SDK Angular adapter packages~~ (in progress: `outposts-web` now uses the SDK’s `provideTokenSetAuth()` with async `clientFactory` and `resolveConfigProjection([networkConfigSource(...)])`; compile-time OIDC credentials are gone; `confluence` backend serves `/api/auth/config`)
     - remaining projection-source gaps (future iterations):
       - ~~`persisted` source restore + revalidation~~ (implemented: `persistedConfigSource()`, `RecordStore`, `persistConfigProjection()`, and freshness-aware `scheduleIdleRevalidation()`)
       - ~~`bootstrap_script` source for server-injected config~~ (implemented: `bootstrapScriptSource()` reading `window.__OUTPOSTS_CONFIG__`; production host uses bun-injector + nginx + docker-compose shared volume)
       - ~~multi-client lazy initialization~~ (implemented in iteration 110: `ClientInitializationPriority = "primary" | "lazy"` in `@securitydept/token-set-context-client/registry`; `preload(key)`, `whenReady(key)`, `idleWarmup()`; Angular `provideTokenSetAuth({ idleWarmup: true })`; React `TokenSetAuthProvider idleWarmup`)
      - ~~React adapter async-readiness equivalent~~ (implemented in iteration 110: `TokenSetAuthProvider`, `useTokenSetAuthRegistry`, `useTokenSetAuthService`, `useTokenSetAuthState`, `useTokenSetAccessToken`, `useTokenSetCallbackResume`, `TokenSetCallbackComponent` with a retained `TokenSetCallbackOutlet` compatibility alias, plus `/react-query` `useTokenSetReadinessQuery`; callback handling now awaits `registry.whenReady(clientKey)` and surfaces `CallbackResumeStatus = "idle" | "pending" | "resolved" | "error"`)
       - ~~raw-Web router full-route aggregation parity with Angular / TanStack~~ (implemented in iteration 110 review-1: `@securitydept/client/web-router` now supports nested `WebRouteDefinition.children` plus `composition: "inherit" | "merge" | "replace"`, exposes `WebRouteMatch.chain`, and submits one aggregated candidate set via `extractFullRouteRequirements(chain)`)
       - ~~`apps/webui` React canonical path real adoption~~ (iteration 111 implemented: TanStack Router tree migrated to `createSecureBeforeLoad()` + `withTanStackRouteRequirements()`; authenticated layout route unified protected routes; app-local `requireAuthenticatedRoute()` removed; `apps/webui` is now the React reference-app authority)
       - ~~`apps/webui` React Query canonical read-path adoption~~ (iteration 113 implemented: token-set groups / entries read paths migrated from imperative fetch / cancellation / setState to `@securitydept/token-set-context-client-react/react-query` hooks; `./react-query` moved from package/examples authority to first-priority reference-app authority)
      - ~~`apps/webui` reference-app mutation dogfooding~~ (iteration 114 implemented: the create-group write path proved the real mutation lifecycle in a reference app and established the invalidation semantics that iteration 115 later promoted into the SDK)
      - ~~`apps/webui` React Query canonical write-path adoption~~ (iteration 115 implemented: `@securitydept/token-set-context-client-react/react-query` now owns the canonical groups / entries mutation hooks, token-set management entity contracts, and query-key / invalidation policy; `apps/webui` dashboard plus the token-set reference page consume the SDK-owned mutation hooks directly, and the app-local `useTokenSetQueries.ts` owner layer is removed)
      - ~~`apps/webui` React canonical keyed consumer-path closeout~~ (iteration 116 implemented: `@securitydept/token-set-context-client-react` now exports `useTokenSetBackendOidcClient(clientKey)` as the SDK-owned lower-level accessor, `./react-query` canonical hooks resolve clients by key instead of requiring explicit `client`, and `apps/webui` login / dashboard / token-set page no longer rely on app-local typed getters or `service.client as ...` narrowing for the canonical consumer path)
      - ~~`apps/webui` multi-context auth-shell closeout~~ (iteration 114 review follow-ups implemented: `/login` is now the stable chooser; Token Set backend-mode login is a real `/auth/token-set/backend-mode/login` OIDC entry; the backend-mode reference page moved to `/playground/token-set/backend-mode`; session callback explicitly targets `/auth/session/callback`; dashboard route gating, current-user/logout, and groups/entries CRUD all branch by persisted `AuthContextMode`)
      - ~~`apps/webui` / `apps/server` token-set reference-path split into backend mode and frontend mode~~ (iteration 117 implemented: the old generic token-set host path is now explicitly backend mode; the host also serves frontend-mode config projection from `/api/auth/token-set/frontend-mode/config`; `/auth/token-set/frontend-mode/callback` is now owned by `TokenSetCallbackComponent`; dashboard bearer integration and TanStack route security are proven across both token-set modes without adding a separate React secure-guard layer)

5. **SSR / server-host baseline clarity**
   - ~~`basic-auth-context` and `session-context` should each have a minimal SSR / server-host story beyond conceptual redirect wording~~ (implemented: `createBasicAuthServerHelper()` and `createSessionServerHelper()` in `./server`)
   - ~~if no dedicated SSR-oriented helper baseline ships, narrow the guide so `CLIENT_SDK_GUIDE` does not overstate server-side support~~ (done: dedicated `./server` subpaths with host-neutral helpers)
   - keep `token-set-context` server-side ownership outside the `0.2.0` baseline; mixed-custody / BFF remain `0.3.0` themes

6. **Auth-context product parity**
   - reduce the gap between the more mature token-set client surface and the lighter basic-auth / session client surfaces
   - keep those surfaces intentionally thin where appropriate, but no longer under-specified
   - ~~`./web` browser-convenience parity~~ (implemented: both `basic-auth-context-client/web` and `session-context-client/web` now export `loginWithRedirect()` with named `LoginWithRedirectOptions`)
   - ~~`-react` package context-value discoverability~~ (implemented: `SessionContextValue` is now a named exported type)
   - remaining gap: these surfaces are intentionally thinner than token-set; the current parity target is named-contract discoverability, not feature equivalence

## Phase 5: Local Credential Operations

9. Continue evolving `securitydept-creds-manage`
   - simple Basic Auth and static-token management
   - operational support for scenarios such as Docker registry login management

Status:

- implemented and already useful

## Phase 6: Reference App Validation

10. Keep `apps/server` as the proving ground for combined scenarios
    - low-level verification primitives
    - basic-auth zone mode
    - cookie-session mode
    - stateless token-set mode
    - creds-manage integration

Current real-world role:

- validation environment
- auth entry point for private Docker registry mirror scenarios
- integration proving ground for cookie-session, basic-auth, and stateless token-set flows

## Cross-Cutting Priorities

- define a shared authenticated-principal abstraction
- keep `oidc-client` and `oauth-resource-server` separate
- keep auth-context modes above those lower layers
- document bearer-forwarding boundaries clearly
- add more integration tests around the reference app as new modes land
- continue extending the Rust / server auth-flow diagnosis baseline beyond the current productized operations (`projection.config_fetch`, `oidc.callback`, `oidc.token_refresh`, `forward_auth.check`, `propagation.forward`) while keeping `securitydept-utils::observability` as the shared vocabulary owner and leaving broader exporter/timeline work outside the current baseline
- continue extending the Rust / server dual-layer HTTP error baseline beyond the current productized auth paths, while keeping `securitydept-utils::error` as the shared envelope owner and preserving the separation between diagnosis (`what happened`) and presentation/recovery (`how the host should react`)

## Deferred To 0.3.0

These topics remain real, but after the current re-audit they are the clearest items that should stay outside the `0.2.0` release target:

- mixed-custody token ownership
- stateful BFF / server-side token-set ownership
- built-in chooser UI or router-level product-flow semantics on top of any future orchestration primitive
- heavier OTel / DI themes
- a full Rust-side structured-observability/exporter stack (for example a heavier OTel pipeline, cross-service exporters, and global trace ingestion); during `0.2.x`, the higher-value work is still the minimal auth-flow operation taxonomy and diagnosis surface first
- Kotlin / Swift SDK productization before the TS contract settles

---

[English](100-ROADMAP.md) | [中文](../zh/100-ROADMAP.md)
