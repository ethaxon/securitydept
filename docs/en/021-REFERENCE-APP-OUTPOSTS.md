# Outposts Reference Case

This document explains why `/workspace/outposts` should be treated as a high-value downstream reference case for the `securitydept` Client SDKs, and how it should inform SDK planning in the near, mid, and long term.

It is not a replacement for `apps/webui`.  
`apps/webui` remains the primary dogfooding / reference app. The value of `outposts` is that it represents a **real downstream adopter**, not an in-repo product demo for the SDK itself.

## Why This Case Matters

`outposts-web` is expected to front multiple backend services such as:

- `confluence`
- `app1`
- `app2`

Those services may eventually use different OIDC clients / audiences / scope sets.  
That makes `outposts` valuable for validating:

- a single frontend host managing multiple backend token families / token sets
- frontend route areas that require credentials for more than one app
- auth flows that are no longer just “single client login”, but “route-level requirement orchestration”
- adopter-owned decisions around silent acquisition, direct redirects, and user-choice flows

This is exactly the kind of scenario that can tell us whether `token-set-context-client` can support real multi-requirement integration instead of staying limited to single-provider / single-callback happy paths.

## What This Case Should Validate

In the near term, `outposts` should be used to validate:

1. whether a provider-neutral frontend auth boundary is clear enough  
   the current single-`confluence` flow is already on a standard OIDC / Authentik-first baseline. The next question is whether frontend auth capability can stay provider-neutral beyond that single path instead of re-binding to one provider SDK.

2. where route-level requirement orchestration should live  
   When one route requires both `app1` and `app2`, the hard problem is not only “how to get tokens”, but:
   - which requirement runs first
   - which requirements can be satisfied silently
   - which requirements require interactive redirect
   - whether the user should see a chooser first
   - how failure of one requirement affects the route

3. whether backend Bearer / OIDC validation can remain provider-neutral  
   `confluence` is already close to a generic issuer + JWKS + audience + scope validation model. This case can confirm that the backend needs a stable OIDC contract, not assumptions inherited from a frontend IdP SDK.

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
- chooser UI, router policy, and product-facing flow semantics still belong to the adopter’s own app glue

## Direct Impact on SDK Design

This reference case matters most for `token-set-context-client`.

Current recommendation:

1. keep room in the SDK for multi-token-family / multi-source abstractions
2. move route-level multi-requirement orchestration toward **headless orchestration primitives** first
3. if a default recommendation exists, it should be:
   - a default scheduler / orchestrator
   - very thin `web` / `angular` / `react` adapters
   - a reference/example UI
4. chooser UI, product copy, and failure fallback policy should not be hard-coded into the core SDK

In short:

- **multi-requirement orchestration is worth bringing into SDK design**
- **multi-requirement interaction UI should not become a built-in SDK responsibility**

## Near-Term Plan

The near-term focus should be:

1. split out a provider-neutral auth boundary inside `outposts`
2. on top of the current standard OIDC / Authentik-first baseline, validate:
   - callback / redirect / route preservation
   - access-token injection
   - audience / scope contract
   - the `oauth-resource-server` Bearer-validation baseline in a real adopter single-path integration
   - a minimal route-level requirement orchestration prototype
3. do not rush chooser UI or router glue back into the SDK

## Mid-Term Plan

The mid-term focus should be:

1. derive a stable requirement model from real `outposts` needs
2. observe which orchestration steps are stable enough to promote into SDK-level headless primitives
3. evaluate whether `web` / `angular` / `react` adapters should expose a default recommended scheduler

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
- Outposts project-side auth plan: `/workspace/outposts/docs/en/003-AUTH.md`

---

[English](021-REFERENCE-APP-OUTPOSTS.md) | [中文](../zh/021-REFERENCE-APP-OUTPOSTS.md)
