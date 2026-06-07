// Client registry — canonical subpath entry.
//
// The registry is a framework-neutral lifecycle container for keyed clients.
// It owns initialization scheduling, disposal, lookup metadata, state signals,
// and lifecycle events. It does not own token-set auth semantics.

export {
	type TokenSetCheckClientAuthenticated,
	TokenSetClientRegistryAuthRequirement,
	type TokenSetClientRegistryAuthRequirementContext,
	type TokenSetClientRegistryAuthRequirementInput,
	type TokenSetClientRegistryClientGenerator,
	type TokenSetClientRegistryOidcModeClient,
	TokenSetClientRegistryPlannerHost,
	TokenSetClientRegistryRequirementBehaviour,
	type TokenSetClientRegistryRequirementBehaviourOptions,
	type TokenSetClientRegistryRequirementBehaviourShape,
	type TokenSetClientRegistryRouteRequirementBehaviourShape,
	type TokenSetOnClientUnauthenticated,
	type TokenSetSelectClientCandidate,
} from "./auth-coordination";
export {
	matchesTokenSetClientCallbackPath,
	matchesTokenSetClientQuery,
	matchesTokenSetClientUrl,
	type TokenSetClientFilter,
	type TokenSetClientQueryOptions,
	type TokenSetClientSelector,
} from "./contracts/query";
export {
	type CreateTokenSetClientRegistryOptions,
	type TokenSetClientDisposedRecordView,
	type TokenSetClientFactoryOptions,
	type TokenSetClientFailedRecordView,
	TokenSetClientInitializationMode,
	type TokenSetClientInitializingRecordView,
	type TokenSetClientMeta,
	type TokenSetClientReadyRecordView,
	type TokenSetClientRecordView,
	type TokenSetClientRecordViewBase,
	type TokenSetClientRegisteredRecordView,
	type TokenSetClientRegistryEntry,
	TokenSetClientRegistryEntryStatus,
	type TokenSetClientRegistryEvent,
	type TokenSetClientRegistryEventType,
	type TokenSetClientResourceOptions,
	TokenSetRequirementKind,
} from "./contracts/types";
export {
	BackendOidcModeCallbackController,
	type BackendOidcModeCallbackHandle,
	type BackendOidcModeCallbackInput,
	type BackendOidcModeCallbackOptions,
	type BackendOidcModeCallbackResult,
	type BackendOidcModeCallbackState,
} from "./controller/backend-mode-callback-controller";
export {
	FrontendOidcModeCallbackController,
	type FrontendOidcModeCallbackHandle,
	type FrontendOidcModeCallbackInput,
	type FrontendOidcModeCallbackOptions,
	type FrontendOidcModeCallbackResult,
	type FrontendOidcModeCallbackState,
} from "./controller/frontend-mode-callback-controller";
export {
	createTokenSetClientRegistry,
	TokenSetClientRegistry,
} from "./core/client-registry";
export {
	TokenSetClientRegistryError,
	TokenSetClientRegistryErrorCode,
	TokenSetClientRegistryErrorSource,
} from "./core/error";
