// Frontend OIDC Mode Client — full lifecycle management
//
// Extends BaseOidcModeClient with browser-side OIDC protocol operations:
//   - OIDC discovery (with optional periodic refresh)
//   - Authorization URL construction + pending state storage
//   - Callback processing + code exchange
//   - Automatic userInfo fetch + claims check
//   - Token refresh via refresh_token grant
//
// High-level API (recommended):
//   authorizeUrl()        — build login URL + store pending state
//   handleCallback()      — restore pending → exchange → userInfo → claimsCheck → persist
//   refresh()             — refresh tokens → optional re-claimsCheck → persist
//   fetchUserInfo()       — fetch userInfo + claimsCheck using current auth state
//   + inherited: restorePersistedState / restoreState / clearState / dispose
//
// Low-level API (for custom flows):
//   discover()            — fetch OIDC discovery document
//   buildAuthorizeUrl()   — build authorization URL (returns PKCE params)
//   exchangeCode()        — exchange authorization code for tokens
//   refreshTokens()       — refresh tokens using refresh_token grant
//   fetchUserInfoRaw()    — fetch raw userInfo from provider
//   checkClaims()         — run claims check script or default logic
//
// Stability: provisional (mode-aligned surface)

import type {
	CancelableHandle,
	ClientRuntime,
	EphemeralFlowStore,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createEphemeralFlowStore,
	interval,
	LogLevel,
} from "@securitydept/client";
import {
	openPopupWindow,
	relayPopupCallback,
	waitForPopupRelay,
} from "@securitydept/client/web";
import {
	type AuthorizationServer,
	authorizationCodeGrantRequest,
	type Client,
	None as ClientNone,
	ClientSecretPost,
	calculatePKCECodeChallenge,
	discoveryRequest,
	generateRandomCodeVerifier,
	generateRandomState,
	nopkce,
	processAuthorizationCodeResponse,
	processDiscoveryResponse,
	processRefreshTokenResponse,
	processUserInfoResponse,
	refreshTokenGrantRequest,
	type TokenEndpointResponse,
	userInfoRequest,
	validateAuthResponse,
} from "oauth4webapi";
import { BaseOidcModeClient } from "../orchestration/index";
import type {
	FrontendOidcModeClaimsCheckResult,
	FrontendOidcModeClaimsCheckScript,
	FrontendOidcModeUserInfoResponse,
} from "./contracts";
import { resolveDiscoveryIssuerCompatibility } from "./discovery";
import type {
	AuthStateMetadataSnapshot,
	AuthStateSnapshot,
	FrontendOidcModeAuthorizeParams,
	FrontendOidcModeAuthorizeResult,
	FrontendOidcModeCallbackResult,
	FrontendOidcModeClientConfig,
	FrontendOidcModePendingState,
	FrontendOidcModeTokenResult,
} from "./types";
import { FrontendOidcModeContextSource } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_REFRESH_WINDOW_MS = 60_000;
const DEFAULT_PERSISTENCE_KEY_PREFIX = "securitydept.frontend_oidc";
const PENDING_STATE_KEY = "securitydept.frontend_oidc.pending";
const PENDING_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TRACE_SCOPE = "frontend-oidc-mode";
const TRACE_SOURCE = FrontendOidcModeContextSource.Client;
const TRACE_PREFIX = "frontend_oidc";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Decode a JWT payload without signature verification.
 * oauth4webapi already validates the ID token during the token exchange;
 * this function only extracts the payload claims for claims-check evaluation.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
	const parts = jwt.split(".");
	if (parts.length !== 3) {
		throw new Error("Invalid JWT format: expected 3 parts");
	}
	const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64 + "===".slice(0, (4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	const json = new TextDecoder().decode(bytes);
	return JSON.parse(json);
}

/**
 * Transform a claims check script source for browser evaluation.
 * Aligned with Rust `transform_script_to_boa_compat()`.
 */
function transformScriptForBrowser(source: string): string {
	return source
		.replace(
			"export default async function",
			"__exports.default = async function",
		)
		.replace("export default function", "__exports.default = function")
		.replace("export default", "__exports.default =");
}

/**
 * Parse a human-readable duration string (e.g. "5m", "300s") to milliseconds.
 */
function parseDurationToMs(duration: string): number {
	const match = duration.match(/^(\d+(?:\.\d+)?)\s*(s|ms|m|h)$/);
	if (!match) return 0;
	const value = Number(match[1]);
	switch (match[2]) {
		case "ms":
			return value;
		case "s":
			return value * 1000;
		case "m":
			return value * 60 * 1000;
		case "h":
			return value * 60 * 60 * 1000;
		default:
			return 0;
	}
}

// ---------------------------------------------------------------------------
// FrontendOidcModeClient
// ---------------------------------------------------------------------------

/**
 * Options for {@link FrontendOidcModeClient.loginWithRedirect}.
 */
export interface FrontendOidcModeLoginWithRedirectOptions {
	/**
	 * Where to redirect the user after successful authentication.
	 *
	 * When omitted, the client's `defaultPostAuthRedirectUri` from config
	 * is used.
	 */
	postAuthRedirectUri?: string;
	/** Extra query parameters to append to the authorization URL. */
	extraParams?: Record<string, string>;
}

/**
 * Options for {@link FrontendOidcModeClient.popupLogin}.
 */
export interface FrontendOidcModePopupLoginOptions {
	/**
	 * The popup callback URL. This page should call
	 * `relayFrontendOidcPopupCallback()` to relay the result back.
	 */
	popupCallbackUrl: string;
	/** Extra query parameters to append to the authorization URL. */
	extraParams?: Record<string, string>;
	/** Popup window width in pixels (default: 500). */
	popupWidth?: number;
	/** Popup window height in pixels (default: 600). */
	popupHeight?: number;
	/** Maximum time in ms to wait for the popup relay (default: 120000). */
	timeoutMs?: number;
}

/**
 * Browser-side OIDC client for frontend-oidc mode.
 *
 * Extends {@link BaseOidcModeClient} with OIDC discovery, authorization code
 * + PKCE flow, automatic userInfo + claims check, and metadata refresh.
 */
export class FrontendOidcModeClient extends BaseOidcModeClient {
	// --- Config ---
	private readonly _config: FrontendOidcModeClientConfig;
	private readonly _resolvedScopes: string[];
	private readonly _pkceEnabled: boolean;

	// --- oauth4webapi ---
	private readonly _o4wClient: Client;
	private readonly _clientAuth: ReturnType<
		typeof ClientSecretPost | typeof ClientNone
	>;
	private _authServer: AuthorizationServer | null = null;

	// --- Pending state ---
	private _pendingStore: EphemeralFlowStore<FrontendOidcModePendingState> | null =
		null;

	// --- Metadata refresh ---
	private _metadataRefreshHandle: CancelableHandle | null = null;

	constructor(config: FrontendOidcModeClientConfig, runtime: ClientRuntime) {
		super({
			runtime,
			refreshWindowMs: config.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS,
			traceScope: TRACE_SCOPE,
			traceSource: TRACE_SOURCE,
			tracePrefix: TRACE_PREFIX,
			clientName: "FrontendOidcModeClient",
			persistence: runtime.persistentStore
				? {
						store: runtime.persistentStore,
						key:
							config.persistentStateKey ??
							`${DEFAULT_PERSISTENCE_KEY_PREFIX}:v1:${config.issuer}:${config.clientId}`,
					}
				: undefined,
		});

		this._config = config;
		this._resolvedScopes = config.scopes ?? ["openid"];
		this._pkceEnabled = config.pkceEnabled !== false;

		this._o4wClient = { client_id: config.clientId };
		this._clientAuth = config.clientSecret
			? ClientSecretPost(config.clientSecret)
			: ClientNone();

		if (runtime.sessionStore) {
			this._pendingStore =
				createEphemeralFlowStore<FrontendOidcModePendingState>({
					store: runtime.sessionStore,
					key: PENDING_STATE_KEY,
				});
		}
	}

	/** The resolved configuration. */
	get config(): Readonly<FrontendOidcModeClientConfig> {
		return this._config;
	}

	/** Subclass dispose hook — cancel metadata refresh timer. */
	protected override _onDispose(): void {
		this._cancelMetadataRefresh();
	}

	// =======================================================================
	// HIGH-LEVEL API
	// =======================================================================

	/**
	 * Build the authorize URL, generate PKCE + nonce, and store pending state.
	 *
	 * The consumer should redirect the browser to the returned URL.
	 * On the callback page, call `handleCallback(callbackUrl)`.
	 */
	async authorizeUrl(
		postAuthRedirectUri?: string,
		extraParams?: Record<string, string>,
	): Promise<string> {
		this._throwIfNotOperational();
		this._recordTrace("frontend_oidc.authorize.started");

		try {
			await this._ensureAuthServer();

			const result = await this.buildAuthorizeUrl({ extraParams });

			const effectiveRedirectUri =
				postAuthRedirectUri ?? this._config.defaultPostAuthRedirectUri;

			await this._savePendingState({
				codeVerifier: result.codeVerifier,
				state: result.state,
				nonce: result.nonce,
				postAuthRedirectUri: effectiveRedirectUri,
				createdAt: this._runtime.clock.now(),
			});

			this._recordTrace("frontend_oidc.authorize.succeeded", {
				state: result.state,
			});

			return result.redirectUrl;
		} catch (error) {
			this._recordFailureTrace("frontend_oidc.authorize.failed", error);
			throw error;
		}
	}

	/**
	 * One-shot browser redirect to the OIDC provider's authorization endpoint.
	 *
	 * Builds the authorize URL (including PKCE + nonce), stores pending state,
	 * and navigates the current window.  This is the recommended entry point
	 * for initiating frontend-oidc login in a browser context.
	 */
	async loginWithRedirect(
		options: FrontendOidcModeLoginWithRedirectOptions = {},
	): Promise<void> {
		const url = await this.authorizeUrl(
			options.postAuthRedirectUri,
			options.extraParams,
		);

		window.location.href = url;
	}

	/**
	 * Initiate frontend-oidc login via a popup window.
	 *
	 * Opens a popup to the OIDC provider's authorization endpoint, waits for
	 * the popup callback page to relay the callback URL back via `postMessage`,
	 * then processes the callback through the existing `handleCallback()` pipeline.
	 *
	 * @returns The callback result from processing the authorization code.
	 */
	async popupLogin(
		options: FrontendOidcModePopupLoginOptions,
	): Promise<FrontendOidcModeCallbackResult> {
		const url = await this.authorizeUrl(
			options.popupCallbackUrl,
			options.extraParams,
		);

		const popup = openPopupWindow(url, {
			width: options.popupWidth,
			height: options.popupHeight,
		});

		const callbackUrl = await waitForPopupRelay({
			popup,
			timeoutMs: options.timeoutMs,
		});

		return this.handleCallback(callbackUrl);
	}

	/**
	 * Handle a callback URL from the provider redirect.
	 *
	 * Restores pending state, exchanges code, fetches userInfo,
	 * runs claims check, persists snapshot, and schedules refresh.
	 */
	async handleCallback(
		callbackUrl: string,
	): Promise<FrontendOidcModeCallbackResult> {
		this._recordTrace("frontend_oidc.callback.started");

		try {
			this._throwIfNotOperational();

			const url = new URL(callbackUrl);
			const state = url.searchParams.get("state");
			if (!state) {
				throw new ClientError({
					kind: ClientErrorKind.Protocol,
					message: "Callback URL missing state parameter",
					code: "callback.missing_state",
					source: TRACE_SCOPE,
				});
			}

			const pending = await this._consumePendingState();
			if (!pending) {
				throw new ClientError({
					kind: ClientErrorKind.Protocol,
					message:
						"No pending authorization state found for this callback (expired or never started)",
					code: "callback.pending_not_found",
					source: TRACE_SCOPE,
				});
			}

			if (pending.state !== state) {
				throw new ClientError({
					kind: ClientErrorKind.Protocol,
					message: "OAuth state mismatch between callback and pending state",
					code: "callback.state_mismatch",
					source: TRACE_SCOPE,
				});
			}

			this._throwIfNotOperational();

			await this._ensureAuthServer();
			const tokens = await this.exchangeCode(
				callbackUrl,
				pending.codeVerifier,
				pending.state,
				pending.nonce,
			);

			this._throwIfNotOperational();

			const metadata = await this._performClaimsCheck(tokens);

			const snapshot: AuthStateSnapshot = {
				tokens: this._tokenResultToTokenSnapshot(tokens),
				metadata,
			};

			await this._applySnapshot(snapshot);

			this._runtime.logger?.log({
				level: LogLevel.Info,
				message: "Auth state initialized from OIDC callback",
				scope: TRACE_SCOPE,
			});

			this._recordTrace("frontend_oidc.callback.succeeded", {
				hasClaimsCheck: metadata.principal !== undefined,
				persisted: this._authMaterial.persistence !== null,
			});

			return {
				snapshot,
				postAuthRedirectUri: pending.postAuthRedirectUri,
			};
		} catch (error) {
			this._recordFailureTrace("frontend_oidc.callback.failed", error);
			throw error;
		}
	}

	/**
	 * Refresh the current token set.
	 *
	 * If the refresh response contains a new id_token, userInfo is re-fetched
	 * and claims check is re-run. Otherwise, existing metadata is preserved.
	 */
	async refresh(): Promise<AuthStateSnapshot | null> {
		const current = this._authMaterial.snapshot;
		if (!current?.tokens.refreshMaterial) {
			return null;
		}

		this._recordTrace("frontend_oidc.refresh.started", {
			hasIdToken: current.tokens.idToken !== undefined,
		});

		try {
			this._throwIfNotOperational();

			await this._ensureAuthServer();
			const tokens = await this.refreshTokens(current.tokens.refreshMaterial);

			this._throwIfNotOperational();

			let metadata: AuthStateMetadataSnapshot;
			if (tokens.idToken) {
				metadata = await this._performClaimsCheck(tokens);
			} else {
				metadata = current.metadata;
			}

			const newSnapshot: AuthStateSnapshot = {
				tokens: this._tokenResultToTokenSnapshot(tokens),
				metadata,
			};

			await this._applySnapshot(newSnapshot);

			this._runtime.logger?.log({
				level: LogLevel.Info,
				message: "Token refreshed successfully",
				scope: TRACE_SCOPE,
			});

			this._recordTrace("frontend_oidc.refresh.succeeded", {
				newIdToken: tokens.idToken !== undefined,
				persisted: this._authMaterial.persistence !== null,
			});

			return newSnapshot;
		} catch (error) {
			this._recordFailureTrace("frontend_oidc.refresh.failed", error);
			throw error;
		}
	}

	/**
	 * Fetch userInfo using the current auth state and run claims check.
	 */
	async fetchUserInfo(): Promise<FrontendOidcModeClaimsCheckResult> {
		this._recordTrace("frontend_oidc.user_info.started");

		try {
			this._throwIfNotOperational();

			const current = this._authMaterial.snapshot;
			if (!current?.tokens.accessToken || !current.tokens.idToken) {
				throw new ClientError({
					kind: ClientErrorKind.Unauthenticated,
					message: "Cannot fetch user info without access_token and id_token",
					code: "frontend_oidc.user_info.unauthenticated",
					source: TRACE_SCOPE,
				});
			}

			await this._ensureAuthServer();
			const userInfo = await this.fetchUserInfoRaw(current.tokens.accessToken);
			const result = await this.checkClaims(
				current.tokens.idToken,
				userInfo.claims,
			);

			this._recordTrace("frontend_oidc.user_info.succeeded");
			return result;
		} catch (error) {
			this._recordFailureTrace("frontend_oidc.user_info.failed", error);
			throw error;
		}
	}

	// =======================================================================
	// LOW-LEVEL PROTOCOL API
	// =======================================================================

	/** Fetch and cache the provider's OpenID discovery document. */
	async discover(): Promise<void> {
		const configuredIssuer = this._config.issuer;
		const configuredIssuerUrl = new URL(configuredIssuer);
		const response = await discoveryRequest(configuredIssuerUrl);
		const compatibleIssuer = await resolveDiscoveryIssuerCompatibility(
			response,
			configuredIssuer,
		);
		const compatibleIssuerUrl = new URL(compatibleIssuer);
		const discovered = await processDiscoveryResponse(
			compatibleIssuerUrl,
			response,
		);
		this._authServer = this._applyEndpointOverrides(discovered);
		this._scheduleMetadataRefresh();

		if (compatibleIssuer !== configuredIssuer) {
			this._recordTrace("frontend_oidc.discovery.issuer_compat_resolved", {
				configuredIssuer,
				resolvedIssuer: compatibleIssuer,
			});
		}
	}

	/** Build an authorization URL with PKCE + nonce (low-level). */
	async buildAuthorizeUrl(
		params?: FrontendOidcModeAuthorizeParams,
	): Promise<FrontendOidcModeAuthorizeResult> {
		const authServer = this._requireAuthServer("buildAuthorizeUrl");
		if (!authServer.authorization_endpoint) {
			throw new Error(
				"FrontendOidcModeClient: authorization_endpoint not found in discovery",
			);
		}

		const state = generateRandomState();
		const nonce = generateRandomState();
		const authUrl = new URL(authServer.authorization_endpoint);
		authUrl.searchParams.set("client_id", this._config.clientId);
		authUrl.searchParams.set("redirect_uri", this._config.redirectUri);
		authUrl.searchParams.set("response_type", "code");
		authUrl.searchParams.set("scope", this._resolvedScopes.join(" "));
		authUrl.searchParams.set("state", state);
		authUrl.searchParams.set("nonce", nonce);

		let codeVerifier: string | undefined;
		if (this._pkceEnabled) {
			codeVerifier = generateRandomCodeVerifier();
			const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
			authUrl.searchParams.set("code_challenge", codeChallenge);
			authUrl.searchParams.set("code_challenge_method", "S256");
		}

		if (params?.extraParams) {
			for (const [key, value] of Object.entries(params.extraParams)) {
				authUrl.searchParams.set(key, value);
			}
		}

		return { redirectUrl: authUrl.toString(), codeVerifier, state, nonce };
	}

	/** Exchange an authorization code for tokens (low-level). */
	async exchangeCode(
		callbackUrl: string,
		codeVerifier: string | undefined,
		state: string,
		expectedNonce?: string,
	): Promise<FrontendOidcModeTokenResult> {
		const authServer = this._requireAuthServer("exchangeCode");

		const currentUrl = new URL(callbackUrl);
		const params = validateAuthResponse(
			authServer,
			this._o4wClient,
			currentUrl,
			state,
		);

		const response = await authorizationCodeGrantRequest(
			authServer,
			this._o4wClient,
			this._clientAuth,
			params,
			this._config.redirectUri,
			this._pkceEnabled ? (codeVerifier ?? nopkce) : nopkce,
		);

		const result = await processAuthorizationCodeResponse(
			authServer,
			this._o4wClient,
			response,
			expectedNonce ? { expectedNonce } : undefined,
		);

		const tokenResult = this._normalizeTokenResponse(result);
		this._validateRequiredScopes(tokenResult.grantedScopes);
		return tokenResult;
	}

	/** Refresh tokens using a refresh_token grant (low-level). */
	async refreshTokens(
		refreshToken: string,
	): Promise<FrontendOidcModeTokenResult> {
		const authServer = this._requireAuthServer("refreshTokens");

		const response = await refreshTokenGrantRequest(
			authServer,
			this._o4wClient,
			this._clientAuth,
			refreshToken,
		);

		const result = await processRefreshTokenResponse(
			authServer,
			this._o4wClient,
			response,
		);

		return this._normalizeTokenResponse(result);
	}

	/** Fetch raw userInfo from the provider (low-level). */
	async fetchUserInfoRaw(
		accessToken: string,
	): Promise<FrontendOidcModeUserInfoResponse> {
		const authServer = this._requireAuthServer("fetchUserInfoRaw");

		const response = await userInfoRequest(
			authServer,
			this._o4wClient,
			accessToken,
		);

		const claims = await processUserInfoResponse(
			authServer,
			this._o4wClient,
			undefined as unknown as string,
			response,
		);

		return {
			subject: String(claims.sub ?? ""),
			displayName: typeof claims.name === "string" ? claims.name : undefined,
			picture: typeof claims.picture === "string" ? claims.picture : undefined,
			email: typeof claims.email === "string" ? claims.email : undefined,
			emailVerified:
				typeof claims.email_verified === "boolean"
					? claims.email_verified
					: undefined,
			claims: claims as Record<string, unknown>,
		};
	}

	/** Run claims check script or default logic (low-level). */
	async checkClaims(
		idToken: string,
		userInfoClaims?: Record<string, unknown> | null,
	): Promise<FrontendOidcModeClaimsCheckResult> {
		const idTokenClaims = decodeJwtPayload(idToken);
		const uiClaims = userInfoClaims ?? null;

		const script = this._config.claimsCheckScript;
		if (script) {
			return this._executeClaimsCheckScript(script, idTokenClaims, uiClaims);
		}
		return this._defaultClaimsCheck(idTokenClaims, uiClaims);
	}

	// =======================================================================
	// Private: Auth server management
	// =======================================================================

	private async _ensureAuthServer(): Promise<void> {
		if (this._authServer) return;
		if (this._canConstructManually()) {
			this._authServer = this._constructManualAuthServer();
			return;
		}
		await this.discover();
	}

	private _canConstructManually(): boolean {
		const c = this._config;
		return !!(c.authorizationEndpoint && c.tokenEndpoint && c.issuer);
	}

	private _constructManualAuthServer(): AuthorizationServer {
		const c = this._config;
		return {
			issuer: c.issuer,
			authorization_endpoint: c.authorizationEndpoint,
			token_endpoint: c.tokenEndpoint,
			...(c.userinfoEndpoint && {
				userinfo_endpoint: c.userinfoEndpoint,
			}),
			...(c.revocationEndpoint && {
				revocation_endpoint: c.revocationEndpoint,
			}),
			...(c.jwksUri && { jwks_uri: c.jwksUri }),
			...(c.tokenEndpointAuthMethodsSupported?.length && {
				token_endpoint_auth_methods_supported:
					c.tokenEndpointAuthMethodsSupported,
			}),
			...(c.idTokenSigningAlgValuesSupported?.length && {
				id_token_signing_alg_values_supported:
					c.idTokenSigningAlgValuesSupported,
			}),
			...(c.userinfoSigningAlgValuesSupported?.length && {
				userinfo_signing_alg_values_supported:
					c.userinfoSigningAlgValuesSupported,
			}),
		};
	}

	private _requireAuthServer(method: string): AuthorizationServer {
		if (!this._authServer) {
			throw new Error(
				`FrontendOidcModeClient: call discover() or authorizeUrl() before ${method}()`,
			);
		}
		return this._authServer;
	}

	private _applyEndpointOverrides(
		server: AuthorizationServer,
	): AuthorizationServer {
		return {
			...server,
			...(this._config.authorizationEndpoint && {
				authorization_endpoint: this._config.authorizationEndpoint,
			}),
			...(this._config.tokenEndpoint && {
				token_endpoint: this._config.tokenEndpoint,
			}),
			...(this._config.userinfoEndpoint && {
				userinfo_endpoint: this._config.userinfoEndpoint,
			}),
			...(this._config.revocationEndpoint && {
				revocation_endpoint: this._config.revocationEndpoint,
			}),
			...(this._config.tokenEndpointAuthMethodsSupported?.length && {
				token_endpoint_auth_methods_supported:
					this._config.tokenEndpointAuthMethodsSupported,
			}),
			...(this._config.idTokenSigningAlgValuesSupported?.length && {
				id_token_signing_alg_values_supported:
					this._config.idTokenSigningAlgValuesSupported,
			}),
			...(this._config.userinfoSigningAlgValuesSupported?.length && {
				userinfo_signing_alg_values_supported:
					this._config.userinfoSigningAlgValuesSupported,
			}),
		};
	}

	// =======================================================================
	// Private: Token normalization + validation
	// =======================================================================

	private _normalizeTokenResponse(
		result: TokenEndpointResponse,
	): FrontendOidcModeTokenResult {
		const tokenResult: FrontendOidcModeTokenResult = {
			accessToken: result.access_token,
			idToken: result.id_token,
			refreshToken: result.refresh_token,
		};

		if (result.expires_in !== undefined) {
			const expiresAtMs = this._runtime.clock.now() + result.expires_in * 1000;
			tokenResult.expiresAt = new Date(expiresAtMs).toISOString();
		}

		if (typeof result.scope === "string") {
			tokenResult.grantedScopes = result.scope.split(" ");
		}

		return tokenResult;
	}

	private _validateRequiredScopes(grantedScopes: string[] | undefined): void {
		if (!this._config.requiredScopes?.length) return;
		const granted = new Set(grantedScopes ?? []);
		const missing = this._config.requiredScopes.filter((s) => !granted.has(s));
		if (missing.length > 0) {
			throw new Error(
				`FrontendOidcModeClient: token response is missing required scopes: ${missing.join(", ")}`,
			);
		}
	}

	private _tokenResultToTokenSnapshot(tokens: FrontendOidcModeTokenResult) {
		return {
			accessToken: tokens.accessToken,
			idToken: tokens.idToken,
			refreshMaterial: tokens.refreshToken,
			accessTokenExpiresAt: tokens.expiresAt,
		};
	}

	// =======================================================================
	// Private: Claims check
	// =======================================================================

	private async _performClaimsCheck(
		tokens: FrontendOidcModeTokenResult,
	): Promise<AuthStateMetadataSnapshot> {
		if (!tokens.idToken) {
			return {};
		}

		let userInfoClaims: Record<string, unknown> | null = null;
		if (this._authServer?.userinfo_endpoint) {
			try {
				const userInfo = await this.fetchUserInfoRaw(tokens.accessToken);
				userInfoClaims = userInfo.claims ?? null;
			} catch {
				this._runtime.logger?.log({
					level: LogLevel.Warn,
					message:
						"Failed to fetch userInfo during claims check, continuing with id_token claims only",
					scope: TRACE_SCOPE,
				});
			}
		}

		const claimsResult = await this.checkClaims(tokens.idToken, userInfoClaims);

		if (!claimsResult.success) {
			throw new ClientError({
				kind: ClientErrorKind.Authorization,
				message: `Claims check failed: ${claimsResult.error ?? "unknown reason"}`,
				code: "frontend_oidc.claims_check_failed",
				source: TRACE_SCOPE,
			});
		}

		return {
			principal: {
				subject: String(decodeJwtPayload(tokens.idToken).sub ?? ""),
				displayName: claimsResult.displayName,
				picture: claimsResult.picture,
				claims: claimsResult.claims,
			},
			source: {
				kind: "oidc_authorization_code",
				providerId: this._config.issuer,
			},
		};
	}

	private async _executeClaimsCheckScript(
		script: FrontendOidcModeClaimsCheckScript,
		idTokenClaims: Record<string, unknown>,
		userInfoClaims: Record<string, unknown> | null,
	): Promise<FrontendOidcModeClaimsCheckResult> {
		if (script.type !== "inline") {
			throw new Error(
				`FrontendOidcModeClient: unsupported claims check script type: ${(script as { type: string }).type}`,
			);
		}

		const compatScript = transformScriptForBrowser(script.content);

		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
		const fn = new AsyncFunction(
			"__idTokenClaims",
			"__userInfoClaims",
			`
			var __exports = {};
			${compatScript}
			var __fn = __exports.default;
			if (typeof __fn !== 'function') {
				throw new Error('No default export function found in the claims check script');
			}
			return await __fn(__idTokenClaims, __userInfoClaims);
			`,
		);

		const raw = await fn(idTokenClaims, userInfoClaims);

		if (raw && raw.success === true) {
			return {
				success: true,
				displayName: raw.display_name ?? raw.displayName ?? "",
				picture: raw.picture,
				claims: raw.claims ?? {},
			};
		}
		return {
			success: false,
			error: raw?.error ?? "Claims check script rejected the claims",
			claims: raw?.claims,
		};
	}

	private _defaultClaimsCheck(
		idTokenClaims: Record<string, unknown>,
		userInfoClaims: Record<string, unknown> | null,
	): FrontendOidcModeClaimsCheckResult {
		const displayName =
			this._pickClaim<string>(
				userInfoClaims,
				idTokenClaims,
				"preferred_username",
			) ??
			this._pickClaim<string>(userInfoClaims, idTokenClaims, "nickname") ??
			this._pickClaim<string>(userInfoClaims, idTokenClaims, "sub") ??
			"Unknown";

		const picture = this._pickClaim<string>(
			userInfoClaims,
			idTokenClaims,
			"picture",
		);

		const mergedClaims: Record<string, unknown> = {
			...idTokenClaims,
			...(userInfoClaims ?? {}),
		};

		return { success: true, displayName, picture, claims: mergedClaims };
	}

	private _pickClaim<T>(
		userInfo: Record<string, unknown> | null,
		idToken: Record<string, unknown>,
		key: string,
	): T | undefined {
		const val = (userInfo?.[key] ?? idToken[key]) as T | undefined;
		return val !== undefined && val !== null ? val : undefined;
	}

	// =======================================================================
	// Private: Pending state management (EphemeralFlowStore)
	// =======================================================================

	private _requirePendingStore(): EphemeralFlowStore<FrontendOidcModePendingState> {
		if (!this._pendingStore) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				message:
					"FrontendOidcModeClient requires runtime.sessionStore for redirect-based flows",
				code: "frontend_oidc.no_session_store",
				source: TRACE_SCOPE,
			});
		}
		return this._pendingStore;
	}

	private async _savePendingState(
		pending: FrontendOidcModePendingState,
	): Promise<void> {
		await this._requirePendingStore().save(pending);
	}

	private async _consumePendingState(): Promise<FrontendOidcModePendingState | null> {
		const pending = await this._requirePendingStore().consume();
		if (!pending) return null;
		if (this._runtime.clock.now() - pending.createdAt > PENDING_STATE_TTL_MS) {
			return null;
		}
		return pending;
	}

	// =======================================================================
	// Private: Metadata refresh
	// =======================================================================

	private _scheduleMetadataRefresh(): void {
		const intervalStr = this._config.metadataRefreshInterval;
		if (!intervalStr) return;
		const intervalMs = parseDurationToMs(intervalStr);
		if (intervalMs <= 0) return;

		this._cancelMetadataRefresh();

		this._metadataRefreshHandle = interval({
			scheduler: this._runtime.scheduler,
			periodMs: intervalMs,
			callback: () => {
				if (this._rootCancellation.token.isCancellationRequested) return;
				this.discover()
					.then(() => {
						this._recordTrace("frontend_oidc.metadata.refreshed");
					})
					.catch((error) => {
						this._recordFailureTrace(
							"frontend_oidc.metadata.refresh_failed",
							error,
						);
					});
			},
		});
	}

	private _cancelMetadataRefresh(): void {
		if (!this._metadataRefreshHandle) return;
		this._metadataRefreshHandle.cancel();
		this._metadataRefreshHandle = null;
	}
}

// ---------------------------------------------------------------------------
// Factory function (backward-compatible)
// ---------------------------------------------------------------------------

/**
 * Create a frontend OIDC mode client.
 *
 * Prefer `new FrontendOidcModeClient(config, runtime)` for consistency with
 * `BackendOidcModeClient`.
 */
export function createFrontendOidcModeClient(
	config: FrontendOidcModeClientConfig,
	runtime: ClientRuntime,
): FrontendOidcModeClient {
	return new FrontendOidcModeClient(config, runtime);
}

// ---------------------------------------------------------------------------
// Popup callback relay helper
// ---------------------------------------------------------------------------

/**
 * Relay the frontend-oidc popup callback result back to the opener window.
 *
 * Call this from the popup callback page. It posts the full callback URL
 * (including query parameters with code and state) back to the opener
 * and closes the popup.
 *
 * @example
 * ```html
 * <script type="module">
 *   import { relayFrontendOidcPopupCallback } from "@securitydept/token-set-context-client/frontend-oidc-mode";
 *   relayFrontendOidcPopupCallback();
 * </script>
 * ```
 */
export function relayFrontendOidcPopupCallback(options?: {
	targetOrigin?: string;
}): void {
	relayPopupCallback({
		payload: window.location.href,
		targetOrigin: options?.targetOrigin,
	});
}
