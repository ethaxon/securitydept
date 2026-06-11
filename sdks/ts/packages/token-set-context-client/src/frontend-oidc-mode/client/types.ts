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

import {
	type CancellationTokenOptions,
	type FoundationEnvironment,
} from "@securitydept/client";
import {
	type BaseOidcModeClientDefaultOptions,
	type OidcModeCallbackInputResolver,
	type OidcModeClientConfigBase,
} from "../../orchestration/client/types";
import { type TokenSetAuthSnapshot } from "../../orchestration/token/types";
import { type FrontendOidcModeCallbackInput } from "../contracts/callback";

// ---------------------------------------------------------------------------
// Mode-specific constants
// ---------------------------------------------------------------------------

export const FrontendOidcModeContextSource = {
	Client: "frontend_oidc_mode_client",
} as const;

export type FrontendOidcModeContextSource =
	(typeof FrontendOidcModeContextSource)[keyof typeof FrontendOidcModeContextSource];

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
export interface FrontendOidcModeClientConfig extends OidcModeClientConfigBase {
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
	claimsCheckScript?: import("../contracts/contracts").FrontendOidcModeClaimsCheckScript;

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

	/**
	 * Default URI to redirect the user to after callback processing.
	 * This is an app-level concept, not an OAuth parameter.
	 * Can be overridden per `authorizeUrl()` call.
	 */
	defaultPostAuthRedirectUri?: string;
}

export interface FrontendOidcModeClientOptions {
	readonly environment: FoundationEnvironment;
	readonly callbackInputResolver?: OidcModeCallbackInputResolver<FrontendOidcModeCallbackInput> | null;
}

export interface ResolvedFrontendOidcModeClientConfig
	extends FrontendOidcModeClientConfig {
	scopes: string[];
	pkceEnabled: boolean;
}

export interface FrontendOidcModeClientDefaultOptions
	extends BaseOidcModeClientDefaultOptions {
	persistenceKeyPrefix: string;
	pendingStateKeyPrefix: string;
	consumedStateKeyPrefix: string;
	pendingStateTtlMs: number;
	consumedStateTtlMs: number;
}

export interface FrontendOidcModeExchangeCodeOptions
	extends CancellationTokenOptions {
	expectedNonce?: string;
}

export interface FrontendOidcModeCheckClaimsOptions
	extends CancellationTokenOptions {
	userInfoClaims?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Pending OAuth State (stored in sessionStorage for redirect flows)
// ---------------------------------------------------------------------------

/**
 * Transient state stored in sessionStorage during the authorization redirect.
 *
 * When the user clicks "login", the client generates PKCE + nonce + state,
 * stores them in sessionStorage keyed by `state`, then redirects. On callback,
 * the client retrieves this state to complete the code exchange.
 */
export interface FrontendOidcModePendingState {
	/** PKCE code_verifier (undefined when PKCE is disabled). */
	codeVerifier?: string;
	/** OAuth 2.0 state parameter. */
	state: string;
	/** Identifies the frontend-oidc client mode that created this pending state. */
	contextSource: FrontendOidcModeContextSource;
	/** Provider issuer for the client that initiated this redirect flow. */
	issuer: string;
	/** OAuth client identifier for the client that initiated this redirect flow. */
	clientId: string;
	/** Redirect URI expected by the client that initiated this redirect flow. */
	redirectUri: string;
	/** OIDC nonce for id_token validation. */
	nonce: string;
	/** Where to redirect the user in the app after callback. */
	postAuthRedirectUri?: string;
	/** Timestamp (ms) when this pending state was created. TTL enforcement. */
	createdAt: number;
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
 * orchestration layer's TokenSetAuthSnapshot format.
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
	snapshot: TokenSetAuthSnapshot;
	/** The app-level redirect URI from `authorizeUrl()`, if any. */
	postAuthRedirectUri?: string;
}
