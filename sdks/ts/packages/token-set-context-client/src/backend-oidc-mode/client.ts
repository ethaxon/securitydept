import type {
	CancelableHandle,
	CancellationTokenSourceTrait,
	CancellationTokenTrait,
	ClientRuntime,
	ReadableSignalTrait,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createCancellationTokenSource,
	createLinkedCancellationToken,
	createSignal,
	LogLevel,
	readonlySignal,
} from "@securitydept/client";
import { createAuthMaterialController } from "../orchestration/index";
import type {
	BackendOidcModeMetadataRedemptionResponse,
	BackendOidcModeUserInfoResponse,
} from "./contracts";
import {
	callbackFragmentToTokenSnapshot,
	parseBackendOidcModeCallbackFragment,
	parseBackendOidcModeRefreshFragment,
	refreshFragmentToTokenDelta,
} from "./parsers";
import type {
	AuthStateMetadataSnapshot,
	AuthStateSnapshot,
	BackendOidcModeClientConfig,
} from "./types";
import {
	BackendOidcModeContextSource,
	BackendOidcModeStateRestoreSourceKind,
} from "./types";

const DEFAULT_LOGIN_PATH = "/auth/token-set/login";
const DEFAULT_REFRESH_PATH = "/auth/token-set/refresh";
const DEFAULT_METADATA_REDEEM_PATH = "/auth/token-set/metadata/redeem";
const DEFAULT_USER_INFO_PATH = "/auth/token-set/user-info";
const DEFAULT_REFRESH_WINDOW_MS = 60_000;
const DEFAULT_PERSISTENCE_KEY_PREFIX = "securitydept.token_set_context";
const TRACE_SCOPE = "token-set-context";
const TRACE_SOURCE = BackendOidcModeContextSource.Client;
// Maximum single setTimeout slice (30 minutes) — avoids platform timer overflow.
const MAX_SCHEDULE_SLICE_MS = 30 * 60 * 1000;
const BackendOidcModeRefreshTriggerKind = {
	Immediate: "immediate",
	Slice: "slice",
	Deadline: "deadline",
} as const;

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
export class BackendOidcModeClient {
	private readonly _authMaterial;
	private readonly _stateSignal = createSignal<AuthStateSnapshot | null>(null);
	private readonly _baseUrl: string;
	private readonly _loginPath: string;
	private readonly _refreshPath: string;
	private readonly _metadataRedeemPath: string;
	private readonly _userInfoPath: string;
	private readonly _refreshWindowMs: number;
	private readonly _defaultPostAuthRedirectUri?: string;
	private readonly _runtime: ClientRuntime;
	private readonly _rootCancellation: CancellationTokenSourceTrait =
		createCancellationTokenSource();
	private _refreshHandle: CancelableHandle | null = null;
	private _disposed = false;

	/** Read-only signal exposing the current auth state snapshot. */
	readonly state: ReadableSignalTrait<AuthStateSnapshot | null>;

	constructor(config: BackendOidcModeClientConfig, runtime: ClientRuntime) {
		this._baseUrl = config.baseUrl.replace(/\/+$/, "");
		this._loginPath = config.loginPath ?? DEFAULT_LOGIN_PATH;
		this._refreshPath = config.refreshPath ?? DEFAULT_REFRESH_PATH;
		this._metadataRedeemPath =
			config.metadataRedeemPath ?? DEFAULT_METADATA_REDEEM_PATH;
		this._userInfoPath = config.userInfoPath ?? DEFAULT_USER_INFO_PATH;
		this._refreshWindowMs = config.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
		this._defaultPostAuthRedirectUri = config.defaultPostAuthRedirectUri;
		this._runtime = runtime;
		this._authMaterial = createAuthMaterialController(
			runtime.persistentStore !== undefined
				? {
						persistence: {
							store: runtime.persistentStore,
							key:
								config.persistentStateKey ??
								`${DEFAULT_PERSISTENCE_KEY_PREFIX}:v1:${this._baseUrl}`,
							now: () => this._runtime.clock.now(),
						},
					}
				: {},
		);
		this.state = readonlySignal(this._stateSignal);
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
	 * Handle a callback fragment from a redirect.
	 * Parses tokens, redeems metadata, persists state, and updates the auth signal.
	 */
	async handleCallback(fragment: string): Promise<AuthStateSnapshot> {
		this._recordTrace("token_set.callback.started");

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

			let metadata: AuthStateMetadataSnapshot = {};
			if (callbackFragment.metadataRedemptionId) {
				const redeemed = await this.redeemMetadata(
					callbackFragment.metadataRedemptionId,
				);
				if (redeemed) {
					metadata = redeemed.metadata as AuthStateMetadataSnapshot;
				}
			}

			this._throwIfNotOperational();

			const snapshot: AuthStateSnapshot = {
				tokens: callbackFragmentToTokenSnapshot(callbackFragment),
				metadata,
			};

			await this._applySnapshot(snapshot);

			this._runtime.logger?.log({
				level: LogLevel.Info,
				message: "Auth state initialized from callback",
				scope: TRACE_SCOPE,
			});

			this._recordTrace("token_set.callback.succeeded", {
				hasMetadataRedemption:
					callbackFragment.metadataRedemptionId !== undefined,
				persisted: this._authMaterial.persistence !== null,
			});

			return snapshot;
		} catch (error) {
			this._recordFailureTrace("token_set.callback.failed", error);
			throw error;
		}
	}

	/** Manually set auth state (e.g. from persisted storage or SSR bootstrap). */
	restoreState(snapshot: AuthStateSnapshot): void {
		this._throwIfNotOperational();
		this._authMaterial.injectSnapshot(snapshot);
		this._stateSignal.set(snapshot);
		this._scheduleRefresh();
		this._recordTrace("token_set.state.restored", {
			sourceKind: BackendOidcModeStateRestoreSourceKind.Manual,
		});
	}

	/** Restore auth state from `runtime.persistentStore` when available. */
	async restorePersistedState(): Promise<AuthStateSnapshot | null> {
		this._throwIfNotOperational();

		if (!this._authMaterial.persistence) {
			return null;
		}

		let snapshot: AuthStateSnapshot | null;
		try {
			snapshot = await this._authMaterial.restoreFromPersistence();
		} catch (error) {
			let cleared = false;
			try {
				await this._authMaterial.persistence.clear();
				cleared = true;
			} catch (clearError) {
				this._runtime.logger?.log({
					level: LogLevel.Warn,
					message: "Failed to clear invalid persisted token-set state",
					scope: TRACE_SCOPE,
					code: "token_set.persistence.clear_failed",
					attributes: describeError(clearError),
				});
			}

			this._runtime.logger?.log({
				level: LogLevel.Warn,
				message: "Discarded invalid persisted token-set state",
				scope: TRACE_SCOPE,
				code: "token_set.persistence.discarded",
				attributes: {
					cleared,
					...describeError(error),
				},
			});
			this._recordFailureTrace("token_set.state.restore_discarded", error, {
				cleared,
			});
			return null;
		}

		this._throwIfNotOperational();

		if (!snapshot) {
			return null;
		}

		this._stateSignal.set(snapshot);
		this._scheduleRefresh();
		this._recordTrace("token_set.state.restored", {
			sourceKind: BackendOidcModeStateRestoreSourceKind.PersistentStore,
		});

		return snapshot;
	}

	/** Explicitly clear persisted auth state without disposing the client. */
	async clearPersistedState(): Promise<void> {
		if (!this._authMaterial.persistence) {
			return;
		}

		await this._authMaterial.persistence.clear();
	}

	/** Clear current in-memory auth state and optionally persisted state. */
	async clearState(options: { clearPersisted?: boolean } = {}): Promise<void> {
		this._throwIfNotOperational();

		this._cancelRefresh("clear_state");
		await this._authMaterial.clearState(options);
		this._stateSignal.set(null);

		this._recordTrace("token_set.state.cleared", {
			clearPersisted: options.clearPersisted ?? true,
		});
	}

	/**
	 * Attempt to refresh the current token set.
	 *
	 * Protocol: The server's refresh endpoint responds with a 302 redirect
	 * whose Location header contains a URL with token data in the fragment.
	 */
	async refresh(options?: {
		cancellationToken?: CancellationTokenTrait;
	}): Promise<AuthStateSnapshot | null> {
		const current = this._authMaterial.snapshot;
		if (!current?.tokens.refreshMaterial) {
			return null;
		}

		this._recordTrace("token_set.refresh.started", {
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

			if (response.status === 302 || response.status === 303) {
				const location = response.headers.location;
				if (!location) {
					throw new ClientError({
						kind: ClientErrorKind.Protocol,
						message: "Refresh redirect missing Location header",
						code: "refresh.missing_location",
						source: TRACE_SCOPE,
					});
				}

				const fragmentIndex = location.indexOf("#");
				if (fragmentIndex === -1) {
					throw new ClientError({
						kind: ClientErrorKind.Protocol,
						message: "Refresh redirect Location has no fragment",
						code: "refresh.missing_fragment",
						source: TRACE_SCOPE,
					});
				}

				const fragment = location.substring(fragmentIndex + 1);
				const refreshFragment = parseBackendOidcModeRefreshFragment(fragment);
				if (!refreshFragment) {
					throw new ClientError({
						kind: ClientErrorKind.Protocol,
						message: "Refresh fragment missing access_token",
						code: "refresh.missing_access_token",
						source: TRACE_SCOPE,
					});
				}

				let metadata = current.metadata;
				if (refreshFragment.metadataRedemptionId) {
					const redeemed = await this.redeemMetadata(
						refreshFragment.metadataRedemptionId,
					);
					if (redeemed) {
						metadata = redeemed.metadata as AuthStateMetadataSnapshot;
					}
				}

				this._throwIfNotOperational();

				const newSnapshot = await this._authMaterial.applyDelta(
					refreshFragmentToTokenDelta(refreshFragment),
					{ metadata },
				);
				this._stateSignal.set(newSnapshot);
				this._scheduleRefresh();

				this._runtime.logger?.log({
					level: LogLevel.Info,
					message: "Token refreshed successfully",
					scope: TRACE_SCOPE,
				});

				this._recordTrace("token_set.refresh.succeeded", {
					hasMetadataRedemption:
						refreshFragment.metadataRedemptionId !== undefined,
					persisted: this._authMaterial.persistence !== null,
				});

				return newSnapshot;
			}

			throw ClientError.fromHttpResponse(response.status, response.body);
		} catch (error) {
			this._recordFailureTrace("token_set.refresh.failed", error);
			throw error;
		}
	}

	/** Get the current bearer authorization header value. */
	authorizationHeader(): string | null {
		return this._authMaterial.authorizationHeader;
	}

	/** Redeem metadata from the server by redemption ID. */
	async redeemMetadata(
		redemptionId: string,
		options?: { cancellationToken?: CancellationTokenTrait },
	): Promise<BackendOidcModeMetadataRedemptionResponse | null> {
		this._recordTrace("token_set.metadata_redemption.started", {
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
				this._recordTrace("token_set.metadata_redemption.succeeded", {
					redemptionId,
					found: true,
				});
				return response.body as BackendOidcModeMetadataRedemptionResponse;
			}

			if (response.status === 404) {
				this._recordTrace("token_set.metadata_redemption.succeeded", {
					redemptionId,
					found: false,
				});
				return null;
			}

			throw ClientError.fromHttpResponse(response.status, response.body);
		} catch (error) {
			this._recordFailureTrace("token_set.metadata_redemption.failed", error, {
				redemptionId,
			});
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
		this._recordTrace("token_set.user_info.started");

		try {
			this._throwIfNotOperational();

			const current = this._authMaterial.snapshot;
			if (!current?.tokens.accessToken || !current.tokens.idToken) {
				throw new ClientError({
					kind: ClientErrorKind.Unauthenticated,
					message: "Cannot fetch user info without access_token and id_token",
					code: "token_set.user_info.unauthenticated",
					source: TRACE_SCOPE,
				});
			}

			const response = await this._runtime.transport.execute({
				url: this._baseUrl + this._userInfoPath,
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${current.tokens.accessToken}`,
				},
				body: JSON.stringify({
					id_token: current.tokens.idToken,
				}),
				cancellationToken: createLinkedCancellationToken(
					...(options?.cancellationToken
						? [this._rootCancellation.token, options.cancellationToken]
						: [this._rootCancellation.token]),
				),
			});

			this._throwIfNotOperational();

			if (response.status === 200 && response.body) {
				this._recordTrace("token_set.user_info.succeeded");
				return response.body as BackendOidcModeUserInfoResponse;
			}

			throw ClientError.fromHttpResponse(response.status, response.body);
		} catch (error) {
			this._recordFailureTrace("token_set.user_info.failed", error);
			throw error;
		}
	}

	/** Cancel any pending refresh and release client resources. */
	dispose(): void {
		if (this._disposed) {
			return;
		}

		this._disposed = true;
		this._cancelRefresh("dispose");
		this._rootCancellation.cancel(
			new ClientError({
				kind: ClientErrorKind.Cancelled,
				code: "token_set.client_disposed",
				message: "BackendOidcModeClient was disposed",
				source: TRACE_SCOPE,
			}),
		);
		this._stateSignal.set(null);
		this._recordTrace("token_set.disposed");
	}

	// --- Private helpers ---

	private async _applySnapshot(snapshot: AuthStateSnapshot): Promise<void> {
		await this._authMaterial.applySnapshot(snapshot);
		this._stateSignal.set(snapshot);
		this._scheduleRefresh();
	}

	private _throwIfNotOperational(): void {
		if (this._disposed) {
			this._rootCancellation.token.throwIfCancellationRequested();
		}

		this._rootCancellation.token.throwIfCancellationRequested();
	}

	private _scheduleRefresh(): void {
		if (this._rootCancellation.token.isCancellationRequested) {
			return;
		}

		this._cancelRefresh("reschedule");

		const current = this._authMaterial.snapshot;
		if (
			!current?.tokens.accessTokenExpiresAt ||
			!current.tokens.refreshMaterial
		) {
			return;
		}

		const expiresAt = new Date(current.tokens.accessTokenExpiresAt).getTime();
		const refreshAt = expiresAt - this._refreshWindowMs;
		const now = this._runtime.clock.now();
		const remainingMs = refreshAt - now;

		if (remainingMs <= 0) {
			this._recordTrace("token_set.refresh.fired", {
				trigger: BackendOidcModeRefreshTriggerKind.Immediate,
			});
			this.refresh().catch(() => {});
			return;
		}

		const delayMs = Math.min(remainingMs, MAX_SCHEDULE_SLICE_MS);
		this._recordTrace("token_set.refresh.scheduled", {
			refreshAt,
			delayMs,
			remainingMs,
			segmented: delayMs < remainingMs,
		});

		this._refreshHandle = this._runtime.scheduler.setTimeout(delayMs, () => {
			if (this._rootCancellation.token.isCancellationRequested) {
				return;
			}

			const nextRemainingMs = refreshAt - this._runtime.clock.now();
			this._recordTrace("token_set.refresh.fired", {
				trigger:
					nextRemainingMs > 0
						? BackendOidcModeRefreshTriggerKind.Slice
						: BackendOidcModeRefreshTriggerKind.Deadline,
				remainingMs: Math.max(0, nextRemainingMs),
			});

			if (nextRemainingMs > 0) {
				this._scheduleRefresh();
				return;
			}

			this.refresh().catch(() => {});
		});
	}

	private _cancelRefresh(reason: string): void {
		if (!this._refreshHandle) {
			return;
		}

		this._refreshHandle.cancel();
		this._refreshHandle = null;
		this._recordTrace("token_set.refresh.cancelled", {
			reason,
		});
	}

	private _recordTrace(
		type: string,
		attributes?: Record<string, unknown>,
	): void {
		this._runtime.traceSink?.record({
			type,
			at: this._runtime.clock.now(),
			scope: TRACE_SCOPE,
			source: TRACE_SOURCE,
			attributes,
		});
	}

	private _recordFailureTrace(
		type: string,
		error: unknown,
		attributes?: Record<string, unknown>,
	): void {
		this._recordTrace(type, {
			...attributes,
			...describeError(error),
		});
	}
}

function describeError(error: unknown): Record<string, unknown> {
	if (
		typeof error === "object" &&
		error !== null &&
		"kind" in error &&
		"code" in error &&
		"recovery" in error
	) {
		const clientError = error as Pick<
			ClientError,
			"kind" | "code" | "recovery"
		>;
		return {
			errorKind: clientError.kind,
			errorCode: clientError.code,
			recovery: clientError.recovery,
		};
	}

	if (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		"message" in error
	) {
		const genericError = error as Pick<Error, "name" | "message">;
		return {
			errorName: genericError.name,
			errorMessage: genericError.message,
		};
	}

	return {
		errorValue: String(error),
	};
}
