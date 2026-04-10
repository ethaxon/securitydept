# Outposts Reference Case

This document explains why `~/workspace/outposts` should be treated as a high-value downstream reference case for the `securitydept` Client SDKsand how it should inform SDK planning in the nearmidand long term.

It is not a replacement for `apps/webui`.  
`apps/webui` remains the primary dogfooding / reference app. The value of `outposts` is that it represents a **real downstream adopter**not an in-repo product demo for the SDK itself.

## Why This Case Matters

`outposts-web` is expected to front multiple backend services such as:

- `confluence`
- `app1`
- `app2`

Those services may eventually use different OIDC clients / audiences / scope sets.  
That makes `outposts` valuable for validating:

- a single frontend host managing multiple backend token families / token sets
- frontend route areas that require credentials for more than one app
- auth flows that are no longer just “single client login”but “route-level requirement orchestration”
- adopter-owned decisions around silent acquisitiondirect redirectsand user-choice flows

This is exactly the kind of scenario that can help us answer two questions:

- whether the current auth stack's auth-context / mode layering can truly support multi-requirement scenarioswith the frontend entering via `token-set-context-client` and the backend via `securitydept-token-set-context` (see [020-AUTH_CONTEXT_AND_MODES](020-AUTH_CONTEXT_AND_MODES.md))
- whether the OIDC mode family boundaries are clear:
  - **`/orchestration`**: shared protocol-agnostic token lifecycle substrate
  - **`/frontend-oidc-mode` (`frontend-oidc`)**: frontend pure OIDC client
  - **`/backend-oidc-mode`**: the canonical frontend-facing entry for consuming the unified `backend-oidc` capability framework
  - **`securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_mode, access_token_substrate}`**: the Rust side should expose the formal modes and the shared substrate rather than keeping `frontend` / `backend` as the first-level public namespace

## What This Case Should Validate

In the near term`outposts` should be used to validate:

1. whether a provider-neutral frontend auth boundary is clear enough  
   the current single-`confluence` flow is already on a standard OIDC / Authentik-first baseline. The next question is whether frontend auth capability can stay provider-neutral beyond that single path instead of re-binding to one provider SDK.

2. where route-level requirement orchestration should live  
   When one route requires both `app1` and `app2`the hard problem is not only “how to get tokens”but:
   - which requirement runs first
   - which requirements can be satisfied silently
   - which requirements require interactive redirect
   - whether the user should see a chooser first
   - how failure of one requirement affects the route

3. whether backend Bearer / OIDC validation can remain provider-neutral  
   `confluence` is already close to a generic issuerJWKSaudiencescope validation model. This case can confirm that the backend needs a stable OIDC contractnot assumptions inherited from a frontend IdP SDK.

4. whether local multi-workspace development remains smooth  
   This reference case should use direct local references:
   - Rust via `cargo` workspace `path`
   - Node via `pnpm` `link:`

## What This Case Must Not Be Misread As

This case must not be treated as proof that:

- the SDK already ships a built-in multi-requirement chooser UI
- the SDK already absorbs framework router glue or app-level auth UX
- the SDK has already completed broader browser-host semantics or browser-matrix guarantees
- `outposts` will replace `apps/webui` as the main release gate

The correct boundary is:

- `securitydept` may eventually provide **headless primitive / scheduler direction** for this kind of downstream scenario
- chooser UIrouter policyand product-facing flow semantics still belong to the adopter’s own app glue
- if the current Angular auth module in `outposts` carries migration-era constraints, treat it as migration input plus host constraints, not as the template for the SDK's public Angular API

## Direct Impact on SDK Design

This reference case matters most for the current auth stack's OIDC mode family:

- the current `outposts` single-`confluence` path is better at validating the **`frontend-oidc` / `backend-oidc` baseline** and the **orchestrationresource-server** layer
- it is currently closer to the `pure` preset of `backend-oidc`and does **not yet directly validate** the sealed-refresh / metadata-redemption augmentation
- it ishowevera strong reference for the cross-mode substrate around access-token injectionresource-server verificationand `X-SecurityDept-Propagation`

Current recommendation:

1. keep room in the SDK for multi-token-family / multi-source abstractions
2. the frontend product surface's internal subpath family has evolved intowhile the Rust side should converge on top-level `*_mode` / shared modules:
   - `/orchestration`: shared token lifecycle substrate
   - `/frontend-oidc-mode`: `frontend-oidc` mode
   - `/backend-oidc-mode`: canonical frontend-facing subpath for consuming `backend-oidc`
3. move route-level multi-requirement orchestration toward **headless orchestration primitives** first
4. if a default recommendation existsit should be:
   - a default scheduler / orchestrator
   - very thin `web` / `angular` / `react` adapters
   - a reference/example UI
5. chooser UIproduct copyand failure fallback policy should not be hard-coded into the core SDK
6. the public Angular adapter contract should primarily express `securitydept` domain capabilities, route/orchestration projection, and Angular ergonomics, then prove that `outposts` can migrate onto it

In short:

- **the orchestration layer has been separated from OIDC-mediated-specific flows as `/orchestration`**
- **multi-requirement orchestration is worth bringing into SDK design**
- **multi-requirement interaction UI should not become a built-in SDK responsibility**

## Near-Term Plan

The near-term focus should be:

1. split out a provider-neutral auth boundary inside `outposts`
2. on top of the current standard OIDC / Authentik-first baselinevalidate:
   - callback / redirect / route preservation
   - access-token injection
   - audience / scope contract
   - the `oauth-resource-server` Bearer-validation baseline in a real adopter single-path integration
3. turn that single-path integration into direct SDK feedback:
   - standard OIDC scenarios should converge on two formal mode-aligned frontend entries: `/frontend-oidc-mode` and `/backend-oidc-mode`
   - pure / mediated are better treated as presets / profiles inside `backend-oidc`not as long-lived peer modes
   - the Rust crate should not keep `frontend` / `backend` as its first-level public namespace; the canonical shape should be top-level `frontend_oidc_mode``backend_oidc_mode`and `access_token_substrate`
   - resource-server / propagation / forwarder should no longer be described as preset-owned materials; they depend only on the access token and propagation headerso they should be promoted into the top-level shared module `access_token_substrate`
4. do not rush chooser UI or router glue back into the SDK
5. even if `outposts` currently bridges through `angular-auth-oidc-client` or a project-local `AuthService`, do not productize those transitional shapes as SDK API; first derive a better Angular adapter / helper contract, then validate migration onto it

## Mid-Term Plan

The mid-term focus should be:

1. derive a stable requirement model from real `outposts` needs
2. observe which orchestration steps are stable enough to promote into SDK-level headless primitives
3. evaluate whether `web` / `angular` / `react` adapters should expose a default recommended scheduler

## Long-Term Plan

The long-term goal is not to turn `outposts` into a second internal SDK demobut to:

1. keep it as an active real-adopter feedback surface
2. ground future SDK boundary decisions in a real migration experience
3. make clear which capabilities belong in the SDK and which should stay in adopter app glue

## Local Development Constraint

This case should use direct local workspace dependencies instead of published versions:

- Rust: continue using workspace `path` dependencies such as `../securitydept/packages/core`
- Node / pnpm: prefer `link:` references to local `securitydept` TS packages

The reason is simple:

- this is a jointly evolving real-adopter case
- its value comes from validating current SDK boundaries immediatelynot from trailing released packages

## Related Documents

- SDK boundaries and current contract: `docs/en/007-CLIENT_SDK_GUIDE.md`
- Outposts project-side auth plan: `~/workspace/outposts/docs/en/003-AUTH.md`

---

[English](021-REFERENCE-APP-OUTPOSTS.md) | [中文](../zh/021-REFERENCE-APP-OUTPOSTS.md)
