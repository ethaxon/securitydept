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
	captureBackendOidcModeCallbackFragmentFromUrl,
	createBackendOidcModeBrowserClient,
	createBackendOidcModeCallbackFragmentStore,
	loginWithBackendOidcPopup,
	loginWithBackendOidcRedirect,
	relayBackendOidcPopupCallback,
	resetBackendOidcModeBrowserState,
	resolveBackendOidcModeAuthorizeUrl,
	resolveBackendOidcModeCallbackFragmentKey,
	resolveBackendOidcModeReturnUri,
} from "./browser";
