// Angular integration family for @securitydept/token-set-context-client
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client-angular"
//
// Multi-client-first Angular-native adapter surface:
//   - Keyed client registration via provideTokenSetClientRegistry()
//   - Multi-client lookup via TokenSetClientRegistryService
//   - Per-client mode client replay signals with RxJS bridge support
//   - Multi-client bearer interceptor (functional + class-based)
//   - provideTokenSetBearerInterceptor() for NgModule HTTP_INTERCEPTORS setup
//   - Requirement/provider-family → client key mapping
//   - secureRouteRoot() / secureRoute() — canonical Angular Router route-security
//     builders that delegate to the client-angular base helpers, normalize
//     token-set requirement metadata, and mount the token-set behaviour host.
//   - provideTokenSetRequirementPlannerHost() — provides the token-set
//     RequirementPlannerHost behaviour to the client-angular guard pipeline.
//   - createTokenSetCanActivate() / createTokenSetCanActivateChild() — token-set
//     named guard factories over the client-angular base guards.
//   - Signal/Observable bridge utilities live in @securitydept/client-angular
//
// Built by ng-packagr (APF / FESM2022). Decorators are fully supported.
//
// Stability: provisional (framework adapter)

export * from "./auth-coordination";
export * from "./bearer-interceptor";
export * from "./client-registry.service";
