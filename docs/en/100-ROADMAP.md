# Roadmap

This roadmap is aligned with the current project goal: turn SecurityDept into a mesh-oriented authentication and authorization toolkitwith `apps/server` acting as the proving ground.

## Phase 1: Low-Level Verification and Provider Layers

1. Finish and harden low-level creds verification
   - Basic Auth
   - static token
   - RFC 9068
   - JWT and JWE helpers
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
   - JWT/JWE/opaque verification
   - policy configuration
   - shared provider reuse
   - explicit principal extraction

Status:

- largely implemented

## Phase 3: Auth Context Modes

5. Implement basic auth zone mode
   - backend routing helpers
   - documented flow
   - thin client helper for zone-aware `401 -> login` redirect and logout URL handling
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

- basic auth zone: documented, not fully productized
- cookie-session: reference implementation exists; the reusable core already lives in `securitydept-session-context`; route-facing services (`SessionAuthServiceTrait` / `OidcSessionAuthService` / `DevSessionAuthService`) are now directly in that crate via the `service` feature
- stateless token-set mode: the core server and shared crate are in place; `securitydept-auth-runtime` has been dissolved; mode-specific and substrate-specific services are now in `securitydept-token-set-context`; `frontend-oidc` now has formal `Config / ResolvedConfig / ConfigSource / Runtime / Service / ConfigProjection`; OIDC protocol-level principal extraction shared across presets is in `securitydept-oidc-client::auth_state`; `backend-oidc` is now a single capability framework whose different capability bundles are expressed as presets / profiles; mixed-custody / BFF / server-side token-set remain later-scope topics

## Phase 4: Frontend SDKs

8. Provide lightweight TypeScript SDKs
   - basic auth zone helper for zone boundary detection, `401 -> login` redirection, and logout redirects
   - cookie-session redirect helper
   - stateless token-set SDK for token storage, header injection, background refresh, and login redirects

Status:

- the TypeScript SDK is no longer only an architecture draft; the foundation packages, auth-context roots, `./web` adapters, React adapters, and reference-app dogfooding baseline are now implemented
- the repository now already has external-consumer scenarios, a token-set web-focused lifecycle baseline, and a minimal React-adapter-focused test
- the current phase is no longer “start implementing the SDK”; it is contract freeze for `stable / provisional / experimental`, token-set v1 scope clarification, and clearer adopter-facing status
- mixed-custody, stateful BFF, server-side token-set, and heavier OTel / DI themes remain later-stage topics rather than the current frontend SDK track

Reference:

- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

## Current Priority Queue

The roadmap above is still useful as a phase map, but it no longer captures the
real bottleneck of the project. The main risk is not "missing one more feature";
it is direction drift between public SDK contracts, adopter expectations, and
reference-app validation.

The current priority queue should therefore be read as:

### Priority 0: Turn the TypeScript SDK freeze into an executable release gate

Why this is first:

- the repository already has real TS SDK code, adapters, and adopter-facing docs
- the biggest remaining risk is not raw implementation volume, but surface drift
- `stable / provisional / experimental` already exist in [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md), but roadmap-level execution criteria are still too implicit

What is still missing:

- an authoritative public-surface inventory across root exports and subpaths
- explicit promotion / freeze gates backed by public-surface tests, example coverage, and docs alignment
- a lightweight 0.x breaking-change / migration discipline for TS SDK contracts

### Priority 1: Validate the SDK against real downstream adopters, not only in-repo demos

Why this is second:

- `apps/webui` is valuable dogfooding, but it is still an in-repo reference app
- the project already recognizes `outposts` as a high-value downstream case, yet this is not reflected strongly enough in the roadmap
- many next-step decisions depend on real adopter evidence: multi-integration layout, route-level auth orchestration, browser/runtime assumptions, and ownership boundaries

What this should validate:

- single-host / multi-backend token families
- route-level requirement orchestration and failure policy boundaries
- clearer separation between SDK primitives and adopter app glue

### Priority 2: Close the browser-owned token-set v1 baseline before expanding scope

Why this remains high priority:

- the docs already state that the current token-set direction is a browser-owned v1 baseline
- after the re-audit, only mixed-custody / BFF / server-side token ownership remain explicitly deferred to `3.0`
- popup login baseline is now implemented; cross-tab lifecycle hardening and multi-provider orchestration remain unfinished `2.0` backlog items
- without a roadmap-level reminder, both the true `3.0` deferrals and the still-required `2.0` backlog items are too easy to misread in day-to-day implementation discussions

What needs to be made more explicit:

- what evidence is required before the current token-set baseline can be treated as a v1-ready external contract
- which remaining hardening topics are still inside the browser-owned baseline
- which adjacent topics are `2.0` backlog versus explicitly deferred to `3.0`

### Priority 3: Restore auth-context product parity across the three modes

Why this is now a planning gap:

- token-set SDK work has advanced much faster than the other auth-context client surfaces
- the roadmap still mentions basic-auth and cookie-session helpers, but not as a current imbalance to correct
- if left unattended, the project risks having one well-shaped TS product surface and two "documented but not equally productized" ones

Current parity gaps to watch:

- `basic-auth-context-client` remains intentionally thin, but still needs a clearer productized baseline
- `session-context-client` is stable at the root contract level, but its adopter-facing helper story is still much lighter than token-set

### Priority 4: Add public-surface governance and release discipline to the project docs

Why this is separate from Priority 0:

- Priority 0 is about the SDK freeze as an execution gate
- this priority is about keeping the whole project readable to future decision-makers and implementers

What is still missing at the documentation level:

- a compact "current strategic priorities" statement in the roadmap itself
- a clearer distinction between "implemented", "externally explainable", and "promotable to stable"
- a project-level expectation that roadmap, SDK guide, examples, and exported surfaces move together

### Priority 5: Keep non-TS expansion explicitly deferred until the TS surface settles

Why this needs to be said directly:

- Kotlin and Swift are still listed as future SDK directions
- that is fine as a long-term architectural stance
- but the current project should not spend roadmap attention on cross-language expansion before the TypeScript surface is frozen enough to serve as the reference contract

Current rule of thumb:

- TypeScript remains the only active SDK productization track
- Kotlin / Swift remain future follow-on work after the TS external contract is materially clearer

## 2.0 Release Backlog (Derived From the Client SDK Re-audit)

Unless a topic is explicitly deferred to 3.0 below, unfinished items still
described in [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) should now be
treated as **2.0 release backlog**, not as vague future ideas.

The intent for `2.0` is not "perfectly complete", but:

- basic implementation exists
- adopter-facing shape is explainable
- at least one meaningful validation path exists (tests, examples, or reference-app proof)

Current 2.0 backlog priorities:

1. **TS SDK freeze and release-gate discipline**
   - ~~authoritative public-surface inventory~~ (implemented: `public-surface-inventory.json` covering all packages, subpaths, stability, evidence, and docs anchors)
   - ~~promotion / freeze gates tied to docs, examples, and public-surface tests~~ (implemented: `release-gate.test.ts` validates export alignment, evidence existence, docs anchors, stability, and completeness)
   - ~~lightweight 0.x breaking-change / migration discipline~~ (implemented: `changeDiscipline` field in inventory, `110-TS_SDK_MIGRATIONS.md` migration ledger, gate validates discipline/stability alignment and ledger existence)

2. **Validation abstraction and input/runtime completeness**
   - ~~real SDK-level `@standard-schema` adoption rather than guide-only preference~~ (implemented: `createSchema` / `validateWithSchema` in `@securitydept/client`; real adoption in `session-context-client.fetchMe()`, `frontend-oidc-mode.parseConfigProjection()`, `BasicAuthContextClient` config validation, `parseBackendOidcModeCallbackBody` / `parseBackendOidcModeRefreshBody`)
   - ~~minimal unified input-source / scheduling baseline above the current raw scheduler abstraction~~ (implemented: `timer`, `interval`, `scheduleAt`, `fromEventPattern` in `@securitydept/client`; `fromVisibilityChange` in `@securitydept/client/web`; real adoption in `FrontendOidcModeClient`)

3. **Login-trigger convenience completion**
   - ~~`session-context-client`: move beyond URL-only helpers and add a minimal redirect-trigger convenience~~ (implemented: `loginWithRedirect()` in `session-context-client/web`)
   - ~~token-set browser entry: add a minimal redirect-trigger convenience~~ (implemented: `loginWithBackendOidcRedirect()` in `backend-oidc-mode/web`, `FrontendOidcModeClient.loginWithRedirect()`)
   - ~~popup login baseline for `backend-oidc-mode` / `frontend-oidc-mode`~~ (implemented: shared infra in `@securitydept/client/web`, `loginWithBackendOidcPopup`, `FrontendOidcModeClient.popupLogin()`)

4. **Real multi-requirement orchestration baseline**
   - ~~move multi-OIDC / multi-requirement route orchestration beyond boundary discussion~~ (implemented: `createRequirementPlanner()` in `@securitydept/token-set-context-client/orchestration`)
   - ~~deliver at least one headless primitive / pending-requirement model before 2.0 GA~~ (implemented: sequential planner with `AuthRequirement`, `RequirementKind`, `PlanStatus`, `ResolutionStatus`, `PlanSnapshot`)

5. **SSR / server-side host baseline clarity**
   - ~~`basic-auth-context` and `session-context` should each have a minimal SSR / server-host story beyond conceptual redirect wording~~ (implemented: `createBasicAuthServerHelper()` in `./server`, `createSessionServerHelper()` in `./server`)
   - ~~if no dedicated SSR-oriented helper baseline ships, narrow the guide so `CLIENT_SDK_GUIDE` does not overstate server-side support~~ (shipped: dedicated `./server` subpaths with host-neutral helpers)
   - keep `token-set-context` server-side ownership outside the 2.0 baseline; mixed-custody / BFF remain 3.0 themes

6. **Auth-context product parity**
   - reduce the gap between the more mature token-set client surface and the lighter basic-auth / session client surfaces
   - keep those surfaces intentionally thin where appropriate, but no longer under-specified

## Phase 5: Local Credential Operations

9. Continue evolving `securitydept-creds-manage`
   - simple Basic Auth and static token management
   - operational support for scenarios such as Docker registry login management

Status:

- implemented and already useful

## Phase 6: Reference App Validation

10. Keep `apps/server` as the proving ground for combined scenarios
    - low-level verification primitives
    - basic auth zone mode
    - cookie-session mode
    - stateless token-set mode
    - creds-manage integration

Current real-world role:

- validation environment
- auth entry point for private Docker registry mirror scenarios
- integration proving ground for cookie-sessionbasic-authand stateless token-set flows

## Cross-Cutting Priorities

- define a shared authenticated-principal abstraction
- keep `oidc-client` and `oauth-resource-server` separate
- keep auth-context modes above those lower layers
- document bearer forwarding boundaries clearly
- add more integration tests around the reference app as new modes land

## Deferred To 3.0

These topics remain real, but after the current re-audit they are the main
items that should stay outside the 2.0 release target:

- mixed-custody token ownership
- stateful BFF / server-side token-set ownership
- built-in chooser UI or router-level product flow semantics on top of any future orchestration primitive
- heavier OTel / DI themes
- Kotlin / Swift SDK productization before the TS contract settles

---

[English](100-ROADMAP.md) | [中文](../zh/100-ROADMAP.md)
