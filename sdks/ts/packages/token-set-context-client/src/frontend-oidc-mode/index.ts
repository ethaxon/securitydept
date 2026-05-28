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
export type { FrontendOidcModeClientDefaultOptions } from "./client/types";

// --- Types: config, protocol, lifecycle ---

export {
	FrontendOidcModeOperationEventName,
	FrontendOidcModeTraceEventType,
	FrontendOidcModeTraceOperationName,
} from "./client/trace-events";
export type {
	FrontendOidcModeAuthorizeResult,
	FrontendOidcModeCallbackResult,
	FrontendOidcModeClientConfig,
	FrontendOidcModePendingState,
	FrontendOidcModeTokenResult,
	ResolvedFrontendOidcModeClientConfig,
} from "./client/types";
export { FrontendOidcModeContextSource } from "./client/types";
export { FrontendOidcModeCallbackErrorCode } from "./errors/callback-error-codes";
export { describeFrontendOidcModeCallbackError } from "./errors/error-presentation";

// --- Cross-boundary contracts (aligned with Rust FrontendOidcMode*) ---

export type {
	FrontendOidcModeClaimsCheckFailureResult,
	FrontendOidcModeClaimsCheckResult,
	FrontendOidcModeClaimsCheckScript,
	FrontendOidcModeClaimsCheckSuccessResult,
	FrontendOidcModeConfigProjection,
	FrontendOidcModeUserInfoResponse,
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

export type {
	ConfigProjectionSource,
	ConfigProjectionSourceBootstrapScript,
	ConfigProjectionSourceInline,
	ConfigProjectionSourceNetwork,
	ConfigProjectionSourcePersisted,
	PersistedConfigEnvelope,
	ResolvedConfigProjection,
} from "./config/config-source";

export {
	ConfigProjectionSourceKind,
	resolveConfigProjection,
} from "./config/config-source";

// --- Config projection web/browser runtime helpers ---

export type {
	CreateFrontendOidcModeBrowserClientOptions,
	CreateFrontendOidcModeWebClientEnvironmentOptions,
	FrontendOidcModeBrowserClientMaterialization,
	FrontendOidcModeWebClientEnvironment,
	IdleRevalidationOptions,
} from "./config/config-source-web";

export {
	bootstrapScriptSource,
	createFrontendOidcModeBrowserClient,
	createFrontendOidcModeWebClientEnvironment,
	networkConfigSource,
	persistConfigProjection,
	persistedConfigSource,
	resolveFrontendOidcModeBrowserStorageKey,
	resolveFrontendOidcModePersistentStateKey,
	scheduleIdleRevalidation,
} from "./config/config-source-web";
