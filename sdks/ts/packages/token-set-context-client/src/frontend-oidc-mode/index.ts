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

export type {
	FrontendOidcModeLoginWithRedirectOptions,
	FrontendOidcModePageLocationCapability,
	FrontendOidcModePopupLoginOptions,
	RelayFrontendOidcPopupCallbackOptions,
} from "./runtime/client";
export {
	createFrontendOidcModeClient,
	FrontendOidcModeClient,
	relayFrontendOidcPopupCallback,
} from "./runtime/client";

// --- Types: config, protocol, lifecycle ---

export { FrontendOidcModeCallbackErrorCode } from "./errors/callback-error-codes";
export { describeFrontendOidcModeCallbackError } from "./errors/error-presentation";
export { FrontendOidcModeTraceEventType } from "./runtime/trace-events";
export type {
	FrontendOidcModeAuthorizeParams,
	FrontendOidcModeAuthorizeResult,
	FrontendOidcModeCallbackResult,
	FrontendOidcModeClientConfig,
	FrontendOidcModePendingState,
	FrontendOidcModeTokenResult,
} from "./runtime/types";

// --- Types: orchestration re-exports (mode-qualified aliases) ---

export type {
	AuthenticatedPrincipal as FrontendOidcModeAuthenticatedPrincipal,
	AuthenticationSource as FrontendOidcModeAuthenticationSource,
	AuthStateDelta as FrontendOidcModeAuthStateDelta,
	AuthStateMetadataSnapshot as FrontendOidcModeAuthStateMetadataSnapshot,
	AuthStateSnapshot as FrontendOidcModeAuthStateSnapshot,
	AuthTokenDelta as FrontendOidcModeAuthTokenDelta,
	AuthTokenSnapshot as FrontendOidcModeAuthTokenSnapshot,
} from "./runtime/types";

export {
	FrontendOidcModeContextSource,
	FrontendOidcModeStateRestoreSourceKind,
} from "./runtime/types";

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

export {
	configProjectionToClientConfig,
	FrontendOidcModeConfigProjectionSchema,
	parseConfigProjection,
	tokenResultToAuthSnapshot,
	validateConfigProjection,
} from "./contracts/contracts";

// --- Authorized transport ---

export type { CreateFrontendOidcModeAuthorizedTransportOptions } from "./transport/auth-transport";
export { createFrontendOidcModeAuthorizedTransport } from "./transport/auth-transport";

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
	ClientReadinessState,
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
