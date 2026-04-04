// Frontend Pure OIDC Client — oauth4webapi wrapper core
//
// This module provides the first real slice of oauth4webapi wrapping:
//   1. Discovery — fetch and cache the provider's OpenID configuration
//   2. Authorize — build an authorization URL with PKCE + state
//   3. Callback  — exchange the authorization code for tokens
//
// Each step delegates the actual protocol work to oauth4webapi. This wrapper
// adds only:
//   - A unified FrontendOidcModeClientConfig vocabulary (vs scattered oauth4webapi params)
//   - PKCE + state generation with a structured result
//   - Token result normalization into a shape ready for orchestration handoff
//
// Token lifecycle after callback (persist, bearer projection, delta merge,
// transport) is handled by the /orchestration layer, not this module.
//
// Stability: experimental (first slice — not yet a stable public surface)

import * as oauth from "oauth4webapi";
import type {
	FrontendOidcModeAuthorizeParams,
	FrontendOidcModeAuthorizeResult,
	FrontendOidcModeClientConfig,
	FrontendOidcModeTokenResult,
} from "./types";

// ---------------------------------------------------------------------------
// FrontendOidcModeClient — thin wrapper around oauth4webapi protocol steps
// ---------------------------------------------------------------------------

/** An OIDC client instance bound to a specific provider + client config. */
export interface FrontendOidcModeClient {
	/** The resolved configuration. */
	readonly config: Readonly<FrontendOidcModeClientConfig>;

	/**
	 * Fetch and cache the provider's OpenID discovery document.
	 * Must be called before authorize() or handleCallback().
	 */
	discover(): Promise<void>;

	/**
	 * Build an authorization URL for the Authorization Code + PKCE flow.
	 *
	 * @param params - optional extra OAuth parameters
	 * @returns the redirect URL, code verifier, and state
	 */
	authorize(
		params?: FrontendOidcModeAuthorizeParams,
	): Promise<FrontendOidcModeAuthorizeResult>;

	/**
	 * Exchange an authorization code for tokens.
	 *
	 * @param callbackUrl - the full callback URL (with query params)
	 * @param codeVerifier - the PKCE code verifier from authorize()
	 * @param state - the state value from authorize()
	 * @returns the token result, ready for orchestration handoff
	 */
	handleCallback(
		callbackUrl: string,
		codeVerifier: string,
		state: string,
	): Promise<FrontendOidcModeTokenResult>;
}

/**
 * Create a frontend pure OIDC client wrapping oauth4webapi.
 *
 * This is the official recommended way to do standard browser-based OIDC
 * Authorization Code + PKCE flow within the token-set-context-client family.
 *
 * After obtaining tokens via handleCallback(), use the orchestration layer
 * (AuthMaterialController) to manage the token lifecycle:
 *
 * @example
 * ```ts
 * import { createFrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
 * import { createAuthMaterialController } from "@securitydept/token-set-context-client/orchestration";
 *
 * const oidc = createFrontendOidcModeClient({ issuer: "https://auth.example.com", clientId: "spa", redirectUri: "https://app.example.com/callback" });
 * await oidc.discover();
 *
 * // Step 1: redirect to provider
 * const { redirectUrl, codeVerifier, state } = await oidc.authorize();
 * sessionStorage.setItem("pkce", JSON.stringify({ codeVerifier, state }));
 * window.location.href = redirectUrl;
 *
 * // Step 2: on callback page
 * const { codeVerifier, state } = JSON.parse(sessionStorage.getItem("pkce")!);
 * const tokens = await oidc.handleCallback(window.location.href, codeVerifier, state);
 *
 * // Step 3: hand off to orchestration
 * const controller = createAuthMaterialController({ persistence: { store, key: "auth:v1" } });
 * await controller.applySnapshot({
 *   tokens: { accessToken: tokens.accessToken, refreshMaterial: tokens.refreshToken, idToken: tokens.idToken, accessTokenExpiresAt: tokens.expiresAt },
 *   metadata: { source: { kind: "oidc_authorization_code", providerId: "auth.example.com" } },
 * });
 * ```
 */
export function createFrontendOidcModeClient(
	config: FrontendOidcModeClientConfig,
): FrontendOidcModeClient {
	const resolvedScopes = config.scopes ?? ["openid"];

	// oauth4webapi client metadata — public client (PKCE only, no secret)
	const o4wClient: oauth.Client = {
		client_id: config.clientId,
	};

	// Public client authentication — no client secret
	const clientAuth = oauth.None();

	let authServer: oauth.AuthorizationServer | null = null;

	return {
		get config() {
			return config;
		},

		async discover(): Promise<void> {
			const issuerUrl = new URL(config.issuer);
			const response = await oauth.discoveryRequest(issuerUrl);
			authServer = await oauth.processDiscoveryResponse(issuerUrl, response);
		},

		async authorize(
			params?: FrontendOidcModeAuthorizeParams,
		): Promise<FrontendOidcModeAuthorizeResult> {
			if (!authServer) {
				throw new Error(
					"FrontendOidcModeClient: call discover() before authorize()",
				);
			}
			if (!authServer.authorization_endpoint) {
				throw new Error(
					"FrontendOidcModeClient: authorization_endpoint not found in discovery",
				);
			}

			const codeVerifier = oauth.generateRandomCodeVerifier();
			const codeChallenge =
				await oauth.calculatePKCECodeChallenge(codeVerifier);

			const state = oauth.generateRandomState();

			const authUrl = new URL(authServer.authorization_endpoint);
			authUrl.searchParams.set("client_id", config.clientId);
			authUrl.searchParams.set("redirect_uri", config.redirectUri);
			authUrl.searchParams.set("response_type", "code");
			authUrl.searchParams.set("scope", resolvedScopes.join(" "));
			authUrl.searchParams.set("code_challenge", codeChallenge);
			authUrl.searchParams.set("code_challenge_method", "S256");
			authUrl.searchParams.set("state", state);

			// Apply extra params (e.g. login_hint, prompt, acr_values)
			if (params?.extraParams) {
				for (const [key, value] of Object.entries(params.extraParams)) {
					authUrl.searchParams.set(key, value);
				}
			}

			return {
				redirectUrl: authUrl.toString(),
				codeVerifier,
				state,
			};
		},

		async handleCallback(
			callbackUrl: string,
			codeVerifier: string,
			state: string,
		): Promise<FrontendOidcModeTokenResult> {
			if (!authServer) {
				throw new Error(
					"FrontendOidcModeClient: call discover() before handleCallback()",
				);
			}

			const currentUrl = new URL(callbackUrl);
			const params = oauth.validateAuthResponse(
				authServer,
				o4wClient,
				currentUrl,
				state,
			);

			// Exchange code for tokens
			const response = await oauth.authorizationCodeGrantRequest(
				authServer,
				o4wClient,
				clientAuth,
				params,
				config.redirectUri,
				codeVerifier,
			);

			const result = await oauth.processAuthorizationCodeResponse(
				authServer,
				o4wClient,
				response,
			);

			// Normalize into our token result shape
			const tokenResult: FrontendOidcModeTokenResult = {
				accessToken: result.access_token,
				idToken: result.id_token,
				refreshToken: result.refresh_token,
			};

			if (result.expires_in !== undefined) {
				const expiresAtMs = Date.now() + result.expires_in * 1000;
				tokenResult.expiresAt = new Date(expiresAtMs).toISOString();
			}

			if (typeof result.scope === "string") {
				tokenResult.grantedScopes = result.scope.split(" ");
			}

			return tokenResult;
		},
	};
}
