// Frontend OIDC Mode — client-specific types
//
// This module defines the configuration and protocol vocabulary for the
// frontend OIDC client pillar of token-set-context-client.
//
// Design principles:
//   - Wraps oauth4webapi (official base) to provide a thin, opinionated layer
//   - Reuses orchestration/lifecycle infrastructure for token material management
//   - Does NOT replace oauth4webapi — it adds lifecycle ownership on top
//
// Stability: provisional (mode-aligned surface)

import type {
	AuthDelta as _AuthDelta,
	AuthMetadataDelta as _AuthMetadataDelta,
	AuthMetadataSnapshot as _AuthMetadataSnapshot,
	AuthPrincipal as _AuthPrincipal,
	AuthSnapshot as _AuthSnapshot,
	AuthSource as _AuthSource,
	TokenDelta as _TokenDelta,
	TokenSnapshot as _TokenSnapshot,
} from "../orchestration/types";
import { AuthSourceKind as _AuthSourceKind } from "../orchestration/types";

// ---------------------------------------------------------------------------
// Orchestration re-exports (mode-qualified aliases)
// ---------------------------------------------------------------------------

/** @see {@link _AuthSourceKind} */
export const AuthenticationSourceKind = _AuthSourceKind;
export type AuthenticationSourceKind = _AuthSourceKind;

/** @see {@link _AuthSource} */
export type AuthenticationSource = _AuthSource;

/** @see {@link _AuthPrincipal} */
export type AuthenticatedPrincipal = _AuthPrincipal;

/** @see {@link _TokenSnapshot} */
export type AuthTokenSnapshot = _TokenSnapshot;

/** @see {@link _TokenDelta} */
export type AuthTokenDelta = _TokenDelta;

/** @see {@link _AuthMetadataSnapshot} */
export type AuthStateMetadataSnapshot = _AuthMetadataSnapshot;

/** @see {@link _AuthMetadataDelta} */
export type AuthStateMetadataDelta = _AuthMetadataDelta;

/** @see {@link _AuthSnapshot} */
export type AuthStateSnapshot = _AuthSnapshot;

/** @see {@link _AuthDelta} */
export type AuthStateDelta = _AuthDelta;

// ---------------------------------------------------------------------------
// Mode-specific constants
// ---------------------------------------------------------------------------

export const FrontendOidcModeContextSource = {
	Client: "frontend_oidc_mode_client",
} as const;

export type FrontendOidcModeContextSource =
	(typeof FrontendOidcModeContextSource)[keyof typeof FrontendOidcModeContextSource];

export const FrontendOidcModeStateRestoreSourceKind = {
	Manual: "manual",
	PersistentStore: "persistent_store",
} as const;

export type FrontendOidcModeStateRestoreSourceKind =
	(typeof FrontendOidcModeStateRestoreSourceKind)[keyof typeof FrontendOidcModeStateRestoreSourceKind];

// ---------------------------------------------------------------------------
// OIDC Client Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a browser-based OIDC Authorization Code + PKCE flow.
 *
 * This vocabulary covers both the protocol-level OIDC config (issuer, endpoints,
 * PKCE, scopes) and the lifecycle-level config (refresh window, persistence,
 * pending state).
 *
 * Most protocol fields map 1:1 from `FrontendOidcModeConfigProjection` via the
 * `configProjectionToClientConfig()` adapter.
 */
export interface FrontendOidcModeClientConfig {
	// --- Provider identity ---

	/** The OIDC provider's issuer URL (must match the `iss` in discovery). */
	issuer: string;

	/** OAuth 2.0 client identifier. */
	clientId: string;

	/** Where the provider should redirect after authorization. */
	redirectUri: string;

	/** OAuth 2.0 scopes to request. Defaults to `["openid"]`. */
	scopes?: string[];

	// --- Endpoint overrides (from backend projection) ---

	/**
	 * Authorization endpoint override. When set, the client uses this
	 * instead of discovering the endpoint from the provider metadata.
	 */
	authorizationEndpoint?: string;

	/**
	 * Token endpoint override. When set, the client uses this
	 * instead of discovering the endpoint from the provider metadata.
	 */
	tokenEndpoint?: string;

	/**
	 * UserInfo endpoint override. When set, the client uses this
	 * instead of discovering the endpoint from the provider metadata.
	 */
	userinfoEndpoint?: string;

	/**
	 * Revocation endpoint override. When set, the client uses this
	 * instead of discovering the endpoint from the provider metadata.
	 */
	revocationEndpoint?: string;

	// --- Protocol control ---

	/**
	 * Whether PKCE is enabled for the authorization code flow.
	 * Defaults to `true`.
	 */
	pkceEnabled?: boolean;

	/**
	 * **Unsafe.** Only populated when `UnsafeFrontendClientSecret` capability is
	 * enabled on the server. Browser apps should use PKCE, not secrets.
	 */
	clientSecret?: string;

	/**
	 * Scopes that MUST be present in the token endpoint response.
	 * The client can validate granted scopes against this set after callback.
	 */
	requiredScopes?: string[];

	/**
	 * Claims check script for client-side evaluation.
	 * The backend reads the script from the filesystem and inlines the content
	 * in the config projection so the browser can evaluate it directly.
	 */
	claimsCheckScript?: import("./contracts").FrontendOidcModeClaimsCheckScript;

	// --- Provider metadata (from backend projection) ---

	/**
	 * JWKS URI for direct key fetching.
	 * Needed when the browser must decode / verify the ID token
	 * independently (e.g. for claims extraction).
	 */
	jwksUri?: string;

	/** How often to refresh provider discovery metadata (human-readable duration, e.g. "5m"). */
	metadataRefreshInterval?: string;

	/** How often to refresh the remote JWKS (human-readable duration, e.g. "5m"). */
	jwksRefreshInterval?: string;

	/**
	 * Supported token endpoint authentication methods override.
	 * When set, used to select the auth method instead of relying on discovery.
	 */
	tokenEndpointAuthMethodsSupported?: string[];

	/**
	 * Supported algorithms for signing ID tokens.
	 * Can be passed to the authorization server override to constrain
	 * which algorithms are accepted during token processing.
	 */
	idTokenSigningAlgValuesSupported?: string[];

	/**
	 * Supported algorithms for signing UserInfo responses.
	 */
	userinfoSigningAlgValuesSupported?: string[];

	// --- Lifecycle control ---

	/**
	 * Buffer before access token expiry to trigger auto-refresh, in ms.
	 * Defaults to `60_000` (1 minute).
	 */
	refreshWindowMs?: number;

	/**
	 * Key used with `runtime.persistentStore` for persisted auth state.
	 * When not set, a default key is derived from the issuer + clientId.
	 */
	persistentStateKey?: string;

	/**
	 * Default URI to redirect the user to after callback processing.
	 * This is an app-level concept, not an OAuth parameter.
	 * Can be overridden per `authorizeUrl()` call.
	 */
	defaultPostAuthRedirectUri?: string;
}

// ---------------------------------------------------------------------------
// Pending OAuth State (stored in sessionStore for redirect flows)
// ---------------------------------------------------------------------------

/**
 * Transient state stored in sessionStore during the authorization redirect.
 *
 * When the user clicks "login", the client generates PKCE + nonce + state,
 * stores them in sessionStore keyed by `state`, then redirects. On callback,
 * the client retrieves this state to complete the code exchange.
 */
export interface FrontendOidcModePendingState {
	/** PKCE code_verifier (undefined when PKCE is disabled). */
	codeVerifier?: string;
	/** OAuth 2.0 state parameter. */
	state: string;
	/** OIDC nonce for id_token validation. */
	nonce: string;
	/** Where to redirect the user in the app after callback. */
	postAuthRedirectUri?: string;
	/** Timestamp (ms) when this pending state was created. TTL enforcement. */
	createdAt: number;
}

// ---------------------------------------------------------------------------
// Authorize Request (low-level)
// ---------------------------------------------------------------------------

/** Parameters for building an authorization URL (low-level). */
export interface FrontendOidcModeAuthorizeParams {
	/** Additional OAuth parameters to include (e.g. login_hint, prompt). */
	extraParams?: Record<string, string>;
}

/** The result of building an authorization request (low-level). */
export interface FrontendOidcModeAuthorizeResult {
	/** The full authorization URL to redirect to. */
	redirectUrl: string;
	/** The code_verifier for PKCE — omitted when PKCE is disabled. */
	codeVerifier?: string;
	/** The state parameter — must match in the callback phase. */
	state: string;
	/** The nonce for id_token validation. */
	nonce: string;
}

// ---------------------------------------------------------------------------
// Callback Processing (low-level)
// ---------------------------------------------------------------------------

/**
 * Token material received from a successful authorization code exchange.
 *
 * This is the bridge between oauth4webapi's token response and our
 * orchestration layer's AuthSnapshot format.
 */
export interface FrontendOidcModeTokenResult {
	/** The access token. */
	accessToken: string;
	/** The ID token (JWT), if returned by the provider. */
	idToken?: string;
	/** The refresh token, if granted. */
	refreshToken?: string;
	/** When the access token expires (ISO 8601 string). */
	expiresAt?: string;
	/** The scopes granted by the provider (may differ from requested). */
	grantedScopes?: string[];
}

// ---------------------------------------------------------------------------
// High-level callback result
// ---------------------------------------------------------------------------

/**
 * Result of the high-level `handleCallback()`.
 *
 * Contains the persisted auth snapshot plus the app-level post-auth redirect
 * URI that was stored in the pending state during `authorizeUrl()`.
 */
export interface FrontendOidcModeCallbackResult {
	/** The auth state snapshot, already persisted and reflected in `state` signal. */
	snapshot: AuthStateSnapshot;
	/** The app-level redirect URI from `authorizeUrl()`, if any. */
	postAuthRedirectUri?: string;
}
