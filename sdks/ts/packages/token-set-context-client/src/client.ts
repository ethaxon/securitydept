import type {
	CancelableHandle,
	CancellationTokenSourceTrait,
	ClientRuntime,
	ReadableSignalTrait,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createCancellationTokenSource,
	createSignal,
	LogLevel,
	readonlySignal,
} from "@securitydept/client";
import { mergeTokenDelta, parseTokenFragment } from "./fragment-parser";
import { createTokenSetStatePersistence } from "./persistence";
import type {
	AuthStateMetadataSnapshot,
	AuthStateSnapshot,
	MetadataRedemptionResponse,
	TokenSetContextClientConfig,
} from "./types";
import { TokenSetContextSource, TokenSetStateRestoreSourceKind } from "./types";

const DEFAULT_LOGIN_PATH = "/auth/token-set/login";
const DEFAULT_REFRESH_PATH = "/auth/token-set/refresh";
const DEFAULT_METADATA_REDEEM_PATH = "/auth/token-set/metadata/redeem";
const DEFAULT_REFRESH_WINDOW_MS = 60_000;
const DEFAULT_PERSISTENCE_KEY_PREFIX = "securitydept.token_set_context";
const TRACE_SCOPE = "token-set-context";
const TRACE_SOURCE = TokenSetContextSource.Client;
// Maximum single setTimeout slice (30 minutes) — avoids platform timer overflow.
const MAX_SCHEDULE_SLICE_MS = 30 * 60 * 1000;
const TokenSetRefreshTriggerKind = {
	Immediate: "immediate",
	Slice: "slice",
	Deadline: "deadline",
} as const;

/**
 * Token Set Context Client.
 *
 * Manages token-set authentication including:
 * - Callback fragment parsing from redirect
 * - Metadata redemption
 * - In-memory auth state signal
 * - Deadline-based refresh scheduling
 * - Runtime-backed trace and persistence integration
 * - Bearer header construction
 *
 * Current scope limitations:
 * - Refresh uses the server's redirect+fragment protocol: a POST is sent to
 *   the refresh endpoint, and the server responds with a 302 redirect whose
 *   Location header fragment contains the new token delta.
 * - Mixed-custody / token-family boundaries are not yet implemented.
 * - Transport-level abort integration is still transport-specific; cancellation
 *   currently guards client lifecycle and post-await state transitions.
 */
export class TokenSetContextClient {
	private readonly _state = createSignal<AuthStateSnapshot | null>(null);
	private readonly _baseUrl: string;
	private readonly _loginPath: string;
	private readonly _refreshPath: string;
	private readonly _metadataRedeemPath: string;
	private readonly _refreshWindowMs: number;
	private readonly _defaultPostAuthRedirectUri?: string;
	private readonly _runtime: ClientRuntime;
	private readonly _persistence: ReturnType<
		typeof createTokenSetStatePersistence
	> | null;
	private readonly _rootCancellation: CancellationTokenSourceTrait =
		createCancellationTokenSource();
	private _refreshHandle: CancelableHandle | null = null;
	private _disposed = false;

	/** Read-only signal exposing the current auth state snapshot. */
	readonly state: ReadableSignalTrait<AuthStateSnapshot | null>;

	constructor(config: TokenSetContextClientConfig, runtime: ClientRuntime) {
		this._baseUrl = config.baseUrl.replace(/\/+$/, "");
		this._loginPath = config.loginPath ?? DEFAULT_LOGIN_PATH;
		this._refreshPath = config.refreshPath ?? DEFAULT_REFRESH_PATH;
		this._metadataRedeemPath =
			config.metadataRedeemPath ?? DEFAULT_METADATA_REDEEM_PATH;
		this._refreshWindowMs = config.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
		this._defaultPostAuthRedirectUri = config.defaultPostAuthRedirectUri;
		this._runtime = runtime;
		this._persistence =
			this._runtime.persistentStore === undefined
				? null
				: createTokenSetStatePersistence({
						store: this._runtime.persistentStore,
						key:
							config.persistentStateKey ??
							`${DEFAULT_PERSISTENCE_KEY_PREFIX}:v1:${this._baseUrl}`,
						now: () => this._runtime.clock.now(),
					});
		this.state = readonlySignal(this._state);
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

			const parsed = parseTokenFragment(fragment);

			if (!parsed.tokens.accessToken) {
				throw new ClientError({
					kind: ClientErrorKind.Protocol,
					message: "Callback fragment missing access_token",
					code: "callback.missing_access_token",
					source: TRACE_SCOPE,
				});
			}

			let metadata: AuthStateMetadataSnapshot = {};
			if (parsed.metadataRedemptionId) {
				const redeemed = await this.redeemMetadata(parsed.metadataRedemptionId);
				if (redeemed) {
					metadata = redeemed.metadata as AuthStateMetadataSnapshot;
				}
			}

			this._throwIfNotOperational();

			const snapshot: AuthStateSnapshot = {
				tokens: parsed.tokens,
				metadata,
			};

			await this._persistSnapshot(snapshot);
			this._setState(snapshot);

			this._runtime.logger?.log({
				level: LogLevel.Info,
				message: "Auth state initialized from callback",
				scope: TRACE_SCOPE,
			});

			this._recordTrace("token_set.callback.succeeded", {
				hasMetadataRedemption: parsed.metadataRedemptionId !== undefined,
				persisted: this._persistence !== null,
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
		this._setState(snapshot);
		this._recordTrace("token_set.state.restored", {
			sourceKind: TokenSetStateRestoreSourceKind.Manual,
		});
	}

	/** Restore auth state from `runtime.persistentStore` when available. */
	async restorePersistedState(): Promise<AuthStateSnapshot | null> {
		this._throwIfNotOperational();

		if (!this._persistence) {
			return null;
		}

		let snapshot: AuthStateSnapshot | null;
		try {
			snapshot = await this._persistence.load();
		} catch (error) {
			let cleared = false;
			try {
				await this._persistence.clear();
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

		this._setState(snapshot);
		this._recordTrace("token_set.state.restored", {
			sourceKind: TokenSetStateRestoreSourceKind.PersistentStore,
		});

		return snapshot;
	}

	/** Explicitly clear persisted auth state without disposing the client. */
	async clearPersistedState(): Promise<void> {
		if (!this._persistence) {
			return;
		}

		await this._persistence.clear();
	}

	/** Clear current in-memory auth state and optionally persisted state. */
	async clearState(options: { clearPersisted?: boolean } = {}): Promise<void> {
		this._throwIfNotOperational();

		this._cancelRefresh("clear_state");
		this._state.set(null);

		const clearPersisted = options.clearPersisted ?? true;
		if (clearPersisted) {
			await this.clearPersistedState();
		}

		this._recordTrace("token_set.state.cleared", {
			clearPersisted,
		});
	}

	/**
	 * Attempt to refresh the current token set.
	 *
	 * Protocol: The server's refresh endpoint responds with a 302 redirect
	 * whose Location header contains a URL with token data in the fragment.
	 * The transport must NOT follow redirects automatically — the SDK
	 * extracts the fragment from the Location header directly.
	 */
	async refresh(): Promise<AuthStateSnapshot | null> {
		const current = this._state.get();
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
				cancellationToken: this._rootCancellation.token,
			});

			this._throwIfNotOperational();

			// The server responds with a redirect (302) containing token data
			// in the Location header's URL fragment.
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
				const parsed = parseTokenFragment(fragment);
				const merged = mergeTokenDelta(current.tokens, parsed.tokens);

				let metadata = current.metadata;
				if (parsed.metadataRedemptionId) {
					const redeemed = await this.redeemMetadata(
						parsed.metadataRedemptionId,
					);
					if (redeemed) {
						metadata = redeemed.metadata as AuthStateMetadataSnapshot;
					}
				}

				this._throwIfNotOperational();

				const newSnapshot: AuthStateSnapshot = {
					tokens: merged,
					metadata,
				};

				await this._persistSnapshot(newSnapshot);
				this._setState(newSnapshot);

				this._runtime.logger?.log({
					level: LogLevel.Info,
					message: "Token refreshed successfully",
					scope: TRACE_SCOPE,
				});

				this._recordTrace("token_set.refresh.succeeded", {
					hasMetadataRedemption: parsed.metadataRedemptionId !== undefined,
					persisted: this._persistence !== null,
				});

				return newSnapshot;
			}

			// Non-redirect response — error.
			throw ClientError.fromHttpResponse(response.status, response.body);
		} catch (error) {
			this._recordFailureTrace("token_set.refresh.failed", error);
			throw error;
		}
	}

	/** Get the current bearer authorization header value. */
	authorizationHeader(): string | null {
		const current = this._state.get();
		if (!current) {
			return null;
		}
		return `Bearer ${current.tokens.accessToken}`;
	}

	/** Redeem metadata from the server by redemption ID. */
	async redeemMetadata(
		redemptionId: string,
	): Promise<MetadataRedemptionResponse | null> {
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
				cancellationToken: this._rootCancellation.token,
			});

			this._throwIfNotOperational();

			if (response.status === 200 && response.body) {
				this._recordTrace("token_set.metadata_redemption.succeeded", {
					redemptionId,
					found: true,
				});
				return response.body as MetadataRedemptionResponse;
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
				message: "TokenSetContextClient was disposed",
				source: TRACE_SCOPE,
			}),
		);
		this._state.set(null);
		this._recordTrace("token_set.disposed");
	}

	// --- Private helpers ---

	private _setState(snapshot: AuthStateSnapshot): void {
		this._state.set(snapshot);
		this._scheduleRefresh();
	}

	private async _persistSnapshot(snapshot: AuthStateSnapshot): Promise<void> {
		if (!this._persistence) {
			return;
		}

		await this._persistence.save(snapshot);
	}

	private _throwIfNotOperational(): void {
		if (this._disposed) {
			this._rootCancellation.token.throwIfCancellationRequested();
		}

		this._rootCancellation.token.throwIfCancellationRequested();
	}

	/**
	 * Schedule the next refresh based on access_token_expires_at.
	 * Uses deadline-based segmented scheduling per the design guide:
	 * record the absolute deadline, then schedule slices capped at MAX_SCHEDULE_SLICE_MS.
	 */
	private _scheduleRefresh(): void {
		if (this._rootCancellation.token.isCancellationRequested) {
			return;
		}

		this._cancelRefresh("reschedule");

		const current = this._state.get();
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
				trigger: TokenSetRefreshTriggerKind.Immediate,
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
						? TokenSetRefreshTriggerKind.Slice
						: TokenSetRefreshTriggerKind.Deadline,
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
