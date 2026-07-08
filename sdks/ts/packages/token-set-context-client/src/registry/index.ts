// Client registry — canonical subpath entry.
//
// The registry is a framework-neutral lifecycle container for keyed clients.
// It owns initialization scheduling, disposal, lookup metadata, state signals,
// lifecycle events, and multiplexing of its clients' auth events and errors.

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
	type TokenSetBackendCallbackClient,
	type TokenSetBackendCallbackClientFromRegistrySelectionSignal,
	type TokenSetCallbackClientGuard,
	type TokenSetCallbackClientNotApplicableSelection,
	type TokenSetCallbackClientNotFoundMapper,
	type TokenSetCallbackClientQuery,
	type TokenSetCallbackClientQueryOptions,
	type TokenSetCallbackClientSelectedSelection,
	type TokenSetCallbackClientSelection,
	TokenSetCallbackClientSelectionKind,
	type TokenSetCallbackClientSelectionSignal,
	type TokenSetCallbackClientSelectionSnapshot,
	type TokenSetFrontendCallbackClient,
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
	type TokenSetClientRegistryClient,
	type TokenSetClientRegistryEntry,
	type TokenSetClientRegistryEntryStatus,
	type TokenSetClientRegistryEvent,
	TokenSetClientRegistryEventType,
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
