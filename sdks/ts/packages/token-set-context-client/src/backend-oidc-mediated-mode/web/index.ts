// Backend OIDC Mediated Mode — Browser Adapter
//
// Canonical import path:
//   import { createBackendOidcMediatedModeBrowserClient } from "@securitydept/token-set-context-client/backend-oidc-mediated-mode/web"
//
// Stability: provisional

export type {
	BackendOidcMediatedModeBootstrapResult,
	CreateBackendOidcMediatedModeBrowserClientOptions,
} from "./browser";
export {
	BackendOidcMediatedModeBootstrapSource,
	bootstrapBackendOidcMediatedModeClient,
	captureBackendOidcMediatedModeCallbackFragmentFromUrl,
	createBackendOidcMediatedModeBrowserClient,
	createBackendOidcMediatedModeCallbackFragmentStore,
	resetBackendOidcMediatedModeBrowserState,
	resolveBackendOidcMediatedModeAuthorizeUrl,
	resolveBackendOidcMediatedModeReturnUri,
} from "./browser";
