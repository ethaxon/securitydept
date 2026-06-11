// Frontend OIDC Mode — canonical subpath entry
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client/frontend-oidc-mode"
//
// This subpath provides two layers:
//
// 1. Browser runtime: the oauth4webapi-based OIDC client with full lifecycle
//    management (FrontendOidcModeClient — state signal, auto-refresh,
//    pending state, claims check, dispose)
//
// 2. Cross-boundary contracts: types aligned with Rust FrontendOidcMode*
//    (FrontendOidcModeConfigProjection — the canonical config interop
//    contract between backend and frontend. The canonical owner of frontend-oidc-mode
//    is config projection and future policy/service patterns. Real interaction
//    between frontend and backend/substrate relies mainly on bearer access tokens
//    and endpoint-specific inputs, not on mode-qualified token material DTOs.)
//
// Plus adapters bridging backend projections into browser runtime config
// and browser runtime results into the shared orchestration substrate.
//
// Stability: provisional (mode-aligned surface)

// --- Browser runtime ---

export {
	relayTokenSetPopupCallbackFromEnvironment,
	TokenSetPopupRelayErrorCode,
	TokenSetPopupRelayErrorSource,
} from "../orchestration/client/popup/relay";
export { FrontendOidcModeClient } from "./client/client";
export {
	FrontendOidcModeErrorCode,
	FrontendOidcModeErrorSource,
} from "./client/error-codes";
export {
	type FrontendOidcModeCheckClaimsOptions,
	type FrontendOidcModeClientDefaultOptions,
	type FrontendOidcModeClientOptions,
	type FrontendOidcModeExchangeCodeOptions,
} from "./client/types";
export {
	type FrontendOidcModeCallbackInput,
	type FrontendOidcModeCallbackSearchString,
	takeFrontendOidcCallbackInputFromRouter,
} from "./contracts/callback";

// --- Types: config, protocol, lifecycle ---

export {
	FrontendOidcModeOperationEventName,
	FrontendOidcModeTraceEventType,
	FrontendOidcModeTraceOperationName,
} from "./client/trace-events";
export {
	type FrontendOidcModeAuthorizeResult,
	type FrontendOidcModeCallbackResult,
	type FrontendOidcModeClientConfig,
	FrontendOidcModeContextSource,
	type FrontendOidcModePendingState,
	type FrontendOidcModeTokenResult,
	type ResolvedFrontendOidcModeClientConfig,
} from "./client/types";
export { FrontendOidcModeCallbackErrorCode } from "./errors/callback-error-codes";
export { describeFrontendOidcModeCallbackError } from "./errors/error-presentation";

// --- Cross-boundary contracts (aligned with Rust FrontendOidcMode*) ---

export {
	type FrontendOidcModeClaimsCheckFailureResult,
	type FrontendOidcModeClaimsCheckResult,
	type FrontendOidcModeClaimsCheckScript,
	type FrontendOidcModeClaimsCheckSuccessResult,
	type FrontendOidcModeConfigProjection,
	type FrontendOidcModeUserInfoResponse,
} from "./contracts/contracts";

// --- Adapters: projection → client config, result → orchestration ---

export { configProjectionToClientConfig } from "./contracts/contracts";
export {
	parseConfigProjection,
	tokenResultToAuthSnapshot,
	validateConfigProjection,
} from "./contracts/parsers";
export { FrontendOidcModeConfigProjectionSchema } from "./contracts/schemas";

// --- Config projection source contract (core — no web runtime assumptions) ---

export {
	type FrontendOidcModeConfigProjectionRealmOptions,
	type InjectConfigProjectionIntoRealmOptions,
	injectConfigProjectionIntoRealm,
} from "./config/config-projection-realm";
export {
	type FrontendOidcModeConfigProjectionInlineSource,
	type FrontendOidcModeConfigProjectionNetworkSource,
	type FrontendOidcModeConfigProjectionPersistedSource,
	type FrontendOidcModeConfigProjectionRealmSource,
	type FrontendOidcModeConfigProjectionSource,
	FrontendOidcModeConfigProjectionSourceKind,
	type ResolvedFrontendOidcModeConfigProjection,
	type ResolveFrontendOidcModeConfigProjectionOptions,
	resolveFrontendOidcModeConfigProjection,
} from "./config/config-source";
export {
	FrontendOidcModeConfigErrorCode,
	FrontendOidcModeConfigErrorSource,
} from "./config/error-codes";
