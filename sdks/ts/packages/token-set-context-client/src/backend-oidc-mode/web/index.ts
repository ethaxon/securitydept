// Backend OIDC Mode — Browser Adapter
//
// Canonical import path:
//   import { createBackendOidcModeBrowserClient } from "@securitydept/token-set-context-client/backend-oidc-mode/web"

export type {
	BackendOidcModeBootstrapResult,
	CreateBackendOidcModeBrowserClientOptions,
} from "./browser";
export {
	BackendOidcModeBootstrapSource,
	bootstrapBackendOidcModeClient,
	captureBackendOidcModeCallbackFragmentFromUrl,
	createBackendOidcModeBrowserClient,
	createBackendOidcModeCallbackFragmentStore,
	resetBackendOidcModeBrowserState,
	resolveBackendOidcModeAuthorizeUrl,
	resolveBackendOidcModeReturnUri,
} from "./browser";
