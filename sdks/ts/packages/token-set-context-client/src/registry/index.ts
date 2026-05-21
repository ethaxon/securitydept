// Shared token-set auth registry — canonical subpath entry
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client/registry"
//
// This subpath exports a framework-neutral registry core that both the
// Angular adapter (@securitydept/token-set-context-client-angular) and the
// React adapter (@securitydept/token-set-context-client-react) build on.
//
// The registry is responsible for multi-client:
//   - Registration with sync-or-async clientFactory
//   - Readiness tracking (ClientReadinessState state machine)
//   - Priority-aware materialization (primary eager / lazy idle warmup)
//   - preload / whenReady / idleWarmup / unregister / resetMaterialization
//     lifecycle verbs
//   - Multi-axis discrimination (urlPatterns / callbackPath /
//     requirementKind / providerFamily) with AND / OR filter queries
//
// Stability: provisional (shared registry surface)

// Re-export ClientReadinessState (both the const-enum value and its type).
export { ClientReadinessState } from "../frontend-oidc-mode/config/config-source";
export type {
	ClientFilter,
	ClientKeySelector,
	ClientMeta,
	ClientQueryOptions,
	CreateTokenSetAuthRegistryOptions,
	CreateTokenSetOidcAuthRegistryOptions,
	EnsureRegistryAuthForResourceOptions,
	OidcCallbackClient,
	OidcModeClient,
	OidcRedirectLoginClient,
	OidcRedirectLoginOptions,
	ReadTokenSetCallbackResumeErrorDetailsOptions,
	TokenSetAuthRegistryEntryState,
	TokenSetAuthRegistryLifecycleErrorCode as TokenSetAuthRegistryLifecycleErrorCodeType,
	TokenSetAuthRegistryState,
	TokenSetAuthServiceRestoreStatus as TokenSetAuthServiceRestoreStatusType,
	TokenSetAuthServiceState,
	TokenSetCallbackErrorDetails,
	TokenSetCallbackErrorPresentationContext,
	TokenSetCallbackErrorPresenter,
	TokenSetCallbackResumeControllerOptions,
	TokenSetCallbackResumeErrorDetails,
	TokenSetCallbackResumeOptions,
	TokenSetCallbackResumeRegistry,
	TokenSetCallbackResumeResult,
	TokenSetCallbackResumeState,
	TokenSetCallbackResumeStatus as TokenSetCallbackResumeStatusType,
	TokenSetClientEntry,
} from "./contracts/types";
export {
	ClientInitializationPriority,
	TokenSetAuthRegistryLifecycleError,
	TokenSetAuthRegistryLifecycleErrorCode,
	TokenSetAuthServiceRestoreStatus,
} from "./contracts/types";
export {
	TokenSetCallbackResumeController,
	TokenSetCallbackResumeStatus,
} from "./controller/callback-resume-controller";
export {
	createTokenSetAuthRegistry,
	createTokenSetOidcAuthRegistry,
	TokenSetAuthRegistry,
} from "./core/client-registry";
export { isOidcCallback } from "./core/oidc-callback-url";
export { TokenSetAuthService } from "./core/service";
export {
	describeTokenSetCallbackError,
	readTokenSetCallbackResumeErrorDetails,
} from "./presentation/error-presentation";
