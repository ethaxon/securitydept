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
// The orchestration controller manages state + persistence as a unit.
// BackendOidcMediatedModeClient builds on top of it for the generic lifecycle
// and handles token-set-specific concerns (callback, refresh scheduling) itself.
import { createAuthMaterialController } from "../orchestration/index";
import { parseTokenFragment } from "./fragment-parser";
import type {
	AuthStateMetadataSnapshot,
	AuthStateSnapshot,
	BackendOidcMediatedModeClientConfig,
	MetadataRedemptionResponse,
} from "./types";
import {
	BackendOidcMediatedModeContextSource,
	BackendOidcMediatedModeStateRestoreSourceKind,
} from "./types";

const DEFAULT_LOGIN_PATH = "/auth/oidc-mediated/login";
const DEFAULT_REFRESH_PATH = "/auth/oidc-mediated/refresh";
const DEFAULT_METADATA_REDEEM_PATH = "/auth/oidc-mediated/metadata/redeem";
const DEFAULT_REFRESH_WINDOW_MS = 60_000;
const DEFAULT_PERSISTENCE_KEY_PREFIX = "securitydept.token_set_context";
const TRACE_SCOPE = "token-set-context";
const TRACE_SOURCE = BackendOidcMediatedModeContextSource.Client;
// Maximum single setTimeout slice (30 minutes) — avoids platform timer overflow.
const MAX_SCHEDULE_SLICE_MS = 30 * 60 * 1000;
const BackendOidcMediatedModeRefreshTriggerKind = {
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
export class BackendOidcMediatedModeClient {
	// The orchestration controller owns state + persistence lifecycle.
	// token-set-specific concerns (callback fragment parsing, refresh scheduling)
	// are layered on top here and remain in the client.
	private readonly _authMaterial;
	// Internal signal bridges the controller's snapshot to a reactive signal,
	// because the controller uses a plain getter (no signal) for simplicity.
	private readonly _stateSignal = createSignal<AuthStateSnapshot | null>(null);
	private readonly _baseUrl: string;
	private readonly _loginPath: string;
	private readonly _refreshPath: string;
	private readonly _metadataRedeemPath: string;
	private readonly _refreshWindowMs: number;
	private readonly _defaultPostAuthRedirectUri?: string;
	private readonly _runtime: ClientRuntime;
	private readonly _rootCancellation: CancellationTokenSourceTrait =
		createCancellationTokenSource();
	private _refreshHandle: CancelableHandle | null = null;
	private _disposed = false;

	/** Read-only signal exposing the current auth state snapshot. */
	readonly state: ReadableSignalTrait<AuthStateSnapshot | null>;

	constructor(
		config: BackendOidcMediatedModeClientConfig,
		runtime: ClientRuntime,
	) {
		this._baseUrl = config.baseUrl.replace(/\/+$/, "");
		this._loginPath = config.loginPath ?? DEFAULT_LOGIN_PATH;
		this._refreshPath = config.refreshPath ?? DEFAULT_REFRESH_PATH;
		this._metadataRedeemPath =
			config.metadataRedeemPath ?? DEFAULT_METADATA_REDEEM_PATH;
		this._refreshWindowMs = config.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
		this._defaultPostAuthRedirectUri = config.defaultPostAuthRedirectUri;
		this._runtime = runtime;
		// Build the orchestration controller for generic state+persistence lifecycle.
		// The token-set client layers callback parsing & refresh scheduling on top.
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

			await this._applySnapshot(snapshot);

			this._runtime.logger?.log({
				level: LogLevel.Info,
				message: "Auth state initialized from callback",
				scope: TRACE_SCOPE,
			});

			this._recordTrace("token_set.callback.succeeded", {
				hasMetadataRedemption: parsed.metadataRedemptionId !== undefined,
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
		// Sync both the controller (bearer/refresh reads) and the reactive signal.
		this._authMaterial.injectSnapshot(snapshot);
		this._stateSignal.set(snapshot);
		this._scheduleRefresh();
		this._recordTrace("token_set.state.restored", {
			sourceKind: BackendOidcMediatedModeStateRestoreSourceKind.Manual,
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
			sourceKind: BackendOidcMediatedModeStateRestoreSourceKind.PersistentStore,
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
		// Delegate to the orchestration controller to clear state + (optionally) persistence.
		await this._authMaterial.clearState(options);
		// Sync the reactive signal after the controller clears in-memory state.
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
	 * The transport must NOT follow redirects automatically — the SDK
	 * extracts the fragment from the Location header directly.
	 */
	async refresh(): Promise<AuthStateSnapshot | null> {
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

				// Delegate token merge + persistence to the orchestration controller.
				// The controller applies mergeTokenDelta internally and saves to store.
				// The client layer keeps: redirect parsing, metadata redemption, scheduling.
				const newSnapshot = await this._authMaterial.applyDelta(parsed.tokens, {
					metadata,
				});
				this._stateSignal.set(newSnapshot);
				this._scheduleRefresh();

				this._runtime.logger?.log({
					level: LogLevel.Info,
					message: "Token refreshed successfully",
					scope: TRACE_SCOPE,
				});

				this._recordTrace("token_set.refresh.succeeded", {
					hasMetadataRedemption: parsed.metadataRedemptionId !== undefined,
					persisted: this._authMaterial.persistence !== null,
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
		// Delegate to the orchestration-layer helper for consistent bearer projection.
		return this._authMaterial.authorizationHeader;
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
				message: "BackendOidcMediatedModeClient was disposed",
				source: TRACE_SCOPE,
			}),
		);
		this._stateSignal.set(null);
		this._recordTrace("token_set.disposed");
	}

	// --- Private helpers ---

	/**
	 * Apply a snapshot via the orchestration controller (state + persistence as a unit),
	 * then update the reactive signal and trigger token-set-specific refresh scheduling.
	 */
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
				trigger: BackendOidcMediatedModeRefreshTriggerKind.Immediate,
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
						? BackendOidcMediatedModeRefreshTriggerKind.Slice
						: BackendOidcMediatedModeRefreshTriggerKind.Deadline,
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
