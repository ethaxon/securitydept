import type {
	CancellationTokenTrait,
	ClientRuntime,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createLinkedCancellationToken,
	LogLevel,
} from "@securitydept/client";
import { BaseOidcModeClient } from "../orchestration/index";
import type {
	BackendOidcModeMetadataRedemptionResponse,
	BackendOidcModeUserInfoResponse,
} from "./contracts";
import {
	callbackReturnsToTokenSnapshot,
	parseBackendOidcModeCallbackBody,
	parseBackendOidcModeCallbackFragment,
	parseBackendOidcModeRefreshBody,
	refreshReturnsToTokenDelta,
} from "./parsers";
import type {
	AuthStateMetadataSnapshot,
	AuthStateSnapshot,
	BackendOidcModeClientConfig,
} from "./types";
import { BackendOidcModeContextSource } from "./types";

const DEFAULT_LOGIN_PATH = "/auth/oidc/login";
const DEFAULT_REFRESH_PATH = "/auth/oidc/refresh";
const DEFAULT_METADATA_REDEEM_PATH = "/auth/oidc/metadata/redeem";
const DEFAULT_USER_INFO_PATH = "/auth/oidc/user-info";
const DEFAULT_REFRESH_WINDOW_MS = 60_000;
const DEFAULT_PERSISTENCE_KEY_PREFIX = "securitydept.backend_oidc";
const TRACE_SCOPE = "backend-oidc-mode";
const TRACE_SOURCE = BackendOidcModeContextSource.Client;
const TRACE_PREFIX = "backend_oidc";

/**
 * Backend OIDC Mode Client.
 *
 * Manages token-set authentication including:
 * - Callback fragment parsing from redirect
 * - Metadata redemption
 * - In-memory auth state signal
 * - Deadline-based refresh scheduling
 * - Runtime-backed trace and persistence integration
 * - Bearer header construction
 */
export class BackendOidcModeClient extends BaseOidcModeClient {
	private readonly _baseUrl: string;
	private readonly _loginPath: string;
	private readonly _refreshPath: string;
	private readonly _metadataRedeemPath: string;
	private readonly _userInfoPath: string;
	private readonly _defaultPostAuthRedirectUri?: string;

	constructor(config: BackendOidcModeClientConfig, runtime: ClientRuntime) {
		const baseUrl = config.baseUrl.replace(/\/+$/, "");
		super({
			runtime,
			refreshWindowMs: config.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS,
			traceScope: TRACE_SCOPE,
			traceSource: TRACE_SOURCE,
			tracePrefix: TRACE_PREFIX,
			clientName: "BackendOidcModeClient",
			persistence: runtime.persistentStore
				? {
						store: runtime.persistentStore,
						key:
							config.persistentStateKey ??
							`${DEFAULT_PERSISTENCE_KEY_PREFIX}:v1:${baseUrl}`,
					}
				: undefined,
		});

		this._baseUrl = baseUrl;
		this._loginPath = config.loginPath ?? DEFAULT_LOGIN_PATH;
		this._refreshPath = config.refreshPath ?? DEFAULT_REFRESH_PATH;
		this._metadataRedeemPath =
			config.metadataRedeemPath ?? DEFAULT_METADATA_REDEEM_PATH;
		this._userInfoPath = config.userInfoPath ?? DEFAULT_USER_INFO_PATH;
		this._defaultPostAuthRedirectUri = config.defaultPostAuthRedirectUri;
	}

	/** Build the login/authorize URL with optional post-auth redirect. */
	authorizeUrl(postAuthRedirectUri?: string): string {
		const base = this._baseUrl + this._loginPath;
		const effectiveRedirectUri =
			postAuthRedirectUri ?? this._defaultPostAuthRedirectUri;
		if (effectiveRedirectUri) {
			const params = new URLSearchParams({
				post_auth_redirect_uri: effectiveRedirectUri,
			});
			return `${base}?${params.toString()}`;
		}
		return base;
	}

	/**
	 * Handle a callback fragment from a redirect (fragment-redirect flow).
	 *
	 * Parses tokens, redeems metadata if a redemption ID is present, persists
	 * state, and updates the auth signal. Inline metadata (from
	 * `callback_body_return` servers) is used directly, skipping redemption.
	 */
	async handleCallback(fragment: string): Promise<AuthStateSnapshot> {
		this._recordTrace("backend_oidc.callback.started");

		try {
			this._throwIfNotOperational();

			const callbackFragment = parseBackendOidcModeCallbackFragment(fragment);
			if (!callbackFragment) {
				throw new ClientError({
					kind: ClientErrorKind.Protocol,
					message: "Callback fragment missing access_token or id_token",
					code: "callback.missing_access_token",
					source: TRACE_SCOPE,
				});
			}

			// Resolve metadata: inline → redemption → userInfo fallback.
			const tokenSnapshot = callbackReturnsToTokenSnapshot(callbackFragment);
			const metadata = await this._resolveMetadata({
				inlineMetadata: callbackFragment.metadata,
				metadataRedemptionId: callbackFragment.metadataRedemptionId,
				baseMetadata: {},
				// idToken is always present in a callback fragment.
				accessToken: tokenSnapshot.accessToken,
				idToken: tokenSnapshot.idToken,
			});

			this._throwIfNotOperational();

			const snapshot: AuthStateSnapshot = {
				tokens: tokenSnapshot,
				metadata,
			};

			await this._applySnapshot(snapshot);

			this._runtime.logger?.log({
				level: LogLevel.Info,
				message: "Auth state initialized from callback",
				scope: TRACE_SCOPE,
			});

			this._recordTrace("backend_oidc.callback.succeeded", {
				hasMetadataRedemption:
					callbackFragment.metadataRedemptionId !== undefined,
				hasInlineMetadata: callbackFragment.metadata !== undefined,
				hasUserInfoFallback:
					!callbackFragment.metadata && !callbackFragment.metadataRedemptionId,
				persisted: this._authMaterial.persistence !== null,
			});

			return snapshot;
		} catch (error) {
			this._recordFailureTrace("backend_oidc.callback.failed", error);
			throw error;
		}
	}

	/**
	 * Handle a callback from a JSON body response (body-return flow).
	 *
	 * Unlike {@link handleCallback}, this method accepts the parsed JSON object
	 * from a `callback_body_return` (200 OK) response:
	 *
	 * - Metadata is embedded inline — no redemption round-trip
	 * - No URL fragment parsing
	 *
	 * Use this when the server uses `callback_body_return` and the client
	 * receives the JSON body directly (e.g. in a single-page app that POSTs
	 * the code to the backend and reads the 200 OK response).
	 */
	async handleCallbackBody(
		body: Record<string, unknown>,
	): Promise<AuthStateSnapshot> {
		this._recordTrace("backend_oidc.callback.started");

		try {
			this._throwIfNotOperational();

			const callbackBody = parseBackendOidcModeCallbackBody(body);
			if (!callbackBody) {
				throw new ClientError({
					kind: ClientErrorKind.Protocol,
					message: "Callback response body missing access_token or id_token",
					code: "backend_oidc.callback.missing_access_token",
					source: TRACE_SCOPE,
				});
			}

			// Resolve metadata: inline → redemption → userInfo fallback.
			const cbTokenSnapshot = callbackReturnsToTokenSnapshot(callbackBody);
			const metadata = await this._resolveMetadata({
				inlineMetadata: callbackBody.metadata,
				metadataRedemptionId: callbackBody.metadataRedemptionId,
				baseMetadata: {},
				accessToken: cbTokenSnapshot.accessToken,
				idToken: cbTokenSnapshot.idToken,
			});

			this._throwIfNotOperational();

			const snapshot: AuthStateSnapshot = {
				tokens: cbTokenSnapshot,
				metadata,
			};

			await this._applySnapshot(snapshot);

			this._runtime.logger?.log({
				level: LogLevel.Info,
				message: "Auth state initialized from callback body",
				scope: TRACE_SCOPE,
			});

			this._recordTrace("backend_oidc.callback.succeeded", {
				hasMetadataRedemption: callbackBody.metadataRedemptionId !== undefined,
				hasInlineMetadata: callbackBody.metadata !== undefined,
				hasUserInfoFallback:
					!callbackBody.metadata && !callbackBody.metadataRedemptionId,
				persisted: this._authMaterial.persistence !== null,
			});

			return snapshot;
		} catch (error) {
			this._recordFailureTrace("backend_oidc.callback.failed", error);
			throw error;
		}
	}

	/**
	 * Attempt to refresh the current token set.
	 *
	 * Protocol: The server's `refresh_body_return` endpoint responds with
	 * 200 OK and a JSON body containing the token delta. This avoids the
	 * 302 → fragment pattern that fetch() cannot follow across domains.
	 */
	async refresh(options?: {
		cancellationToken?: CancellationTokenTrait;
	}): Promise<AuthStateSnapshot | null> {
		const current = this._authMaterial.snapshot;
		if (!current?.tokens.refreshMaterial) {
			return null;
		}

		this._recordTrace("backend_oidc.refresh.started", {
			hasIdToken: current.tokens.idToken !== undefined,
		});

		try {
			this._throwIfNotOperational();

			const response = await this._runtime.transport.execute({
				url: this._baseUrl + this._refreshPath,
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					refresh_token: current.tokens.refreshMaterial,
					post_auth_redirect_uri: this._defaultPostAuthRedirectUri,
					id_token: current.tokens.idToken,
					current_metadata_snapshot: current.metadata,
				}),
				cancellationToken: createLinkedCancellationToken(
					...(options?.cancellationToken
						? [this._rootCancellation.token, options.cancellationToken]
						: [this._rootCancellation.token]),
				),
			});

			this._throwIfNotOperational();

			if (response.status === 200 && response.body) {
				const refreshBody = parseBackendOidcModeRefreshBody(
					response.body as Record<string, unknown>,
				);
				if (!refreshBody) {
					throw new ClientError({
						kind: ClientErrorKind.Protocol,
						message: "Refresh response body missing access_token",
						code: "backend_oidc.refresh.missing_access_token",
						source: TRACE_SCOPE,
					});
				}

				// Resolve metadata: inline → redemption → userInfo fallback.
				// For refresh the base is the current metadata snapshot (merge)
				// rather than empty.
				const metadata = await this._resolveMetadata({
					inlineMetadata: refreshBody.metadata
						? { ...current.metadata, ...refreshBody.metadata }
						: undefined,
					metadataRedemptionId: refreshBody.metadataRedemptionId,
					baseMetadata: current.metadata,
					accessToken: refreshBody.accessToken,
					idToken: refreshBody.idToken ?? current.tokens.idToken,
				});

				this._throwIfNotOperational();

				const newSnapshot = await this._authMaterial.applyDelta(
					refreshReturnsToTokenDelta(refreshBody),
					{ metadata },
				);
				this._stateSignal.set(newSnapshot);
				this._scheduleRefresh();

				this._runtime.logger?.log({
					level: LogLevel.Info,
					message: "Token refreshed successfully",
					scope: TRACE_SCOPE,
				});

				this._recordTrace("backend_oidc.refresh.succeeded", {
					hasMetadataRedemption: refreshBody.metadataRedemptionId !== undefined,
					hasInlineMetadata: refreshBody.metadata !== undefined,
					hasUserInfoFallback:
						!refreshBody.metadata && !refreshBody.metadataRedemptionId,
					persisted: this._authMaterial.persistence !== null,
				});

				return newSnapshot;
			}

			throw ClientError.fromHttpResponse(response.status, response.body);
		} catch (error) {
			this._recordFailureTrace("backend_oidc.refresh.failed", error);
			throw error;
		}
	}

	/**
	 * Resolve auth-state metadata for a callback or refresh result.
	 *
	 * Resolution order (first match wins):
	 *
	 * 1. **Inline** — server embedded metadata directly in the response body.
	 * 2. **Redemption** — server returned a one-time redemption ID; fetch from
	 *    the metadata-redeem endpoint.
	 * 3. **UserInfo fallback** — neither inline metadata nor a redemption ID is
	 *    present; call `/user-info` and populate `metadata.principal` from the
	 *    response. This costs one extra request but guarantees that `principal`
	 *    is always populated after authentication.
	 */
	private async _resolveMetadata(opts: {
		/** Already-resolved inline metadata (skip all network calls). */
		inlineMetadata?: AuthStateMetadataSnapshot;
		/** One-time redemption ID from the response body. */
		metadataRedemptionId?: string;
		/** Starting metadata to merge into (e.g. current snapshot for refresh). */
		baseMetadata: AuthStateMetadataSnapshot;
		/** Access token to use for the userInfo fallback. */
		accessToken: string;
		/** ID token to include in the userInfo request body. */
		idToken?: string;
	}): Promise<AuthStateMetadataSnapshot> {
		const {
			inlineMetadata,
			metadataRedemptionId,
			baseMetadata,
			accessToken,
			idToken,
		} = opts;

		// Priority 1: inline metadata already present.
		if (inlineMetadata) {
			return inlineMetadata;
		}

		// Priority 2: one-time redemption ID.
		if (metadataRedemptionId) {
			const redeemed = await this.redeemMetadata(metadataRedemptionId);
			if (redeemed) {
				return redeemed.metadata as AuthStateMetadataSnapshot;
			}
		}

		// Priority 3: userInfo fallback — populate principal from /user-info.
		// We never call this if we already have a principal in baseMetadata,
		// to avoid a redundant request on servers that deliver metadata via
		// inline/redemption only on the first login.
		if (!baseMetadata.principal) {
			try {
				const userInfo = await this._fetchUserInfoRaw(accessToken, idToken);
				return {
					...baseMetadata,
					principal: {
						subject: userInfo.subject,
						displayName: userInfo.displayName,
						picture: userInfo.picture,
						issuer: userInfo.issuer,
						claims: userInfo.claims,
					},
				};
			} catch {
				// Best-effort: a failed userInfo call should not break the auth flow.
				this._runtime.logger?.log({
					level: LogLevel.Warn,
					message:
						"userInfo fallback failed; proceeding without principal metadata",
					scope: TRACE_SCOPE,
				});
			}
		}

		return baseMetadata;
	}

	/** Redeem metadata from the server by redemption ID. */
	async redeemMetadata(
		redemptionId: string,
		options?: { cancellationToken?: CancellationTokenTrait },
	): Promise<BackendOidcModeMetadataRedemptionResponse | null> {
		this._recordTrace("backend_oidc.metadata_redemption.started", {
			redemptionId,
		});

		try {
			this._throwIfNotOperational();

			const response = await this._runtime.transport.execute({
				url: this._baseUrl + this._metadataRedeemPath,
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					metadata_redemption_id: redemptionId,
				}),
				cancellationToken: createLinkedCancellationToken(
					...(options?.cancellationToken
						? [this._rootCancellation.token, options.cancellationToken]
						: [this._rootCancellation.token]),
				),
			});

			this._throwIfNotOperational();

			if (response.status === 200 && response.body) {
				this._recordTrace("backend_oidc.metadata_redemption.succeeded", {
					redemptionId,
					found: true,
				});
				return response.body as BackendOidcModeMetadataRedemptionResponse;
			}

			if (response.status === 404) {
				this._recordTrace("backend_oidc.metadata_redemption.succeeded", {
					redemptionId,
					found: false,
				});
				return null;
			}

			throw ClientError.fromHttpResponse(response.status, response.body);
		} catch (error) {
			this._recordFailureTrace(
				"backend_oidc.metadata_redemption.failed",
				error,
				{
					redemptionId,
				},
			);
			throw error;
		}
	}

	/**
	 * Exchange the current id_token + access_token for normalized user info.
	 *
	 * Protocol: POST /auth/token-set/user-info with Bearer access_token
	 * and JSON body `{ id_token }`. Returns the server-normalized user info.
	 */
	async fetchUserInfo(options?: {
		cancellationToken?: CancellationTokenTrait;
	}): Promise<BackendOidcModeUserInfoResponse> {
		this._recordTrace("backend_oidc.user_info.started");

		try {
			this._throwIfNotOperational();

			const current = this._authMaterial.snapshot;
			if (!current?.tokens.accessToken || !current.tokens.idToken) {
				throw new ClientError({
					kind: ClientErrorKind.Unauthenticated,
					message: "Cannot fetch user info without access_token and id_token",
					code: "backend_oidc.user_info.unauthenticated",
					source: TRACE_SCOPE,
				});
			}

			const result = await this._fetchUserInfoRaw(
				current.tokens.accessToken,
				current.tokens.idToken,
				options,
			);

			this._recordTrace("backend_oidc.user_info.succeeded");
			return result;
		} catch (error) {
			this._recordFailureTrace("backend_oidc.user_info.failed", error);
			throw error;
		}
	}

	/**
	 * Raw userInfo HTTP call — accepts explicit tokens rather than reading
	 * from current state. Used by `fetchUserInfo` and by `_resolveMetadata`
	 * as a best-effort fallback when no metadata is delivered with the token
	 * response.
	 */
	private async _fetchUserInfoRaw(
		accessToken: string,
		idToken?: string,
		options?: { cancellationToken?: CancellationTokenTrait },
	): Promise<BackendOidcModeUserInfoResponse> {
		const response = await this._runtime.transport.execute({
			url: this._baseUrl + this._userInfoPath,
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify({
				id_token: idToken,
			}),
			cancellationToken: createLinkedCancellationToken(
				...(options?.cancellationToken
					? [this._rootCancellation.token, options.cancellationToken]
					: [this._rootCancellation.token]),
			),
		});

		if (response.status === 200 && response.body) {
			return response.body as BackendOidcModeUserInfoResponse;
		}

		throw ClientError.fromHttpResponse(response.status, response.body);
	}
}
