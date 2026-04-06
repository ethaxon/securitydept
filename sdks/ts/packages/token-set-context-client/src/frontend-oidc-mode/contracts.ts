// Frontend OIDC Mode — cross-boundary contracts
//
// These types define the cross-boundary contracts between the frontend
// OIDC browser client and the backend. They are aligned with the Rust
// `frontend_oidc_mode` contracts in securitydept-token-set-context.
//
// Layer distinction:
//   - browser runtime types: FrontendOidcModeClientConfig, FrontendOidcModeAuthorizeParams, etc.
//     → owned by the browser OIDC client (client.ts / types.ts)
//   - cross-boundary contracts: FrontendOidcModeConfigProjection
//     → aligned with Rust, defines the config interop contract between frontend and backend
//
// User info contracts are included: the frontend uses `userinfoRequest()` from
// oauth4webapi to fetch claims directly from the provider's userinfo endpoint.

import type {
	FrontendOidcModeClientConfig,
	FrontendOidcModeTokenResult,
} from "./types";

// ---------------------------------------------------------------------------
// Claims check script (aligned with Rust FrontendOidcModeClaimsCheckScript)
// ---------------------------------------------------------------------------

/**
 * Structured claims check script delivered in the config projection.
 *
 * This is the TS equivalent of Rust `FrontendOidcModeClaimsCheckScript`.
 * Currently only `inline` is supported; future variants (e.g. a signed URL)
 * can be added without breaking existing consumers.
 */
export type FrontendOidcModeClaimsCheckScript =
	/** Script content is embedded inline by the backend. */
	{ type: "inline"; content: string };

// ---------------------------------------------------------------------------
// Claims check result (aligned with Rust ScriptClaimsCheckResult)
// ---------------------------------------------------------------------------

/**
 * Successful claims check result.
 *
 * Returned when the claims check script (or default logic) accepts the
 * ID token + userInfo claims and produces a normalized identity.
 */
export interface FrontendOidcModeClaimsCheckSuccessResult {
	success: true;
	displayName: string;
	picture?: string;
	claims: Record<string, unknown>;
}

/**
 * Failed claims check result.
 *
 * Returned when the claims check script explicitly rejects the claims.
 */
export interface FrontendOidcModeClaimsCheckFailureResult {
	success: false;
	error?: string;
	claims?: unknown;
}

/**
 * Discriminated union for claims check results.
 *
 * Aligned with Rust `ScriptClaimsCheckResult` (untagged serde).
 */
export type FrontendOidcModeClaimsCheckResult =
	| FrontendOidcModeClaimsCheckSuccessResult
	| FrontendOidcModeClaimsCheckFailureResult;

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
 * Faithfully reflects the resolved `OidcClientConfig` minus server-only
 * fields (`pendingStore`, `devicePollInterval`).
 *
 * `clientSecret` is only populated when `UnsafeFrontendClientSecret` capability
 * is enabled on the server.
 */
export interface FrontendOidcModeConfigProjection {
	// --- Provider connectivity (from OAuthProviderRemoteConfig) ---

	/** OIDC discovery URL (e.g. `https://auth.example.com/.well-known/openid-configuration`). */
	wellKnownUrl?: string;
	/** Issuer URL. When `wellKnownUrl` is set, this is derived from discovery; when not, use directly. */
	issuerUrl?: string;
	/** JWKS URI for direct key fetching without discovery. */
	jwksUri?: string;
	/** How often to refresh provider discovery metadata (human-readable duration, e.g. "5m"). */
	metadataRefreshInterval?: string;
	/** How often to refresh the remote JWKS (human-readable duration, e.g. "5m"). */
	jwksRefreshInterval?: string;

	// --- Provider OIDC endpoint overrides ---

	/** Authorization endpoint override. `undefined` means "derived from discovery." */
	authorizationEndpoint?: string;
	/** Token endpoint override. `undefined` means "derived from discovery." */
	tokenEndpoint?: string;
	/** UserInfo endpoint override. `undefined` means "derived from discovery." */
	userinfoEndpoint?: string;
	/** Revocation endpoint override. `undefined` means "derived from discovery." */
	revocationEndpoint?: string;
	/**
	 * Supported token endpoint authentication methods.
	 * `undefined` means "use provider discovery."
	 */
	tokenEndpointAuthMethodsSupported?: string[];
	/**
	 * Supported algorithms for signing ID tokens.
	 * `undefined` means "use provider discovery."
	 */
	idTokenSigningAlgValuesSupported?: string[];
	/**
	 * Supported algorithms for signing UserInfo responses.
	 * `undefined` means "use provider discovery."
	 */
	userinfoSigningAlgValuesSupported?: string[];

	/** The `client_id` for authorization requests. */
	clientId: string;
	/**
	 * **Unsafe.** Only populated when `UnsafeFrontendClientSecret` capability is
	 * enabled. The frontend should log a warning when this field is present.
	 */
	clientSecret?: string;
	/** Scopes to request. */
	scopes?: string[];
	/** Scopes that MUST be present in the token endpoint response. */
	requiredScopes?: string[];
	/** The redirect URL for the OIDC callback. */
	redirectUrl: string;
	/** Whether PKCE is enabled for the authorization code flow. */
	pkceEnabled?: boolean;
	/**
	 * Claims check script for client-side evaluation.
	 *
	 * The backend read the script from the filesystem and inlined it here.
	 * Currently only `inline` is supported.
	 */
	claimsCheckScript?: FrontendOidcModeClaimsCheckScript;
}

// ---------------------------------------------------------------------------
// Adapters: config projection → browser runtime config
// ---------------------------------------------------------------------------

/**
 * Convert a backend config projection into a browser runtime client config.
 *
 * This bridges the backend-provided projection (REST endpoint response)
 * to the browser OIDC client config used by `FrontendOidcModeClient`.
 *
 * All projection fields are mapped through to their `FrontendOidcModeClientConfig`
 * counterparts, including endpoint overrides, protocol control, JWKS metadata,
 * and claims check script.
 *
 * When `clientSecret` is present in the projection (unsafe capability),
 * the adapter logs a warning and passes it through.
 */
export function configProjectionToClientConfig(
	projection: FrontendOidcModeConfigProjection,
	overrides?: Partial<
		Pick<
			FrontendOidcModeClientConfig,
			"redirectUri" | "defaultPostAuthRedirectUri"
		>
	>,
): FrontendOidcModeClientConfig {
	// Derive issuer: prefer issuerUrl, then strip discovery suffix from wellKnownUrl
	const issuer =
		projection.issuerUrl ??
		projection.wellKnownUrl?.replace(
			/\/\.well-known\/openid-configuration\/?$/,
			"",
		) ??
		"";

	if (projection.clientSecret) {
		console.warn(
			"[securitydept] ⚠️  SECURITY WARNING: the server exposed client_secret to the " +
				"browser via UnsafeFrontendClientSecret capability. This is a security " +
				"anti-pattern. Contact your administrator.",
		);
	}

	return {
		issuer,
		clientId: projection.clientId,
		scopes: projection.scopes,
		redirectUri: overrides?.redirectUri ?? projection.redirectUrl,
		defaultPostAuthRedirectUri: overrides?.defaultPostAuthRedirectUri,
		// Endpoint overrides
		authorizationEndpoint: projection.authorizationEndpoint,
		tokenEndpoint: projection.tokenEndpoint,
		userinfoEndpoint: projection.userinfoEndpoint,
		revocationEndpoint: projection.revocationEndpoint,
		// Protocol control
		pkceEnabled: projection.pkceEnabled,
		clientSecret: projection.clientSecret,
		requiredScopes: projection.requiredScopes,
		claimsCheckScript: projection.claimsCheckScript,
		// Provider metadata
		jwksUri: projection.jwksUri,
		metadataRefreshInterval: projection.metadataRefreshInterval,
		jwksRefreshInterval: projection.jwksRefreshInterval,
		tokenEndpointAuthMethodsSupported:
			projection.tokenEndpointAuthMethodsSupported,
		idTokenSigningAlgValuesSupported:
			projection.idTokenSigningAlgValuesSupported,
		userinfoSigningAlgValuesSupported:
			projection.userinfoSigningAlgValuesSupported,
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

// ---------------------------------------------------------------------------
// User info contract
// ---------------------------------------------------------------------------

/**
 * User info response from the OIDC provider's userinfo endpoint.
 *
 * In frontend-oidc mode, the browser client calls the provider's userinfo
 * endpoint directly using the access token, without involving the backend.
 * This is fundamentally different from backend-oidc mode, where user info
 * retrieval is mediated by the backend.
 */
export interface FrontendOidcModeUserInfoResponse {
	/** The subject identifier (OIDC `sub` claim). */
	subject: string;
	/** Display name (`name` claim or derived). */
	displayName?: string;
	/** Profile picture URL. */
	picture?: string;
	/** Email address. */
	email?: string;
	/** Whether the email is verified. */
	emailVerified?: boolean;
	/** Raw claims from the userinfo response. */
	claims?: Record<string, unknown>;
}
