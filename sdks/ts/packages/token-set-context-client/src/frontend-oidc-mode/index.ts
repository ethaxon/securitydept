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

export { createFrontendOidcModeClient, FrontendOidcModeClient } from "./client";

// --- Types: config, protocol, lifecycle ---

export type {
	FrontendOidcModeAuthorizeParams,
	FrontendOidcModeAuthorizeResult,
	FrontendOidcModeCallbackResult,
	FrontendOidcModeClientConfig,
	FrontendOidcModePendingState,
	FrontendOidcModeTokenResult,
} from "./types";

// --- Types: orchestration re-exports (mode-qualified aliases) ---

export type {
	AuthenticatedPrincipal as FrontendOidcModeAuthenticatedPrincipal,
	AuthenticationSource as FrontendOidcModeAuthenticationSource,
	AuthStateDelta as FrontendOidcModeAuthStateDelta,
	AuthStateMetadataSnapshot as FrontendOidcModeAuthStateMetadataSnapshot,
	AuthStateSnapshot as FrontendOidcModeAuthStateSnapshot,
	AuthTokenDelta as FrontendOidcModeAuthTokenDelta,
	AuthTokenSnapshot as FrontendOidcModeAuthTokenSnapshot,
} from "./types";

export {
	FrontendOidcModeContextSource,
	FrontendOidcModeStateRestoreSourceKind,
} from "./types";

// --- Cross-boundary contracts (aligned with Rust FrontendOidcMode*) ---

export type {
	FrontendOidcModeClaimsCheckFailureResult,
	FrontendOidcModeClaimsCheckResult,
	FrontendOidcModeClaimsCheckScript,
	FrontendOidcModeClaimsCheckSuccessResult,
	FrontendOidcModeConfigProjection,
	FrontendOidcModeUserInfoResponse,
} from "./contracts";

// --- Adapters: projection → client config, result → orchestration ---

export {
	configProjectionToClientConfig,
	tokenResultToAuthSnapshot,
} from "./contracts";

// --- Authorized transport ---

export type { CreateFrontendOidcModeAuthorizedTransportOptions } from "./auth-transport";
export { createFrontendOidcModeAuthorizedTransport } from "./auth-transport";
