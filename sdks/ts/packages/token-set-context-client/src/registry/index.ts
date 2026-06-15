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
	defaultTokenSetBackendCallbackClientQuery,
	defaultTokenSetFrontendCallbackClientQuery,
	type SelectTokenSetBackendCallbackClientFromRegistryOptions,
	type SelectTokenSetFrontendCallbackClientFromRegistryOptions,
	selectTokenSetBackendCallbackClientFromRegistry,
	selectTokenSetFrontendCallbackClientFromRegistry,
	type TokenSetBackendCallbackClientFromRegistrySelectionSignal,
	type TokenSetCallbackClientNotApplicableSelection,
	type TokenSetCallbackClientNotFoundMapper,
	type TokenSetCallbackClientQuery,
	type TokenSetCallbackClientQueryOptions,
	type TokenSetCallbackClientSelectedSelection,
	type TokenSetCallbackClientSelection,
	TokenSetCallbackClientSelectionKind,
	type TokenSetCallbackClientSelectionSignal,
	type TokenSetCallbackClientSelectionSnapshot,
	type TokenSetFrontendCallbackClientFromRegistrySelectionSignal,
	TokenSetRegistryCallbackErrorCode,
	TokenSetRegistryCallbackErrorSource,
} from "./callback";
export {
	matchesTokenSetClientCallbackUrl,
	matchesTokenSetClientQuery,
	matchesTokenSetClientUrl,
	type TokenSetClientFilter,
	type TokenSetClientQueryOptions,
	type TokenSetClientSelector,
} from "./contracts/query";
export {
	TOKEN_SET_CLIENT_REGISTRY,
	TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
} from "./contracts/tokens";
export {
	type TokenSetClientCallbackUrl,
	type TokenSetClientCallbackUrls,
	type TokenSetClientDisposedRecordView,
	type TokenSetClientFactory,
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
	type TokenSetClientRegistryEntryStatus,
	type TokenSetClientRegistryEvent,
	type TokenSetClientRegistryEventType,
	type TokenSetClientRegistryFromEnvironmentConfigOptions,
	type TokenSetClientResourceOptions,
	TokenSetRequirementKind,
} from "./contracts/types";
export { TokenSetClientRegistry } from "./core/client-registry";
export {
	TokenSetClientRegistryError,
	TokenSetClientRegistryErrorCode,
	TokenSetClientRegistryErrorSource,
} from "./core/error";
export {
	type ProvideTokenSetClientRegistryOptions,
	provideTokenSetClientRegistry,
} from "./providers";
