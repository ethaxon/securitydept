# Outposts Reference Case

`~/workspace/outposts` is the current downstream calibration case for the SecurityDept TypeScript SDKs. It complements `apps/webui`; it does not replace the in-repo reference app.

Because `outposts` is an external workspace, this document records calibration results and integration pressure rather than a fully reproducible public test plan. `apps/webui` remains the primary in-repo release-gate proof surface.

## What This Case Currently Proves

The current calibration line demonstrates that:

- `outposts-web -> confluence` now consumes the SecurityDept Angular/token-set packages instead of `angular-auth-oidc-client`.
- Callback route adaptation is moving to a new Angular bridge over the core token-set registry controller; the old Angular drop-in callback component is no longer part of the SDK surface.
- `secureRouteRoot()` carries provider-neutral requirement metadata and next-action policy.
- `provideTokenSetClientRegistry(...)` registers the `Confluence` client with explicit `providerFamily`, `callbackPath`, and `urlPatterns`.
- Route-login integration uses `BaseOidcModeClient.loginWithRedirect({ postAuthRedirectUri })`; the client should already carry a stable page router through its environment rather than receiving a per-call page factory.
- Registry-managed browser clients now use the core `TokenSetClientRegistry` lifecycle through `provideTokenSetClientRegistry(...)`; the adopter does not need a separate wrapper just to recover resume behavior.
- `provideTokenSetClientRegistryAuthorizationInterceptor()` constrains authorization injection to registered URLs and avoids fallback authorization for unmatched URLs.
- Short access-token lifetimes are expected to recover through SDK freshness barriers before redirect or bearer injection when refresh material exists.
- Focused downstream tests lock callback preservation, provider-neutral route metadata, bearer injection boundaries, and redirect preservation.

Browser diagnostics and local Authentik runs remain useful, but they are calibration evidence, not a substitute for the in-repo release gates.

## Why This Case Matters

`outposts` is valuable because it applies pressure that the in-repo reference app does not fully model on its own:

- one frontend host may eventually manage multiple backend token families
- route areas may require credentials for more than one app
- the host owns user-choice flows, silent/interactive acquisition decisions, and product copy
- the backend still needs provider-neutral bearer/OIDC validation

This is the kind of pressure that reveals whether SDK primitives are reusable or merely shaped around one reference app.

## How This Case Influences SDK Design

Current design guidance reinforced by this case:

- Angular authorization injection should remain bounded by client registry URL matching, with `authorizationForRequest` available for host-specific routing rules.
- Angular route and request handling should consume the canonical replay channels: route guards wait for `isAuthenticated`, and interceptors wait for `authorizationHeaderValue`. Adopter-local code should not rebuild imperative freshness or bearer fallback chains.
- Browser token-set clients should keep default resume reconciliation unless an adopter deliberately replaces it with an equivalent freshness barrier.
- Authentik or equivalent provider configuration must keep refresh material available to browser-owned token-set clients, including `offline_access` and workable refresh-token lifetime/rotation.
- The SDK may eventually promote repeated headless primitives, but a single adopter-local `AuthService` is still sample code, not public SDK API.

## What This Case Does Not Prove

This case is not evidence that:

- the SDK ships a built-in multi-requirement chooser UI
- the SDK owns product route tables, page copy, or toast behavior
- adopter-local `AuthService` code should be copied into the SDK
- `outposts` replaces `apps/webui` as the primary release gate
- cross-repository browser automation is part of the current product line

The intended split stays the same:

- SecurityDept promotes stable headless primitives when repeated adopter pressure proves them.
- Adopters own product UX, business routes, and local glue.
- `apps/webui` remains the primary in-repo executable proof surface.

## Local Cross-Workspace Verification Constraints

This case still depends on direct local workspace dependencies while SDK and adopter boundaries evolve:

- Rust: `path` dependencies to local SecurityDept crates
- Node / pnpm: `link:` references to local SecurityDept TS packages

Recommended local sequence:

1. Start the downstream environment in `outposts` with `just dev-confluence` first and `just dev-webui` second.
2. After changing linked SecurityDept SDK packages, rebuild the affected package outputs.
3. Clear `outposts/.angular/cache` before restarting the downstream web UI, or Angular/Vite may keep serving stale linked artifacts.

For local cross-workspace verification, use pnpm `link:` dependencies rather than overrides. Plain TS packages may link to package roots, but Angular `ng-packagr` packages should link to their built `dist/` outputs instead of the workspace roots. A representative downstream pattern is:

```json
{
	"@securitydept/client": "link:../securitydept/sdks/ts/packages/client",
	"@securitydept/client-angular": "link:../securitydept/sdks/ts/packages/client-angular/dist",
	"@securitydept/token-set-context-client": "link:../securitydept/sdks/ts/packages/token-set-context-client",
	"@securitydept/token-set-context-client-angular": "link:../securitydept/sdks/ts/packages/token-set-context-client-angular/dist"
}
```

Linking Angular package roots points the adopter at monorepo manifests and local Angular type installs, not the consumer-shaped `ngc` / `ng-packagr` output. That is the failure mode behind local `Route` double-type-universe regressions during linked downstream verification.

If the downstream workspace also runs standalone TypeScript checks outside the Angular builder, keep its Angular patch versions aligned with the current SecurityDept SDK toolchain line before rerunning `tsc`, `nx test`, or `nx build`.

## Related Documents

- SDK boundaries and current contract: [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)
- Auth context and modes: [020-AUTH_CONTEXT_AND_MODES.md](020-AUTH_CONTEXT_AND_MODES.md)
- Roadmap and release blockers: [100-ROADMAP.md](100-ROADMAP.md)

---

[English](021-REFERENCE-APP-OUTPOSTS.md) | [中文](../zh/021-REFERENCE-APP-OUTPOSTS.md)
