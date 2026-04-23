# Outposts Reference Case

`~/workspace/outposts` is the current downstream adopter calibration case for the SecurityDept TypeScript SDKs. It complements `apps/webui`; it does not replace it.

`apps/webui` remains the primary in-repo reference app and release-gate proof surface. `outposts` is valuable because it is a real consuming workspace with its own Angular host, backend service, route table, and deployment constraints.

## Current Status

Iteration 150 closed the first real adopter calibration line:

- `outposts-web -> confluence` now consumes the SecurityDept Angular/token-set packages instead of `angular-auth-oidc-client`.
- `angular-auth-oidc-client` has been removed from the downstream package manifest.
- The callback route is served by the SDK `TokenSetCallbackComponent`.
- `secureRouteRoot()` carries provider-neutral requirement metadata and next-action policy.
- `provideTokenSetAuth(...)` registers the `Confluence` client with `providerFamily: "authentik"`, `callbackPath: "/auth/callback"`, and URL patterns for the Confluence API endpoint.
- `provideTokenSetBearerInterceptor({ strictUrlMatch: true })` bounds bearer injection to URLs matching registered `urlPatterns` and avoids the single-client fallback for unmatched URLs.
- Focused downstream tests lock callback path preservation, provider-neutral route metadata, bearer injection boundaries, and redirect preservation.
- Existing backend tests in the `confluence` service lock issuer/JWKS/audience/scope behavior, including optional-audience and missing-scope rejection cases.

## Why This Case Matters

`outposts` is a useful calibration case because it represents a host that may grow beyond one backend service:

- one frontend host may eventually manage multiple backend token families
- route areas may require credentials for more than one app
- the host owns user-choice flows, silent/interactive acquisition decisions, and product copy
- the backend still needs provider-neutral bearer/OIDC validation

This is exactly the kind of pressure that reveals whether SDK primitives are reusable or merely shaped around the in-repo reference app.

## What This Case Should Validate

Near-term validation scope:

1. Angular host integration through SecurityDept packages.
2. Backend-driven config projection and local workspace development through `link:` / `path` dependencies.
3. Provider-neutral route requirements and callback preservation.
4. Strict bearer-header injection that does not leak tokens to third-party URLs.
5. Audience/scope/issuer validation on the backend side.
6. Candidate SDK ergonomics gaps that appear in real adopter glue.

## What This Case Must Not Be Misread As

This case is not proof that:

- the SDK ships a built-in multi-requirement chooser UI
- the SDK owns product route tables, page copy, or toast behavior
- app-local `AuthService` code in `outposts` should be copied into the SDK
- `outposts` replaces `apps/webui` as the primary release gate
- cross-repository browser automation is part of the current product line

The correct split is:

- SecurityDept may promote stable headless primitives when repeated adopter pressure proves them.
- Adopters own product UX, business routes, and local glue.
- `apps/webui` stays the primary in-repo reference app for release evidence.

## Direct Impact on SDK Design

Current impact:

- Angular bearer injection now has an explicit `BearerInterceptorOptions.strictUrlMatch` option.
- Multi-backend or third-party-traffic Angular hosts should opt into `strictUrlMatch: true`.
- The SDK should keep room for keyed token-set state projection helpers, but the current `outposts` `AuthService` remains a single-adopter sample and is not yet an SDK API.
- Framework route adapters should stay provider-neutral and express requirements, not provider SDK details.

## Near-Term Plan

Before treating `0.2.0-beta.1` as ready for release execution, use this case only as evidence and backlog input:

1. Keep the current single `Confluence` path locked as downstream proof.
2. Do not add SDK capability solely because one downstream host has local glue.
3. Record repeated ergonomics only after they appear across more than one adopter or across both `apps/webui` and `outposts`.
4. Keep strict bearer injection as the default recommendation for Angular adopters with any multi-backend or third-party traffic.

## Mid-Term Plan

The next useful adopter evidence would be a second backend or a second route requirement inside `outposts`. That would test whether current route-orchestration primitives remain ergonomic under multi-requirement pressure.

## Long-Term Plan

Keep `outposts` as a real feedback surface, not as a second in-repo demo. Its value is that it can disagree with the reference app and expose real host constraints.

## Local Development Constraint

This case should continue to use direct local workspace dependencies while SDK and adopter boundaries evolve:

- Rust: `path` dependencies to local SecurityDept crates
- Node / pnpm: `link:` references to local SecurityDept TS packages

## Related Documents

- SDK boundaries and current contract: [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)
- Auth context and modes: [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)
- Roadmap and release blockers: [100-ROADMAP.md](100-ROADMAP.md)

---

[English](021-REFERENCE-APP-OUTPOSTS.md) | [中文](../zh/021-REFERENCE-APP-OUTPOSTS.md)
