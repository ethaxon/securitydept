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
} from "../orchestration/client/popup/relay";
export { FrontendOidcModeClient } from "./client/client";
export { type FrontendOidcModeClientDefaultOptions } from "./client/types";

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
	resolveConfigProjection,
	type TokenSetConfigProjectionSource,
	type TokenSetConfigProjectionSourceBootstrapScript,
	type TokenSetConfigProjectionSourceInline,
	TokenSetConfigProjectionSourceKind,
	type TokenSetConfigProjectionSourceNetwork,
	type TokenSetConfigProjectionSourcePersisted,
	type TokenSetPersistedConfigEnvelope,
	type TokenSetResolvedConfigProjection,
} from "./config/config-source";

// --- Config projection web/browser runtime helpers ---

export {
	bootstrapScriptSource,
	type CreateFrontendOidcModeBrowserClientOptions,
	type CreateFrontendOidcModeWebClientEnvironmentOptions,
	createFrontendOidcModeBrowserClient,
	createFrontendOidcModeWebClientEnvironment,
	type FrontendOidcModeBrowserClientMaterialization,
	type FrontendOidcModeWebClientEnvironment,
	networkConfigSource,
	persistConfigProjection,
	persistedConfigSource,
	resolveFrontendOidcModeBrowserStorageKey,
	resolveFrontendOidcModePersistentStateKey,
	scheduleIdleRevalidation,
	type TokenSetIdleRevalidationOptions,
} from "./config/config-source-web";
