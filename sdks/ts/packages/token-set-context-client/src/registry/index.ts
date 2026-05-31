// Client registry — canonical subpath entry.
//
// The registry is a framework-neutral lifecycle container for keyed clients.
// It owns initialization scheduling, disposal, lookup metadata, state signals,
// and lifecycle events. It does not own token-set auth semantics.

export {
	type CheckClientAuthenticated,
	ClientRegistryAuthRequirement,
	type ClientRegistryAuthRequirementContext,
	type ClientRegistryAuthRequirementInput,
	type ClientRegistryClientGenerator,
	type ClientRegistryOidcModeClient,
	ClientRegistryPlannerHost,
	ClientRegistryRequirementBehaviour,
	type ClientRegistryRequirementBehaviourOptions,
	type OnClientUnauthenticated,
	type SelectClientCandidate,
} from "./auth-coordination";
export {
	type ClientFilter,
	type ClientQueryOptions,
	type ClientSelector,
	matchesCallbackPath,
	matchesQuery,
	matchesUrl,
} from "./contracts/query";
export {
	type ClientDisposedRecordView,
	type ClientFailedRecordView,
	ClientInitializationMode,
	type ClientInitializingRecordView,
	type ClientMeta,
	type ClientReadyRecordView,
	type ClientRecordView,
	type ClientRecordViewBase,
	type ClientRegisteredRecordView,
	type ClientRegistryEntry,
	ClientRegistryEntryStatus,
	type ClientRegistryEvent,
	type ClientRegistryEventType,
	type ClientSignalOptions,
	type CreateClientRegistryOptions,
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
	type ReadFrontendOidcModeCallbackErrorPresentationOptions,
	readFrontendOidcModeCallbackErrorPresentation,
} from "./controller/frontend-mode-callback-controller";
export { ClientRecord } from "./core/client-record";
export {
	ClientRegistry,
	createClientRegistry,
} from "./core/client-registry";
export {
	ClientRegistryError,
	ClientRegistryErrorCode,
} from "./core/error";
