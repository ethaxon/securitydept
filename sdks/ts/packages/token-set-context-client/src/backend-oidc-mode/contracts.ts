// Backend OIDC Mode — unified contract vocabulary
//
// These types define the canonical frontend-facing contract for consuming a
// backend-oidc deployment, regardless of the active preset (pure / mediated).

// ---------------------------------------------------------------------------
// Capability axes (aligned with Rust BackendOidcModeCapabilities)
// ---------------------------------------------------------------------------

export const RefreshMaterialProtection = {
	Passthrough: "passthrough",
	Sealed: "sealed",
} as const;

export type RefreshMaterialProtection =
	(typeof RefreshMaterialProtection)[keyof typeof RefreshMaterialProtection];

export const MetadataDelivery = {
	None: "none",
	Redemption: "redemption",
} as const;

export type MetadataDelivery =
	(typeof MetadataDelivery)[keyof typeof MetadataDelivery];

export const PostAuthRedirectPolicy = {
	CallerValidated: "caller_validated",
	Resolved: "resolved",
} as const;

export type PostAuthRedirectPolicy =
	(typeof PostAuthRedirectPolicy)[keyof typeof PostAuthRedirectPolicy];

export interface BackendOidcModeCapabilities {
	refreshMaterialProtection: RefreshMaterialProtection;
	metadataDelivery: MetadataDelivery;
	postAuthRedirectPolicy: PostAuthRedirectPolicy;
}

export const BackendOidcModePreset = {
	Pure: "pure",
	Mediated: "mediated",
} as const;

export type BackendOidcModePreset =
	(typeof BackendOidcModePreset)[keyof typeof BackendOidcModePreset];

// ---------------------------------------------------------------------------
// Authorize query
// ---------------------------------------------------------------------------

export interface BackendOidcModeAuthorizeQuery {
	postAuthRedirectUri?: string;
}

// ---------------------------------------------------------------------------
// Refresh payload
// ---------------------------------------------------------------------------

/**
 * Unified refresh payload for the backend-oidc refresh endpoint.
 *
 * - `refreshToken`: either a plain refresh token (passthrough) or a sealed
 *   blob (sealed).
 * - Optional fields consumed by specific capability axes.
 */
export interface BackendOidcModeRefreshPayload {
	refreshToken: string;
	postAuthRedirectUri?: string;
	idToken?: string;
	currentMetadataSnapshot?: import("../orchestration/types").AuthMetadataSnapshot;
}

// ---------------------------------------------------------------------------
// Callback fragment
// ---------------------------------------------------------------------------

/**
 * Browser-facing callback redirect fragment.
 *
 * `idToken` is always present after a callback (OIDC requires id_token in
 * authorization code flow responses). `metadataRedemptionId` is present only
 * when `metadataDelivery = redemption`.
 */
export interface BackendOidcModeCallbackFragment {
	accessToken: string;
	idToken: string;
	refreshToken?: string;
	expiresAt?: string;
	metadataRedemptionId?: string;
}

// ---------------------------------------------------------------------------
// Refresh fragment
// ---------------------------------------------------------------------------

/**
 * Browser-facing refresh redirect fragment.
 *
 * `idToken` and `metadataRedemptionId` are optional.
 */
export interface BackendOidcModeRefreshFragment {
	accessToken: string;
	idToken?: string;
	refreshToken?: string;
	expiresAt?: string;
	metadataRedemptionId?: string;
}

// ---------------------------------------------------------------------------
// Metadata redemption contract
// ---------------------------------------------------------------------------

export interface BackendOidcModeMetadataRedemptionRequest {
	metadataRedemptionId: string;
}

export interface BackendOidcModeMetadataRedemptionResponse {
	metadata:
		| import("../orchestration/types").AuthMetadataSnapshot
		| import("../orchestration/types").AuthMetadataDelta;
}

// ---------------------------------------------------------------------------
// User info exchange contract
// ---------------------------------------------------------------------------

export interface BackendOidcModeUserInfoRequest {
	idToken: string;
}

export interface BackendOidcModeUserInfoResponse {
	subject: string;
	displayName: string;
	picture?: string;
	issuer?: string;
	claims?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Refresh result (typed result from refresh flow)
// ---------------------------------------------------------------------------

export interface BackendOidcModeRefreshResult {
	accessToken: string;
	idToken?: string;
	refreshToken?: string;
	accessTokenExpiresAt?: string;
}

// ---------------------------------------------------------------------------
// Config projection
// ---------------------------------------------------------------------------

/**
 * Backend-to-frontend OIDC configuration projection.
 */
export interface BackendOidcModeConfigProjection {
	wellKnownUrl: string;
	clientId: string;
	scopes?: string[];
	redirectUrl?: string;
}

// ---------------------------------------------------------------------------
// Integration requirement
// ---------------------------------------------------------------------------

export interface BackendOidcModeIntegrationRequirement {
	requiredAudiences?: string[];
	expectedIssuer?: string;
	requiresJwtAccessToken?: boolean;
	supportsPropagation?: boolean;
}
