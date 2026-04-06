// Backend OIDC Mode — unified contract vocabulary
//
// These types define the canonical frontend-facing contract for consuming a
// backend-oidc deployment, regardless of the active preset (pure / mediated).

import type {
	AuthMetadataDelta,
	AuthMetadataSnapshot,
} from "../orchestration/types";

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

/**
 * The full capability bundle for a `backend-oidc` deployment.
 *
 * This covers the 3 mode-specific capability axes. Token propagation is a
 * substrate-level concern owned by `access-token-substrate`, not a mode axis.
 *
 * User info is a baseline capability of every `backend-oidc` deployment
 * and is not modelled as a separate axis.
 */
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
// Callback response body
// ---------------------------------------------------------------------------

/**
 * Token material returned from the backend-oidc callback flow.
 *
 * Dual-mode delivery: browser redirect flows receive this via URL fragment;
 * programmatic flows receive it as a JSON response body.
 *
 * `idToken` is always present after a callback (OIDC requires id_token in
 * authorization code flow responses). `metadataRedemptionId` is present only
 * when `metadataDelivery = redemption`.
 */
export interface BackendOidcModeCallbackReturns {
	accessToken: string;
	idToken: string;
	refreshToken?: string;
	expiresAt?: string;
	metadataRedemptionId?: string;
	metadata?: AuthMetadataSnapshot;
}

// ---------------------------------------------------------------------------
// Refresh response body
// ---------------------------------------------------------------------------

/**
 * Token delta returned from the backend-oidc refresh flow.
 *
 * Dual-mode delivery: browser redirect flows receive this via URL fragment;
 * programmatic/silent refresh flows receive it as a JSON response body.
 *
 * `idToken` and `metadataRedemptionId` are optional.
 */
export interface BackendOidcModeRefreshReturns {
	accessToken: string;
	idToken?: string;
	refreshToken?: string;
	expiresAt?: string;
	metadataRedemptionId?: string;
	metadata?: AuthMetadataDelta;
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
}
