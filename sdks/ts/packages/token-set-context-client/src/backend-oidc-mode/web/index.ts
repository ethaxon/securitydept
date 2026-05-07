// Backend OIDC Mode — Browser Adapter
//
// Canonical import path:
//   import { createBackendOidcModeWebClient } from "@securitydept/token-set-context-client/backend-oidc-mode/web"

export type {
	BackendOidcModeBootstrapResult,
	BackendOidcModeCallbackFragmentStoreCapability,
	BackendOidcModePageCallbackCapability,
	BackendOidcModePageClientEnvironment,
	BackendOidcModePageLocationCapability,
	BackendOidcModePopupLoginCapability,
	BackendOidcModeWebClientEnvironment,
	BootstrapBackendOidcModePageClientOptions,
	BuildAuthorizeUrlReturningToCurrentPageOptions,
	CaptureBackendOidcModeCallbackFragmentOptions,
	CaptureBackendOidcModePageCallbackFragmentOptions,
	CreateBackendOidcModeCallbackFragmentStoreOptions,
	CreateBackendOidcModeWebClientEnvironmentOptions,
	CreateBackendOidcModeWebClientOptions,
	CurrentPageLocationAsPostAuthRedirectUriOptions,
	LoginWithBackendOidcPopupOptions,
	LoginWithBackendOidcRedirectOptions,
	RelayBackendOidcPopupCallbackOptions,
	ResetBackendOidcModeBrowserStateOptions,
} from "./browser";
export {
	BackendOidcModeBootstrapSource,
	bootstrapBackendOidcModeFromCallbackStore,
	bootstrapBackendOidcModePageClient,
	buildAuthorizeUrlReturningToCurrentPage,
	captureBackendOidcModeCallbackFragment,
	captureBackendOidcModePageCallbackFragment,
	createBackendOidcModeCallbackFragmentStore,
	createBackendOidcModeWebClient,
	createBackendOidcModeWebClientEnvironment,
	currentPageLocationAsPostAuthRedirectUri,
	loginWithBackendOidcPopup,
	loginWithBackendOidcRedirect,
	relayBackendOidcPopupCallback,
	resetBackendOidcModeBrowserState,
	resolveBackendOidcModeCallbackFragmentKey,
	restoreBackendOidcModeClient,
} from "./browser";
