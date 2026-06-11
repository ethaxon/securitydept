// Token-set React adapter.
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client-react"
//
// Provides Securitydept DI integration for the core token-set client registry
// plus headless React callback Resource hooks.

export {
	BackendOidcModeClient,
	type BackendOidcModeClientConfig,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
export {
	type BaseOidcModeClient,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
export {
	type TokenSetClientFilter,
	TokenSetClientInitializationMode,
	type TokenSetClientMeta,
	type TokenSetClientQueryOptions,
	type TokenSetClientReadyRecordView,
	type TokenSetClientRecordView,
	type TokenSetClientRegistryEntry,
	type TokenSetClientSelector,
} from "@securitydept/token-set-context-client/registry";
export {
	type ProvideTokenSetClientRegistryOptions,
	provideTokenSetClientRegistry,
	TOKEN_SET_CLIENT_REGISTRY,
	TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
	TokenSetClientRegistryService,
} from "./client-registry-service";
export * from "./hooks";
