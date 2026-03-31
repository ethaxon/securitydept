// Root entry — backward-compatible bridge
//
// This root entry re-exports all public surface for backward compatibility.
// It is NOT the canonical entry for any specific scenario pillar.
//
// Canonical entries:
//   @securitydept/token-set-context-client/token-set       — sealed refresh + metadata redemption (v1)
//   @securitydept/token-set-context-client/token-set/web   — browser adapter for token-set flow
//   @securitydept/token-set-context-client/token-set/react — React adapter for token-set flow
//   @securitydept/token-set-context-client/orchestration   — protocol-agnostic lifecycle substrate
//   @securitydept/token-set-context-client/oidc            — frontend pure OIDC client (oauth4webapi)
//
// New code should import from the explicit subpath that matches its scenario.
// This root entry will be maintained for backward compatibility but should not
// be extended with new exports or treated as the primary documentation target.

// --- Token-Set Sealed Flow (v1 backward-compatible re-export) ---
export type {
	AuthorizationHeaderProviderTrait,
	CreateTokenSetAuthorizedTransportOptions,
} from "./auth-transport";
export { createTokenSetAuthorizedTransport } from "./auth-transport";
export { TokenSetContextClient } from "./client";
export {
	mergeTokenDelta,
	parseDeltaFragment,
	parseTokenFragment,
} from "./fragment-parser";
// --- Orchestration (backward-compatible re-export) ---
export type {
	ApplyDeltaOptions,
	AuthDelta,
	AuthMaterialController,
	AuthMaterialState,
	AuthPrincipal,
	AuthSnapshot,
	AuthSource,
	AuthStatePersistence,
	BearerHeaderProvider,
	CreateAuthMaterialControllerOptions,
	CreateAuthorizedTransportOptions,
	TokenDelta,
	TokenSnapshot,
} from "./orchestration/index";
export {
	AuthSourceKind,
	bearerHeader,
	createAuthMaterialController,
	createAuthorizedTransport,
	createAuthStatePersistence,
} from "./orchestration/index";
export type {
	AuthenticatedPrincipal,
	AuthenticationSource,
	AuthStateDelta,
	AuthStateMetadataDelta,
	AuthStateMetadataSnapshot,
	AuthStateSnapshot,
	AuthTokenDelta,
	AuthTokenSnapshot,
	MetadataRedemptionRequest,
	MetadataRedemptionResponse,
	TokenRefreshPayload,
	TokenSetAuthorizeQuery,
	TokenSetContextClientConfig,
} from "./types";
export {
	AuthenticationSourceKind,
	TokenSetContextSource,
	TokenSetStateRestoreSourceKind,
} from "./types";
