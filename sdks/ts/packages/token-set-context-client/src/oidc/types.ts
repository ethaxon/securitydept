// Frontend Pure OIDC Client — oauth4webapi wrapper types
//
// This module defines the configuration and protocol vocabulary for the
// frontend pure OIDC client pillar of token-set-context-client.
//
// Design principles:
//   - Wraps oauth4webapi (official base) to provide a thin, opinionated layer
//   - Reuses orchestration/lifecycle infrastructure for token material management
//   - Does NOT replace oauth4webapi — it adds lifecycle ownership on top
//   - Does NOT import token-set sealed flow concepts (redirect recovery,
//     metadata redemption, sealed refresh token)
//
// What this wrapper owns vs what oauth4webapi owns:
//   oauth4webapi:  protocol encoding, crypto, token validation, PKCE
//   this wrapper:  config vocabulary, authorize URL assembly, callback parsing → orchestration handoff
//
// Stability: experimental (first slice — not yet a stable public surface)

// (oauth4webapi types are used in client.ts, not here — this file only defines
// our own config/result vocabulary that is intentionally decoupled from o4w types)

// ---------------------------------------------------------------------------
// OIDC Client Configuration
// ---------------------------------------------------------------------------

/**
 * Minimal configuration for a browser-based OIDC Authorization Code + PKCE flow.
 *
 * This vocabulary covers the subset of OIDC config that a standard browser SPA
 * needs for the authorization code flow. It intentionally excludes:
 *   - client_secret (browser apps should use PKCE, not secrets)
 *   - token introspection / revocation (not first-slice scope)
 *   - session management / logout (not first-slice scope)
 *   - DPoP / mTLS (advanced; may be added as a future extension)
 */
export interface OidcClientConfig {
	/** The OIDC provider's issuer URL (must match the `iss` in discovery). */
	issuer: string;

	/** OAuth 2.0 client identifier. */
	clientId: string;

	/** Where the provider should redirect after authorization. */
	redirectUri: string;

	/** OAuth 2.0 scopes to request. Defaults to `["openid"]`. */
	scopes?: string[];

	/**
	 * Where to redirect the user in the application after callback processing.
	 * This is an app-level concept, not an OAuth parameter.
	 */
	postLoginRedirectUri?: string;
}

// ---------------------------------------------------------------------------
// Authorize Request
// ---------------------------------------------------------------------------

/** Parameters for building an authorization URL. */
export interface AuthorizeParams {
	/** Additional OAuth parameters to include (e.g. login_hint, prompt). */
	extraParams?: Record<string, string>;
}

/** The result of building an authorization request. */
export interface AuthorizeResult {
	/** The full authorization URL to redirect to. */
	redirectUrl: string;
	/** The code_verifier for PKCE — must be stored for the callback phase. */
	codeVerifier: string;
	/** The state parameter — must match in the callback phase. */
	state: string;
}

// ---------------------------------------------------------------------------
// Callback Processing
// ---------------------------------------------------------------------------

/**
 * Token material received from a successful authorization code exchange.
 *
 * This is the bridge between oauth4webapi's token response and our
 * orchestration layer's AuthSnapshot format.
 */
export interface OidcTokenResult {
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
// Comparison notes: oauth4webapi vs oidc-client-ts
//
// These notes capture the first-round protocol/shape comparison used to
// determine what this wrapper should own vs what should stay in oauth4webapi.
//
// | Concern                   | oauth4webapi          | oidc-client-ts        | Our wrapper          |
// |---------------------------|-----------------------|-----------------------|----------------------|
// | Discovery fetch           | discoveryRequest()    | OidcMetadata (Mgr)    | wraps o4w discovery  |
// | Authorize URL             | buildAuthorizationUrl | signinRedirect (Mgr)  | wraps o4w + PKCE gen |
// | PKCE generation           | generateRandomCodeVer | internal in Mgr       | wraps o4w            |
// | Callback processing       | validateAuthResponse  | signinCallback (Mgr)  | wraps o4w + handoff  |
// | Token exchange            | authorizationCodeGrant| internal in Mgr       | wraps o4w            |
// | Token refresh             | refreshTokenGrant     | signinSilent (Mgr)    | future slice         |
// | Token storage             | N/A (BYO)             | WebStorageStateStore  | orchestration layer  |
// | Bearer header projection  | N/A (BYO)             | N/A (BYO)             | orchestration layer  |
// | Session mgmt / logout     | N/A                   | signoutRedirect etc.  | future slice (maybe) |
// | UserInfo                  | userinfoRequest()     | getUser → User.profile| future slice (maybe) |
//
// Key takeaway: oauth4webapi gives us the right granularity (individual protocol
// steps) without opinionated state management. oidc-client-ts bundles everything
// into UserManager which is harder to compose with our orchestration layer.
// That's why oauth4webapi is the official base, and oidc-client-ts is comparison.
// ---------------------------------------------------------------------------
