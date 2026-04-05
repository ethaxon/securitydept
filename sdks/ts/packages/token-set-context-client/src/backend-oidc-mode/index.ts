// Backend OIDC Mode — canonical subpath entry
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client/backend-oidc-mode"
//
// This subpath is the unified, formal frontend-facing surface of the
// backend-oidc capability framework.
//
// Companion subpaths:
//   @securitydept/token-set-context-client/backend-oidc-mode/web   — browser adapter
//   @securitydept/token-set-context-client/backend-oidc-mode/react — React adapter
//   @securitydept/token-set-context-client/orchestration           — shared token-lifecycle substrate
//
// Stability: canonical (unified surface v1)

// --- Capability axes ---

export type { BackendOidcModeCapabilities } from "./contracts";
export {
	BackendOidcModePreset,
	MetadataDelivery,
	PostAuthRedirectPolicy,
	RefreshMaterialProtection,
} from "./contracts";

// --- Contract types ---

export type {
	BackendOidcModeAuthorizeQuery,
	BackendOidcModeCallbackFragment,
	BackendOidcModeConfigProjection,
	BackendOidcModeIntegrationRequirement,
	BackendOidcModeMetadataRedemptionRequest,
	BackendOidcModeMetadataRedemptionResponse,
	BackendOidcModeRefreshFragment,
	BackendOidcModeRefreshPayload,
	BackendOidcModeRefreshResult,
	BackendOidcModeUserInfoRequest,
	BackendOidcModeUserInfoResponse,
} from "./contracts";

// --- Fragment parsers ---

export {
	parseBackendOidcModeCallbackFragment,
	parseBackendOidcModeRefreshFragment,
} from "./parsers";

// --- Orchestration adapters ---

export {
	callbackFragmentToTokenSnapshot,
	refreshFragmentToTokenDelta,
} from "./parsers";

// --- Client ---

export { BackendOidcModeClient } from "./client";

// --- Client types ---

export type {
	AuthenticatedPrincipal,
	AuthenticationSource,
	AuthenticationSourceKind as AuthenticationSourceKindType,
	AuthStateDelta,
	AuthStateSnapshot,
	BackendOidcModeClientConfig,
} from "./types";
export {
	AuthenticationSourceKind,
	BackendOidcModeContextSource,
	BackendOidcModeStateRestoreSourceKind,
} from "./types";

// --- Authorized transport ---

export type { CreateBackendOidcModeAuthorizedTransportOptions } from "./auth-transport";
export { createBackendOidcModeAuthorizedTransport } from "./auth-transport";
