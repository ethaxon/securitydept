// Angular integration family for @securitydept/token-set-context-client
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client-angular"
//
// Multi-client-first Angular-native adapter surface:
//   - Keyed client registration via provideTokenSetAuth()
//   - Multi-client lookup via TokenSetAuthRegistry
//   - Per-client TokenSetAuthService with signal + RxJS bridge
//   - Multi-client bearer interceptor (functional + class-based)
//   - provideTokenSetBearerInterceptor() for NgModule HTTP_INTERCEPTORS setup
//   - OIDC callback resume with client key discrimination
//   - CallbackResumeService.isCallback() for programmatic callback detection
//   - TokenSetCallbackComponent standalone component (drop-in callback route)
//   - Requirement/provider-family → client key mapping
//   - secureRouteRoot() / secureRoute() — canonical Angular Router route-security
//     builders: keep non-serializable runtime policy at the root, let child
//     routes declare serializable requirement metadata only, and wire both
//     canActivate + canActivateChild to the full-route aggregation guard.
//   - createTokenSetRouteAggregationGuard() — lower-level advanced guard for
//     direct route-tree evaluation when adopters intentionally bypass the route
//     builder helpers.
//   - Signal/Observable bridge utilities live in @securitydept/client-angular
//
// Built by ng-packagr (APF / FESM2022). Decorators are fully supported.
//
// Stability: provisional (framework adapter)

export * from "./bearer-interceptor";
export * from "./callback-resume.service";
export * from "./contracts";
export * from "./guard-types";
export * from "./oidc-callback-url";
export * from "./provide-token-set-auth";
export * from "./route-aggregation-guard";
export * from "./secure-routes";
export * from "./token-set-auth.service";
export * from "./token-set-auth-registry";
export * from "./token-set-callback.component";
export * from "./tokens";
