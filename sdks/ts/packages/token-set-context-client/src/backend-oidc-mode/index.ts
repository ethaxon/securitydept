// Backend OIDC Mode — canonical subpath entry
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client/backend-oidc-mode"
//
// This subpath is the unified, formal frontend-facing surface of the
// backend-oidc capability framework.
//
// Companion subpaths:
//   @securitydept/token-set-context-client/backend-oidc-mode/react — React adapter
//   @securitydept/token-set-context-client/orchestration           — shared token-lifecycle substrate
//
// Stability: canonical (unified surface v1)

// --- Capability axes ---

export {
	type BackendOidcModeCapabilities,
	BackendOidcModePreset,
	MetadataDelivery,
	PostAuthRedirectPolicy,
	RefreshMaterialProtection,
} from "./contracts/contracts";

// --- Contract types ---

export {
	type BackendOidcModeAuthorizeQuery,
	type BackendOidcModeCallbackReturns,
	type BackendOidcModeIntegrationRequirement,
	type BackendOidcModeMetadataRedemptionRequest,
	type BackendOidcModeMetadataRedemptionResponse,
	type BackendOidcModeRefreshPayload,
	type BackendOidcModeRefreshResult,
	type BackendOidcModeRefreshReturns,
	type BackendOidcModeUserInfoRequest,
	type BackendOidcModeUserInfoResponse,
} from "./contracts/contracts";

// --- Response body parsers ---

export {
	parseBackendOidcModeCallbackPayload,
	parseBackendOidcModeRefreshPayload,
} from "./contracts/parsers";

// --- Orchestration adapters ---

export {
	callbackReturnsToTokenSnapshot as callbackFragmentToTokenSnapshot,
	refreshReturnsToTokenDelta as refreshFragmentToTokenDelta,
} from "./contracts/parsers";

// --- Client ---

export {
	relayTokenSetPopupCallbackFromEnvironment,
	TokenSetPopupRelayErrorCode,
	TokenSetPopupRelayErrorSource,
} from "../orchestration/client/popup/relay";
export {
	type CreateDefaultBackendOidcModeCallbackInputResolverOptions,
	createDefaultBackendOidcModeCallbackInputResolver,
} from "./client/callback-input-resolver";
export { BackendOidcModeClient } from "./client/client";
export {
	type CreateBackendOidcModeClientFactoryOptions,
	createBackendOidcModeClientFactory,
} from "./client/client-factory";
export {
	BackendOidcModeErrorCode,
	BackendOidcModeErrorSource,
} from "./client/error-codes";
export {
	type BackendOidcModeClientDefaultOptions,
	type BackendOidcModeClientOptions,
	type BackendOidcModeFetchUserInfoOptions,
	type BackendOidcModeMetadataRedemptionOptions,
} from "./client/types";
export {
	type BackendOidcModeCallbackInput,
	type BackendOidcModeCallbackInputConditionOptions,
	BackendOidcModeCompatFragmentKind,
	type TakeBackendOidcCallbackInputFromRouterOptions,
	takeBackendOidcCallbackInputFromRouter,
} from "./contracts/callback";
export {
	type ProvideBackendOidcModeClientOptions,
	provideBackendOidcModeClient,
} from "./providers";
export {
	BACKEND_OIDC_MODE_CLIENT,
	BACKEND_OIDC_MODE_CLIENT_OPTIONS,
	type BackendOidcModeClientInjectionOptions,
} from "./tokens";

// --- Client trace vocabulary ---

export {
	BackendOidcModeComposedTraceEventType,
	BackendOidcModeOperationEventName,
	BackendOidcModeTraceEventType,
	BackendOidcModeTraceOperationName,
} from "./client/trace-events";

// --- Client types ---

export {
	type BackendOidcModeClientConfig,
	BackendOidcModeContextSource,
	type ResolvedBackendOidcModeClientConfig,
} from "./client/types";
