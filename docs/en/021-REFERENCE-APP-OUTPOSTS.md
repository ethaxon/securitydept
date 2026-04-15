# Outposts Reference Case

This document explains why `~/workspace/outposts` should be treated as a high-value downstream reference case for the `securitydept` client SDKs, and how it should inform SDK planning in the near, mid, and long term.

It is not a replacement for `apps/webui`.  
`apps/webui` remains the primary dogfooding / reference app; the value of `outposts` is that it represents a **real downstream adopter**, not an in-repo SDK product demo.

## Why This Case Matters

`outposts-web` is expected to front multiple backend services such as:

- `confluence`
- `app1`
- `app2`

Those services may eventually use different OIDC clients, audiences, or scope sets.  
That makes `outposts` valuable for validating:

- one frontend host managing multiple backend token families / token sets
- route areas that require credentials for more than one app
- auth flows that are no longer just “single-client login”, but route-level requirement orchestration
- adopter-owned decisions around silent acquisition, redirect-based acquisition, and user-choice flows

This helps answer two key questions:

- whether the current auth-context / mode layering can really support multi-requirement scenarios, with the frontend entering via `token-set-context-client` and the backend via `securitydept-token-set-context` (see [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md))
- whether the OIDC mode-family boundaries are clear:
  - **`/orchestration`**: shared protocol-agnostic token lifecycle substrate
  - **`/frontend-oidc-mode` (`frontend-oidc`)**: frontend pure OIDC client
  - **`/backend-oidc-mode`**: the canonical frontend-facing entry for consuming the unified `backend-oidc` capability framework
  - **`securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_mode, access_token_substrate}`**: the Rust side should expose the formal modes and shared substrate directly instead of keeping `frontend` / `backend` as first-level public namespaces

## What This Case Should Validate

In the near term, `outposts` should be used to validate:

1. Whether a provider-neutral frontend auth boundary is clear enough  
   The current single-`confluence` flow is already on a standard OIDC / Authentik-first baseline. The next question is whether frontend auth capability can stay provider-neutral beyond that single path instead of re-binding to one provider SDK.

2. Where route-level requirement orchestration should live  
   When one route requires both `app1` and `app2`, the hard problem is not only “how to get tokens”, but:
   - which requirement runs first
   - which requirements can be satisfied silently
   - which requirements require interactive redirect
   - whether the user should see a chooser first
   - how failure of one requirement affects the route

3. Whether backend Bearer / OIDC validation can remain provider-neutral  
   `confluence` is already close to a generic issuer / JWKS / audience / scope validation model. This case can confirm that the backend needs a stable OIDC contract, not assumptions inherited from a frontend IdP SDK.

4. Whether local multi-workspace development remains smooth  
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
- chooser UI, router policy, and product-facing flow semantics still belong to the adopter’s own app glue
- if the current Angular auth module in `outposts` carries migration-era constraints, treat it as migration input plus host constraints, not as the template for the SDK’s public Angular API

## Direct Impact on SDK Design

This reference case matters most for the current auth stack’s OIDC mode family:

- the current `outposts` single-`confluence` path is better at validating the **`frontend-oidc` / `backend-oidc` baseline** and the **orchestration / resource-server** layer
- it is currently closer to the `pure` preset of `backend-oidc`, and does **not yet directly validate** the sealed-refresh / metadata-redemption augmentation
- it is, however, a strong reference for the cross-mode substrate around access-token injection, resource-server verification, and `X-SecurityDept-Propagation`

Current recommendation:

1. Keep room in the SDK for multi-token-family / multi-source abstractions.
2. The frontend product surface’s internal subpath family has evolved into, while the Rust side should converge on, top-level `*_mode` / shared modules:
   - `/orchestration`: shared token lifecycle substrate
   - `/frontend-oidc-mode`: the `frontend-oidc` mode
   - `/backend-oidc-mode`: the canonical frontend-facing subpath for consuming `backend-oidc`
3. Move route-level multi-requirement orchestration toward **headless orchestration primitives** first.
4. If a default recommendation exists, it should be:
   - a default scheduler / orchestrator
   - very thin `web` / `angular` / `react` adapters
   - a reference/example UI
5. Chooser UI, product copy, and failure-fallback policy should not be hard-coded into the core SDK.
6. The public Angular adapter contract should primarily express `securitydept` domain capabilities, route/orchestration projection, and Angular ergonomics, then prove that `outposts` can migrate onto it.

In short:

- **the orchestration layer has been separated from OIDC-mediated-specific flows as `/orchestration`**
- **multi-requirement orchestration is worth bringing into SDK design**
- **multi-requirement interaction UI should not become a built-in SDK responsibility**

## Near-Term Plan

The near-term focus should be:

1. Split out a provider-neutral auth boundary inside `outposts`.
2. On top of the current standard OIDC / Authentik-first baseline, validate:
   - callback / redirect / route preservation
   - access-token injection
   - audience / scope contract
   - the `oauth-resource-server` Bearer-validation baseline in a real adopter single-path integration
3. Turn that single-path integration into direct SDK feedback:
   - standard OIDC scenarios should converge on two formal mode-aligned frontend entries: `/frontend-oidc-mode` and `/backend-oidc-mode`
   - `pure` / `mediated` are better treated as presets / profiles inside `backend-oidc`, not as long-lived peer modes
   - the Rust crate should not keep `frontend` / `backend` as first-level public namespaces; the canonical shape should be top-level `frontend_oidc_mode`, `backend_oidc_mode`, and `access_token_substrate`
   - resource-server / propagation / forwarder should no longer be described as preset-owned materials; they depend only on the access token and propagation headers, so they should be promoted into the top-level shared module `access_token_substrate`
4. Do not rush chooser UI or router glue back into the SDK.
5. As `outposts` migrates from `angular-auth-oidc-client` toward the SDK Angular packages (`provideTokenSetAuth()`, `@securitydept/token-set-context-client-angular`, and so on), do not productize app-local transitional glue as SDK API; treat [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) as the adapter contract, then validate migration onto those surfaces.

## Mid-Term Plan

The mid-term focus should be:

1. Derive a stable requirement model from real `outposts` needs.
2. Observe which orchestration steps are stable enough to promote into SDK-level headless primitives.
3. Evaluate whether `web` / `angular` / `react` adapters should expose a default recommended scheduler.

## Long-Term Plan

The long-term goal is not to turn `outposts` into a second internal SDK demo, but to:

1. keep it as an active real-adopter feedback surface
2. ground future SDK boundary decisions in a real migration experience
3. make clear which capabilities belong in the SDK and which should stay in adopter app glue

## Local Development Constraint

This case should use direct local workspace dependencies instead of published versions:

- Rust: continue using workspace `path` dependencies such as `../securitydept/packages/core`
- Node / pnpm: prefer `link:` references to local `securitydept` TS packages

The reason is simple:

- this is a jointly evolving real-adopter case
- its value comes from validating current SDK boundaries immediately, not from trailing released packages

## Related Documents

- SDK boundaries and current contract: `docs/en/007-CLIENT_SDK_GUIDE.md`
- Outposts project-side auth plan: `~/workspace/outposts/docs/en/003-AUTH.md`

---

[English](021-REFERENCE-APP-OUTPOSTS.md) | [中文](../zh/021-REFERENCE-APP-OUTPOSTS.md)
