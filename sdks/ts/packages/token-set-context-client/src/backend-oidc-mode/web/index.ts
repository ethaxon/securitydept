// Backend OIDC Mode — Browser Adapter
//
// Canonical import path:
//   import { createBackendOidcModeBrowserClient } from "@securitydept/token-set-context-client/backend-oidc-mode/web"

export type {
	BackendOidcModeBootstrapResult,
	BootstrapBackendOidcModeClientOptions,
	CaptureBackendOidcModeCallbackFragmentFromUrlOptions,
	CreateBackendOidcModeBrowserClientOptions,
	CreateBackendOidcModeCallbackFragmentStoreOptions,
	LoginWithBackendOidcPopupOptions,
	LoginWithBackendOidcRedirectOptions,
	ResetBackendOidcModeBrowserStateOptions,
} from "./browser";
export {
	BackendOidcModeBootstrapSource,
	bootstrapBackendOidcModeClient,
	buildAuthorizeUrlReturningToCurrent,
	captureBackendOidcModeCallbackFragmentFromUrl,
	createBackendOidcModeBrowserClient,
	createBackendOidcModeCallbackFragmentStore,
	currentLocationAsPostAuthRedirectUri,
	loginWithBackendOidcPopup,
	loginWithBackendOidcRedirect,
	relayBackendOidcPopupCallback,
	resetBackendOidcModeBrowserState,
	resolveBackendOidcModeCallbackFragmentKey,
} from "./browser";
