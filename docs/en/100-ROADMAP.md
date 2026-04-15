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

3. **Login-trigger convenience completion**
   - ~~`session-context-client`: move beyond URL-only helpers and add minimal redirect-trigger convenience~~ (implemented: `loginWithRedirect()` in `session-context-client/web`)
   - ~~token-set browser entry: add a minimal redirect-trigger convenience~~ (implemented: `loginWithBackendOidcRedirect()` in `backend-oidc-mode/web`, plus `FrontendOidcModeClient.loginWithRedirect()`)
   - ~~popup login baseline for `backend-oidc-mode` / `frontend-oidc-mode`~~ (implemented: shared infra in `@securitydept/client/web`, plus `loginWithBackendOidcPopup` and `FrontendOidcModeClient.popupLogin()`)

4. **Real multi-requirement orchestration baseline**
   - ~~move multi-OIDC / multi-requirement route orchestration beyond boundary discussion~~ (implemented: `createRequirementPlanner()` in `@securitydept/client/auth-coordination`)
   - ~~deliver at least one headless primitive / pending-requirement model before `0.2.0` GA~~ (implemented: sequential planner with `AuthRequirement`, `PlanStatus`, `ResolutionStatus`, `PlanSnapshot`; `kind` remains an opaque `string`, with no exported `RequirementKind` constant)
   - ~~add the matched-route-chain route-orchestration baseline and complete the cross-tab / visibility readiness sweep~~ (implemented: `createRouteRequirementOrchestrator()` in `@securitydept/client/auth-coordination`, `createCrossTabSync()`, `createVisibilityReconciler()`, and their focused baselines)
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
       - ~~React adapter async-readiness equivalent~~ (implemented in iteration 110: `TokenSetAuthProvider`, `useTokenSetAuthRegistry`, `useTokenSetAuthService`, `useTokenSetAuthState`, `useTokenSetAccessToken`, `useTokenSetCallbackResume`, `TokenSetCallbackOutlet`, plus `/react-query` `useTokenSetReadinessQuery`; callback handling now awaits `registry.whenReady(clientKey)` and surfaces `CallbackResumeStatus = "idle" | "pending" | "resolved" | "error"`)
       - ~~raw-Web router full-route aggregation parity with Angular / TanStack~~ (implemented in iteration 110 review-1: `@securitydept/client/web-router` now supports nested `WebRouteDefinition.children` plus `composition: "inherit" | "merge" | "replace"`, exposes `WebRouteMatch.chain`, and submits one aggregated candidate set via `extractFullRouteRequirements(chain)`)
       - ~~`apps/webui` React canonical path real adoption~~ (iteration 111 implemented: TanStack Router tree migrated to `createSecureBeforeLoad()` + `withTanStackRouteRequirements()`; authenticated layout route unified protected routes; app-local `requireAuthenticatedRoute()` removed; `apps/webui` is now the React reference-app authority)
       - ~~`apps/webui` React Query canonical read-path adoption~~ (iteration 113 implemented: token-set groups / entries read paths migrated from imperative fetch / cancellation / setState to `@securitydept/token-set-context-client-react/react-query` hooks; `./react-query` moved from package/examples authority to first-priority reference-app authority)
       - ~~`apps/webui` reference-app mutation dogfooding~~ (iteration 114 implemented: create-group write path now uses an app-local `useMutation` wrapper with declarative `onSuccess` invalidation via `tokenSetAppQueryKeys`; this remains a reference-app-local implementation, not an SDK-owned mutation surface)
       - ~~`apps/webui` multi-context auth-shell closeout~~ (iteration 114 review follow-ups implemented: `/login` is now the stable chooser; Token Set login is a real `/auth/token-set/login` OIDC entry; the token-set reference page moved to `/playground/token-set`; session callback explicitly targets `/auth/session/callback`; dashboard route gating, current-user/logout, and groups/entries CRUD all branch by persisted `AuthContextMode`)

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

## Deferred To 0.3.0

These topics remain real, but after the current re-audit they are the clearest items that should stay outside the `0.2.0` release target:

- mixed-custody token ownership
- stateful BFF / server-side token-set ownership
- built-in chooser UI or router-level product-flow semantics on top of any future orchestration primitive
- heavier OTel / DI themes
- Kotlin / Swift SDK productization before the TS contract settles

---

[English](100-ROADMAP.md) | [中文](../zh/100-ROADMAP.md)
