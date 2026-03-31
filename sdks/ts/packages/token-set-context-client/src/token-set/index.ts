// Token-Set Sealed Flow — canonical subpath entry
//
// This is the explicit entry point for the token-set sealed refresh +
// metadata redemption flow (the third pillar of token-set-context-client).
//
// Previously, these exports lived at the package root. The root entry now
// serves as a backward-compatible bridge only; new code should import from
// this subpath directly:
//
//   import { TokenSetContextClient } from "@securitydept/token-set-context-client/token-set";
//
// Stability: stable (v1, browser-owned token-set contract)

export type {
	AuthorizationHeaderProviderTrait,
	CreateTokenSetAuthorizedTransportOptions,
} from "../auth-transport";
export { createTokenSetAuthorizedTransport } from "../auth-transport";
export { TokenSetContextClient } from "../client";
export {
	mergeTokenDelta,
	parseDeltaFragment,
	parseTokenFragment,
} from "../fragment-parser";
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
} from "../types";
export {
	AuthenticationSourceKind,
	TokenSetContextSource,
	TokenSetStateRestoreSourceKind,
} from "../types";
