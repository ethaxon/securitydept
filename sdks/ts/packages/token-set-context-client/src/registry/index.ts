// Client registry — canonical subpath entry.
//
// The registry is a framework-neutral lifecycle container for keyed clients.
// It owns initialization scheduling, disposal, lookup metadata, state signals,
// and lifecycle events. It does not own token-set auth semantics.

export type {
	ClientFilter,
	ClientQueryOptions,
	ClientSelector,
} from "./contracts/query";
export {
	matchesCallbackPath,
	matchesQuery,
	matchesUrl,
} from "./contracts/query";
export type {
	ClientDisposedRecordView,
	ClientFailedRecordView,
	ClientInitializingRecordView,
	ClientMeta,
	ClientReadyRecordView,
	ClientRecordView,
	ClientRecordViewBase,
	ClientRegisteredRecordView,
	ClientRegistryEntry,
	ClientRegistryEvent,
	ClientRegistryEventType,
	CreateClientRegistryOptions,
} from "./contracts/types";
export {
	ClientInitializationMode,
	ClientRegistryEntryStatus,
} from "./contracts/types";
export type {
	BackendOidcModeCallbackHandle,
	BackendOidcModeCallbackInput,
	BackendOidcModeCallbackOptions,
	BackendOidcModeCallbackResult,
	BackendOidcModeCallbackState,
} from "./controller/backend-mode-callback-controller";
export { BackendOidcModeCallbackController } from "./controller/backend-mode-callback-controller";
export type {
	FrontendOidcModeCallbackHandle,
	FrontendOidcModeCallbackInput,
	FrontendOidcModeCallbackOptions,
	FrontendOidcModeCallbackResult,
	FrontendOidcModeCallbackState,
	ReadFrontendOidcModeCallbackErrorPresentationOptions,
} from "./controller/frontend-mode-callback-controller";
export {
	FrontendOidcModeCallbackController,
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
