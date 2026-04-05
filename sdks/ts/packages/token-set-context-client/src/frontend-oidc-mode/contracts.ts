// Frontend OIDC Mode — cross-boundary contracts
//
// These types define the cross-boundary contracts between the frontend
// OIDC browser client and the backend. They are aligned with the Rust
// `frontend_oidc_mode` contracts in securitydept-token-set-context.
//
// Layer distinction:
//   - browser runtime types: FrontendOidcModeClientConfig, FrontendOidcModeAuthorizeParams, etc.
//     → owned by the browser OIDC client (client.ts / types.ts)
//   - cross-boundary contracts: FrontendOidcModeConfigProjection, FrontendOidcModeIntegrationRequirement,
//     FrontendOidcModeTokenMaterial
//     → aligned with Rust, define the interop contract between frontend and backend
//
// NOTE: user_info contracts are NOT exported here yet. The endpoint owner and
// protocol core for user_info are still being established (see review 1,
// finding 3). When the Rust authority and shared oidc-client helper land,
// this module can re-introduce the aligned TS types.

import type {
	FrontendOidcModeClientConfig,
	FrontendOidcModeTokenResult,
} from "./types";

// ---------------------------------------------------------------------------
// Config projection (aligned with Rust FrontendOidcModeConfigProjection)
// ---------------------------------------------------------------------------

/**
 * Backend-to-frontend OIDC configuration projection.
 *
 * The backend exposes this so the frontend can initialize its OIDC client
 * against the same provider. This is the TS equivalent of Rust
 * `FrontendOidcModeConfigProjection`.
 *
 * Mapping:
 * - Rust `well_known_url` → TS `wellKnownUrl`
 * - Rust `client_id` → TS `clientId`
 * - Rust `scopes` → TS `scopes`
 * - Rust `redirect_url` → TS `redirectUrl`
 */
export interface FrontendOidcModeConfigProjection {
	/** OIDC discovery URL. */
	wellKnownUrl: string;
	/** The `client_id` for authorization requests. */
	clientId: string;
	/** Scopes to request. */
	scopes?: string[];
	/** The redirect URL for the OIDC callback. */
	redirectUrl?: string;
}

// ---------------------------------------------------------------------------
// Integration requirement (aligned with Rust FrontendOidcModeIntegrationRequirement)
// ---------------------------------------------------------------------------

/**
 * What the backend expects from frontend-produced tokens.
 *
 * This is the TS equivalent of Rust `FrontendOidcModeIntegrationRequirement`.
 */
export interface FrontendOidcModeIntegrationRequirement {
	/** Expected audiences in the access token. */
	requiredAudiences?: string[];
	/** Expected token issuer URL. */
	expectedIssuer?: string;
	/** Whether the backend requires a JWT access token. */
	requiresJwtAccessToken?: boolean;
	/** Whether the backend supports token propagation. */
	supportsPropagation?: boolean;
}

// ---------------------------------------------------------------------------
// Token material (aligned with Rust FrontendOidcModeTokenMaterial)
// ---------------------------------------------------------------------------

/**
 * Minimal token material the frontend produces for the backend.
 *
 * This is the TS equivalent of Rust `FrontendOidcModeTokenMaterial`.
 * The frontend sends the access token via `Authorization: Bearer <token>`
 * and optionally forwards the ID token for identity claims.
 */
export interface FrontendOidcModeTokenMaterial {
	/** The bearer access token. */
	accessToken: string;
	/** Optional ID token for identity claims forwarding. */
	idToken?: string;
}

// ---------------------------------------------------------------------------
// Adapters: config projection → browser runtime config
// ---------------------------------------------------------------------------

/**
 * Convert a backend config projection into a browser runtime client config.
 *
 * This bridges the backend-provided projection (REST endpoint response)
 * to the browser OIDC client config used by `createFrontendOidcModeClient`.
 */
export function configProjectionToClientConfig(
	projection: FrontendOidcModeConfigProjection,
	overrides?: Partial<
		Pick<FrontendOidcModeClientConfig, "redirectUri" | "postLoginRedirectUri">
	>,
): FrontendOidcModeClientConfig {
	// Extract issuer from well-known URL by removing the discovery suffix
	const issuer = projection.wellKnownUrl.replace(
		/\/\.well-known\/openid-configuration\/?$/,
		"",
	);

	return {
		issuer,
		clientId: projection.clientId,
		scopes: projection.scopes,
		redirectUri: overrides?.redirectUri ?? projection.redirectUrl ?? "",
		postLoginRedirectUri: overrides?.postLoginRedirectUri,
	};
}

// ---------------------------------------------------------------------------
// Adapters: browser runtime result → orchestration snapshot
// ---------------------------------------------------------------------------

/**
 * Convert a browser OIDC token result into an orchestration `AuthSnapshot`.
 *
 * This is the formal bridge from the frontend-oidc-mode browser runtime
 * into the shared orchestration substrate (AuthMaterialController).
 */
export function tokenResultToAuthSnapshot(
	result: FrontendOidcModeTokenResult,
	options?: {
		providerId?: string;
		issuer?: string;
	},
): import("../orchestration/types").AuthSnapshot {
	return {
		tokens: {
			accessToken: result.accessToken,
			idToken: result.idToken,
			refreshMaterial: result.refreshToken,
			accessTokenExpiresAt: result.expiresAt,
		},
		metadata: {
			source: {
				kind: "oidc_authorization_code",
				providerId: options?.providerId,
				issuer: options?.issuer,
				kindHistory: ["oidc_authorization_code"],
			},
		},
	};
}

/**
 * Convert a browser OIDC token result into a `FrontendOidcModeTokenMaterial`.
 *
 * This extracts the cross-boundary contract material from the browser
 * runtime result.
 */
export function tokenResultToTokenMaterial(
	result: FrontendOidcModeTokenResult,
): FrontendOidcModeTokenMaterial {
	return {
		accessToken: result.accessToken,
		idToken: result.idToken,
	};
}
