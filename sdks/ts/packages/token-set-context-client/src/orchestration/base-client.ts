// Base OIDC Mode Client — shared lifecycle infrastructure
//
// This abstract class extracts the common lifecycle management code that is
// shared between BackendOidcModeClient and FrontendOidcModeClient:
//   - Auth material controller (persist / restore / clear)
//   - State signal (ReadableSignal<AuthStateSnapshot | null>)
//   - Refresh scheduling (deadline-based, segmented timer)
//   - Cancellation / dispose
//   - Tracing helpers
//
// Subclasses implement the protocol-specific parts:
//   - `refresh()` — how tokens are actually refreshed
//   - `_onDispose()` — optional hook for extra cleanup (e.g. metadata refresh timer)
//
// Stability: internal (not a public API surface — consumed only by mode clients)

import type {
	CancelableHandle,
	CancellationTokenSourceTrait,
	ClientRuntime,
	EventStreamTrait,
	OperationScope,
	ReadableSignalTrait,
	RecordStore,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createCancellationTokenSource,
	createReplaySubject,
	createSignal,
	LogLevel,
	readonlySignal,
} from "@securitydept/client";
import {
	createTokenSetAuthEvent,
	summarizeAuthError,
	type TokenSetAuthEvent,
	type TokenSetAuthEventPayload,
	TokenSetAuthEventType,
	TokenSetAuthFlowOutcome,
	TokenSetAuthFlowReason,
	TokenSetAuthFlowSource,
} from "./auth-events";
import type { AuthMaterialController } from "./controller";
import { createAuthMaterialController } from "./controller";
import {
	createTokenHandleStore,
	type TokenHandleDescriptor,
	TokenHandleKind,
	type TokenHandleStore,
} from "./token-handle-store";
import {
	freshBearerHeader,
	getTokenFreshness,
	resolveTokenFreshnessTiming,
	shouldRefreshAccessToken,
	TokenFreshnessState,
} from "./token-ops";
import type { AuthSnapshot } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Maximum single setTimeout slice (30 minutes) — avoids platform timer overflow.
const MAX_SCHEDULE_SLICE_MS = 30 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_MS = 30_000;

const RefreshTriggerKind = {
	Immediate: "immediate",
	Slice: "slice",
	Deadline: "deadline",
} as const;

/** Shared state restore source kinds used by both mode clients. */
export const StateRestoreSourceKind = {
	Manual: "manual",
	PersistentStore: "persistent_store",
} as const;

export type StateRestoreSourceKind =
	(typeof StateRestoreSourceKind)[keyof typeof StateRestoreSourceKind];

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface BaseOidcModeClientOptions {
	runtime: ClientRuntime;
	/** Milliseconds before token expiry to trigger refresh. */
	refreshWindowMs: number;
	/** Trace scope string (e.g. "token-set-context" / "frontend-oidc-mode"). */
	traceScope: string;
	/** Trace source constant (e.g. "token_set_context_client" / "frontend_oidc_mode_client"). */
	traceSource: string;
	/** Trace event prefix (e.g. "token_set" / "frontend_oidc"). */
	tracePrefix: string;
	/** Human-readable client name for error messages (e.g. "BackendOidcModeClient"). */
	clientName: string;
	/** Logical client identifier for domain events, when known at construction time. */
	logicalClientId?: string;
	/** Persistence config. When provided, the controller can restore/save to a durable store. */
	persistence?: {
		store: RecordStore;
		key: string;
	};
}

export interface EnsureFreshAuthStateOptions {
	now?: number;
	clockSkewMs?: number;
	refreshWindowMs?: number;
	forceRefreshWhenDue?: boolean;
}

export interface EnsureAuthorizationHeaderOptions
	extends EnsureFreshAuthStateOptions {}

export interface EnsureAuthForResourceRequirement {
	id?: string;
	kind?: string;
}

export interface EnsureAuthForResourceOptions
	extends EnsureFreshAuthStateOptions {
	source?: TokenSetAuthFlowSource;
	clientKey?: string;
	logicalClientId?: string;
	providerFamily?: string;
	requirement?: EnsureAuthForResourceRequirement;
	url?: string;
	needsAuthorizationHeader?: boolean;
	allowBackgroundRefresh?: boolean;
	clearStateWhenUnauthenticated?: boolean;
}

export const EnsureAuthForResourceStatus = {
	Authenticated: "authenticated",
	Unauthenticated: "unauthenticated",
	AuthorizationHeaderResolved: "authorization_header_resolved",
	AuthorizationHeaderUnavailable: "authorization_header_unavailable",
	Failed: "failed",
} as const;

export type EnsureAuthForResourceStatus =
	(typeof EnsureAuthForResourceStatus)[keyof typeof EnsureAuthForResourceStatus];

export type EnsureAuthForResourceResult =
	| {
			status:
				| typeof EnsureAuthForResourceStatus.Authenticated
				| typeof EnsureAuthForResourceStatus.AuthorizationHeaderResolved;
			snapshot: AuthSnapshot;
			freshness: TokenFreshnessState;
			authorizationHeader?: string;
			tokenHandle?: TokenHandleDescriptor;
	  }
	| {
			status:
				| typeof EnsureAuthForResourceStatus.Unauthenticated
				| typeof EnsureAuthForResourceStatus.AuthorizationHeaderUnavailable;
			snapshot: null;
			freshness?: TokenFreshnessState;
			authorizationHeader: null;
			reason: TokenSetAuthFlowReason;
	  }
	| {
			status: typeof EnsureAuthForResourceStatus.Failed;
			snapshot: null;
			authorizationHeader: null;
			reason: TokenSetAuthFlowReason;
			error: unknown;
	  };

// ---------------------------------------------------------------------------
// Abstract Base Client
// ---------------------------------------------------------------------------

/**
 * Abstract base class for OIDC mode clients.
 *
 * Provides all shared lifecycle management: state signal, auth material
 * controller, persistence, refresh scheduling, cancellation, dispose,
 * and trace helpers.
 *
 * Subclasses implement `refresh()` and optionally override `_onDispose()`.
 */
export abstract class BaseOidcModeClient {
	// --- Runtime & config ---
	protected readonly _runtime: ClientRuntime;
	protected readonly _refreshWindowMs: number;
	protected readonly _traceScope: string;
	protected readonly _traceSource: string;
	protected readonly _tracePrefix: string;
	protected readonly _clientName: string;
	protected readonly _logicalClientId: string | undefined;

	// --- State management ---
	protected readonly _authMaterial: AuthMaterialController;
	protected readonly _stateSignal = createSignal<AuthSnapshot | null>(null);
	protected readonly _rootCancellation: CancellationTokenSourceTrait =
		createCancellationTokenSource();
	private _refreshHandle: CancelableHandle | null = null;
	private _refreshBarrier: Promise<AuthSnapshot | null> | null = null;
	private _refreshBarrierId: string | null = null;
	private _activeRefreshAuthEventPayload: TokenSetAuthEventPayload | null =
		null;
	private _disposed = false;
	private _authEventSequence = 0;
	private _refreshBarrierSequence = 0;
	private readonly _authEventSubject =
		createReplaySubject<TokenSetAuthEvent>(100);
	private readonly _tokenHandles: TokenHandleStore;

	/** Read-only signal exposing the current auth state snapshot. */
	readonly state: ReadableSignalTrait<AuthSnapshot | null>;
	/** Domain auth lifecycle events. Tokens are never emitted directly. */
	readonly authEvents: EventStreamTrait<TokenSetAuthEvent>;

	protected constructor(options: BaseOidcModeClientOptions) {
		this._runtime = options.runtime;
		this._refreshWindowMs = options.refreshWindowMs;
		this._traceScope = options.traceScope;
		this._traceSource = options.traceSource;
		this._tracePrefix = options.tracePrefix;
		this._clientName = options.clientName;
		this._logicalClientId = options.logicalClientId;

		this._authMaterial = createAuthMaterialController(
			options.persistence
				? {
						persistence: {
							store: options.persistence.store,
							key: options.persistence.key,
							now: () => this._runtime.clock.now(),
						},
					}
				: {},
		);

		this.state = readonlySignal(this._stateSignal);
		this.authEvents = this._authEventSubject;
		this._tokenHandles = createTokenHandleStore({
			now: () => this._runtime.clock.now(),
		});
	}

	// =======================================================================
	// Shared Public API
	// =======================================================================

	/** Manually set auth state (e.g. from persisted storage or SSR bootstrap). */
	restoreState(snapshot: AuthSnapshot): void {
		this._throwIfNotOperational();
		this._authMaterial.injectSnapshot(snapshot);
		this._stateSignal.set(snapshot);
		this._scheduleRefresh();
		this._emitAuthEvent(TokenSetAuthEventType.AuthMaterialRestored, {
			source: TokenSetAuthFlowSource.Manual,
			outcome: TokenSetAuthFlowOutcome.Authenticated,
			freshness: getTokenFreshness(snapshot, this._freshnessOptions()),
			hasRefreshMaterial: Boolean(snapshot.tokens.refreshMaterial),
		});
		this._emitAuthEvent(TokenSetAuthEventType.AuthAuthenticated, {
			source: TokenSetAuthFlowSource.Manual,
			outcome: TokenSetAuthFlowOutcome.Authenticated,
		});
		this._recordTrace(`${this._tracePrefix}.state.restored`, {
			sourceKind: StateRestoreSourceKind.Manual,
		});
	}

	/** Restore auth state from `runtime.persistentStore` when available. */
	async restorePersistedState(): Promise<AuthSnapshot | null> {
		this._throwIfNotOperational();

		if (!this._authMaterial.persistence) {
			return null;
		}
		this._emitAuthEvent(TokenSetAuthEventType.AuthMaterialRestoreStarted, {
			source: TokenSetAuthFlowSource.Restore,
			persisted: true,
		});

		let snapshot: AuthSnapshot | null;
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
					message: `Failed to clear invalid persisted ${this._traceScope} state`,
					scope: this._traceScope,
					code: `${this._tracePrefix}.persistence.clear_failed`,
					attributes: describeError(clearError),
				});
			}

			this._runtime.logger?.log({
				level: LogLevel.Warn,
				message: `Discarded invalid persisted ${this._traceScope} state`,
				scope: this._traceScope,
				code: `${this._tracePrefix}.persistence.discarded`,
				attributes: { cleared, ...describeError(error) },
			});
			this._recordFailureTrace(
				`${this._tracePrefix}.state.restore_discarded`,
				error,
				{ cleared },
			);
			this._emitAuthEvent(TokenSetAuthEventType.AuthMaterialRestoreFailed, {
				source: TokenSetAuthFlowSource.Restore,
				persisted: true,
				outcome: TokenSetAuthFlowOutcome.Failed,
				reason: TokenSetAuthFlowReason.RefreshFailed,
				errorSummary: summarizeAuthError(error),
			});
			return null;
		}

		this._throwIfNotOperational();

		if (!snapshot) {
			this._emitAuthEvent(TokenSetAuthEventType.AuthMaterialRestored, {
				source: TokenSetAuthFlowSource.Restore,
				persisted: true,
				outcome: TokenSetAuthFlowOutcome.Unauthenticated,
				reason: TokenSetAuthFlowReason.NoSnapshot,
			});
			return null;
		}

		this._authMaterial.injectSnapshot(snapshot);
		this._stateSignal.set(snapshot);
		this._emitAuthEvent(TokenSetAuthEventType.AuthMaterialRestored, {
			source: TokenSetAuthFlowSource.Restore,
			persisted: true,
			freshness: getTokenFreshness(snapshot, this._freshnessOptions()),
			hasRefreshMaterial: Boolean(snapshot.tokens.refreshMaterial),
		});
		const restored = await this.ensureAuthForResource({
			source: TokenSetAuthFlowSource.Restore,
			forceRefreshWhenDue: true,
		});
		if (restored.snapshot) {
			this._scheduleRefresh();
		}
		this._recordTrace(`${this._tracePrefix}.state.restored`, {
			sourceKind: StateRestoreSourceKind.PersistentStore,
		});

		return restored.snapshot;
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
		this._tokenHandles.clear();
		await this._authMaterial.clearState(options);
		this._stateSignal.set(null);
		this._emitAuthEvent(TokenSetAuthEventType.AuthMaterialCleared, {
			source: TokenSetAuthFlowSource.ExplicitCall,
			outcome: TokenSetAuthFlowOutcome.Unauthenticated,
			reason: TokenSetAuthFlowReason.Cleared,
			persisted: options.clearPersisted ?? true,
		});
		this._recordTrace(`${this._tracePrefix}.state.cleared`, {
			clearPersisted: options.clearPersisted ?? true,
		});
	}

	/** Get the current bearer authorization header value. */
	authorizationHeader(): string | null {
		return freshBearerHeader(
			this._authMaterial.snapshot,
			this._freshnessOptions(),
		);
	}

	async ensureFreshAuthState(
		options: EnsureFreshAuthStateOptions = {},
	): Promise<AuthSnapshot | null> {
		const result = await this.ensureAuthForResource({
			...options,
			source: TokenSetAuthFlowSource.ExplicitCall,
		});
		return result.snapshot;
	}

	async ensureAuthorizationHeader(
		options: EnsureAuthorizationHeaderOptions = {},
	): Promise<string | null> {
		const result = await this.ensureAuthForResource({
			...options,
			source: TokenSetAuthFlowSource.ExplicitCall,
			needsAuthorizationHeader: true,
			forceRefreshWhenDue: options.forceRefreshWhenDue ?? true,
		});
		return result.authorizationHeader ?? null;
	}

	async ensureAuthForResource(
		options: EnsureAuthForResourceOptions = {},
	): Promise<EnsureAuthForResourceResult> {
		this._throwIfNotOperational();
		const source = options.source ?? TokenSetAuthFlowSource.ExplicitCall;
		const snapshot = this._authMaterial.snapshot;
		const freshnessOptions = this._freshnessOptions(options);
		const freshness = snapshot
			? getTokenFreshness(snapshot, freshnessOptions)
			: undefined;
		const basePayload = this._authFlowPayload(options, {
			source,
			freshness,
			hasRefreshMaterial: Boolean(snapshot?.tokens.refreshMaterial),
		});

		if (source === TokenSetAuthFlowSource.Resume) {
			this._emitAuthEvent(
				TokenSetAuthEventType.ResumeReconcileRequested,
				basePayload,
			);
		}
		this._emitAuthEvent(
			TokenSetAuthEventType.AuthResourceRequested,
			basePayload,
		);
		if (options.needsAuthorizationHeader) {
			this._emitAuthEvent(
				TokenSetAuthEventType.AuthorizationHeaderRequested,
				basePayload,
			);
		}

		if (!snapshot) {
			this._emitResumeReconciliationTerminal(
				options,
				TokenSetAuthEventType.ResumeReconcileSkipped,
				TokenSetAuthFlowOutcome.Skipped,
				TokenSetAuthFlowReason.NoSnapshot,
				freshness,
			);
			return this._unauthenticatedResult(
				options,
				TokenSetAuthFlowReason.NoSnapshot,
				freshness,
			);
		}

		if (
			freshness === TokenFreshnessState.Fresh ||
			freshness === TokenFreshnessState.NoExpiry
		) {
			this._emitResumeReconciliationTerminal(
				options,
				TokenSetAuthEventType.ResumeReconcileSkipped,
				TokenSetAuthFlowOutcome.Skipped,
				freshness === TokenFreshnessState.Fresh
					? TokenSetAuthFlowReason.Fresh
					: TokenSetAuthFlowReason.NoExpiry,
				freshness,
			);
			return this._authenticatedResult(snapshot, freshness, options);
		}

		const forceRefreshWhenDue = options.forceRefreshWhenDue ?? false;
		if (
			freshness === TokenFreshnessState.RefreshDue &&
			!forceRefreshWhenDue &&
			options.allowBackgroundRefresh !== false
		) {
			if (shouldRefreshAccessToken(snapshot, freshnessOptions)) {
				this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshSkipped, {
					...basePayload,
					outcome: TokenSetAuthFlowOutcome.Skipped,
					reason: TokenSetAuthFlowReason.BackgroundRefresh,
				});
				this._refreshThroughBarrier(basePayload).catch(() => {});
			}
			return this._authenticatedResult(snapshot, freshness, options);
		}

		if (!snapshot.tokens.refreshMaterial) {
			this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshSkipped, {
				...basePayload,
				outcome: TokenSetAuthFlowOutcome.Skipped,
				reason: TokenSetAuthFlowReason.NoRefreshMaterial,
			});
			this._emitResumeReconciliationTerminal(
				options,
				TokenSetAuthEventType.ResumeReconcileSkipped,
				TokenSetAuthFlowOutcome.Skipped,
				TokenSetAuthFlowReason.NoRefreshMaterial,
				freshness,
			);
			if (options.clearStateWhenUnauthenticated !== false) {
				await this.clearState({ clearPersisted: true });
			}
			return this._unauthenticatedResult(
				options,
				TokenSetAuthFlowReason.NoRefreshMaterial,
				freshness,
			);
		}

		this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshRequired, {
			...basePayload,
			reason:
				freshness === TokenFreshnessState.Expired
					? TokenSetAuthFlowReason.Expired
					: TokenSetAuthFlowReason.RefreshDue,
		});
		const refreshed = await this._refreshThroughBarrier(basePayload);
		if (!refreshed) {
			this._emitResumeReconciliationTerminal(
				options,
				TokenSetAuthEventType.ResumeReconcileFailed,
				TokenSetAuthFlowOutcome.Failed,
				TokenSetAuthFlowReason.RefreshFailed,
				freshness,
			);
			return this._unauthenticatedResult(
				options,
				TokenSetAuthFlowReason.RefreshFailed,
				freshness,
			);
		}
		this._emitResumeReconciliationTerminal(
			options,
			TokenSetAuthEventType.ResumeReconcileCompleted,
			TokenSetAuthFlowOutcome.Authenticated,
			TokenSetAuthFlowReason.RefreshSucceeded,
			getTokenFreshness(refreshed, this._freshnessOptions(options)),
		);
		return this._authenticatedResult(
			refreshed,
			getTokenFreshness(refreshed, this._freshnessOptions(options)),
			options,
		);
	}

	/** Cancel pending refresh and release client resources. */
	dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._cancelRefresh("dispose");
		this._onDispose();
		this._rootCancellation.cancel(
			new ClientError({
				kind: ClientErrorKind.Cancelled,
				code: `${this._tracePrefix}.client_disposed`,
				message: `${this._clientName} was disposed`,
				source: this._traceScope,
			}),
		);
		this._tokenHandles.clear();
		this._stateSignal.set(null);
		this._recordTrace(`${this._tracePrefix}.disposed`);
	}

	/**
	 * Attempt to refresh the current token set.
	 * Subclasses implement the protocol-specific refresh logic.
	 */
	abstract refresh(): Promise<AuthSnapshot | null>;

	// =======================================================================
	// Protected: Subclass hooks
	// =======================================================================

	/**
	 * Hook for subclass-specific dispose cleanup.
	 * Called after refresh is cancelled but before cancellation token fires.
	 * Override to cancel mode-specific timers (e.g. metadata refresh).
	 */
	protected _onDispose(): void {
		// Default no-op. Subclasses override as needed.
	}

	// =======================================================================
	// Protected: Lifecycle utilities
	// =======================================================================

	protected _currentRefreshAuthEventPayload(): TokenSetAuthEventPayload | null {
		return this._activeRefreshAuthEventPayload;
	}

	protected async _applySnapshot(
		snapshot: AuthSnapshot,
		payload: TokenSetAuthEventPayload,
	): Promise<void> {
		await this._authMaterial.applySnapshot(snapshot);
		this._stateSignal.set(snapshot);
		this._scheduleRefresh();
		this._emitAuthEvent(TokenSetAuthEventType.AuthAuthenticated, {
			...payload,
			outcome: TokenSetAuthFlowOutcome.Authenticated,
			freshness: getTokenFreshness(snapshot, this._freshnessOptions()),
			hasRefreshMaterial: Boolean(snapshot.tokens.refreshMaterial),
		});
	}

	protected _throwIfNotOperational(): void {
		if (this._disposed) {
			this._rootCancellation.token.throwIfCancellationRequested();
		}
		this._rootCancellation.token.throwIfCancellationRequested();
	}

	protected _scheduleRefresh(): void {
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
		if (!Number.isFinite(expiresAt)) {
			this._refreshThroughBarrier(this._timerAuthFlowPayload()).catch(() => {});
			return;
		}
		const now = this._runtime.clock.now();
		const timing = resolveTokenFreshnessTiming(current, {
			now,
			clockSkewMs: DEFAULT_CLOCK_SKEW_MS,
			refreshWindowMs: this._refreshWindowMs,
		});
		const refreshAt = timing.refreshAt;
		const remainingMs = refreshAt - now;

		if (remainingMs <= 0) {
			this._recordTrace(`${this._tracePrefix}.refresh.fired`, {
				trigger: RefreshTriggerKind.Immediate,
			});
			this._refreshThroughBarrier(this._timerAuthFlowPayload()).catch(() => {});
			return;
		}

		const delayMs = Math.min(remainingMs, MAX_SCHEDULE_SLICE_MS);
		this._recordTrace(`${this._tracePrefix}.refresh.scheduled`, {
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
			this._recordTrace(`${this._tracePrefix}.refresh.fired`, {
				trigger:
					nextRemainingMs > 0
						? RefreshTriggerKind.Slice
						: RefreshTriggerKind.Deadline,
				remainingMs: Math.max(0, nextRemainingMs),
			});

			if (nextRemainingMs > 0) {
				this._scheduleRefresh();
				return;
			}

			this._refreshThroughBarrier(this._timerAuthFlowPayload()).catch(() => {});
		});
	}

	private _freshnessOptions(options: EnsureFreshAuthStateOptions = {}) {
		return {
			now: options.now ?? this._runtime.clock.now(),
			clockSkewMs: options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS,
			refreshWindowMs: options.refreshWindowMs ?? this._refreshWindowMs,
		};
	}

	private _authenticatedResult(
		snapshot: AuthSnapshot,
		freshness: TokenFreshnessState,
		options: EnsureAuthForResourceOptions,
	): EnsureAuthForResourceResult {
		const source = options.source ?? TokenSetAuthFlowSource.ExplicitCall;
		const payload = this._authFlowPayload(options, {
			source,
			freshness,
			hasRefreshMaterial: Boolean(snapshot.tokens.refreshMaterial),
			outcome: TokenSetAuthFlowOutcome.Authenticated,
		});
		this._emitAuthEvent(TokenSetAuthEventType.AuthAuthenticated, payload);

		if (!options.needsAuthorizationHeader) {
			return {
				status: EnsureAuthForResourceStatus.Authenticated,
				snapshot,
				freshness,
			};
		}

		const authorizationHeader = freshBearerHeader(
			snapshot,
			this._freshnessOptions(options),
		);
		if (!authorizationHeader) {
			this._emitAuthEvent(
				TokenSetAuthEventType.AuthorizationHeaderUnavailable,
				{
					...payload,
					outcome: TokenSetAuthFlowOutcome.HeaderUnavailable,
				},
			);
			return {
				status: EnsureAuthForResourceStatus.AuthorizationHeaderUnavailable,
				snapshot: null,
				freshness,
				authorizationHeader: null,
				reason: TokenSetAuthFlowReason.Expired,
			};
		}

		const tokenHandle = this._tokenHandles.issue({
			kind: TokenHandleKind.AccessToken,
			token: snapshot.tokens.accessToken,
			clientKey: options.clientKey,
			expiresAt: snapshot.tokens.accessTokenExpiresAt
				? new Date(snapshot.tokens.accessTokenExpiresAt).getTime()
				: undefined,
		});
		this._emitAuthEvent(TokenSetAuthEventType.AuthorizationHeaderResolved, {
			...payload,
			outcome: TokenSetAuthFlowOutcome.HeaderResolved,
			tokenHandle,
		});
		return {
			status: EnsureAuthForResourceStatus.AuthorizationHeaderResolved,
			snapshot,
			freshness,
			authorizationHeader,
			tokenHandle,
		};
	}

	private _unauthenticatedResult(
		options: EnsureAuthForResourceOptions,
		reason: TokenSetAuthFlowReason,
		freshness: TokenFreshnessState | undefined,
	): EnsureAuthForResourceResult {
		const payload = this._authFlowPayload(options, {
			source: options.source ?? TokenSetAuthFlowSource.ExplicitCall,
			freshness,
			hasRefreshMaterial: false,
			outcome: TokenSetAuthFlowOutcome.Unauthenticated,
			reason,
		});
		this._emitAuthEvent(TokenSetAuthEventType.AuthUnauthenticated, payload);
		if (options.needsAuthorizationHeader) {
			this._emitAuthEvent(
				TokenSetAuthEventType.AuthorizationHeaderUnavailable,
				{
					...payload,
					outcome: TokenSetAuthFlowOutcome.HeaderUnavailable,
				},
			);
			return {
				status: EnsureAuthForResourceStatus.AuthorizationHeaderUnavailable,
				snapshot: null,
				freshness,
				authorizationHeader: null,
				reason,
			};
		}
		return {
			status: EnsureAuthForResourceStatus.Unauthenticated,
			snapshot: null,
			freshness,
			authorizationHeader: null,
			reason,
		};
	}

	private _authFlowPayload(
		options: EnsureAuthForResourceOptions,
		payload: Pick<
			TokenSetAuthEventPayload,
			"source" | "freshness" | "hasRefreshMaterial" | "outcome" | "reason"
		>,
	): TokenSetAuthEventPayload {
		return {
			clientKey: options.clientKey,
			logicalClientId: options.logicalClientId ?? this._logicalClientId,
			providerFamily: options.providerFamily,
			requirementId: options.requirement?.id,
			requirementKind: options.requirement?.kind,
			url: options.url,
			...payload,
		};
	}

	private _timerAuthFlowPayload(): TokenSetAuthEventPayload {
		const snapshot = this._authMaterial.snapshot;
		return this._authFlowPayload(
			{},
			{
				source: TokenSetAuthFlowSource.Timer,
				freshness: snapshot
					? getTokenFreshness(snapshot, this._freshnessOptions())
					: undefined,
				hasRefreshMaterial: Boolean(snapshot?.tokens.refreshMaterial),
			},
		);
	}

	private _emitAuthEvent(
		type: TokenSetAuthEventType,
		payload: TokenSetAuthEventPayload,
	): void {
		this._authEventSubject.next(
			createTokenSetAuthEvent({
				id: `${this._tracePrefix}.auth.${++this._authEventSequence}`,
				type,
				at: this._runtime.clock.now(),
				payload,
			}),
		);
	}

	private _emitResumeReconciliationTerminal(
		options: EnsureAuthForResourceOptions,
		type: TokenSetAuthEventType,
		outcome: TokenSetAuthFlowOutcome,
		reason: TokenSetAuthFlowReason,
		freshness: TokenFreshnessState | undefined,
	): void {
		if (options.source !== TokenSetAuthFlowSource.Resume) {
			return;
		}

		this._emitAuthEvent(
			type,
			this._authFlowPayload(options, {
				source: TokenSetAuthFlowSource.Resume,
				freshness,
				hasRefreshMaterial: Boolean(
					this._authMaterial.snapshot?.tokens.refreshMaterial,
				),
				outcome,
				reason,
			}),
		);
	}

	private _refreshThroughBarrier(
		payload: TokenSetAuthEventPayload,
	): Promise<AuthSnapshot | null> {
		if (this._refreshBarrier) {
			this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshJoined, {
				...payload,
				outcome: TokenSetAuthFlowOutcome.Skipped,
				reason: TokenSetAuthFlowReason.RefreshBarrierJoined,
				refreshBarrierId: this._refreshBarrierId ?? undefined,
			});
			return this._refreshBarrier;
		}

		const refreshBarrierId = `${this._tracePrefix}.refresh.${++this._refreshBarrierSequence}`;
		this._refreshBarrierId = refreshBarrierId;

		this._refreshBarrier = (async () => {
			try {
				this._activeRefreshAuthEventPayload = {
					...payload,
					refreshBarrierId,
				};
				this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshStarted, {
					...payload,
					refreshBarrierId,
				});
				const refreshed = await this.refresh();
				if (!refreshed) {
					await this.clearState({ clearPersisted: true });
					this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshFailed, {
						...payload,
						outcome: TokenSetAuthFlowOutcome.Failed,
						reason: TokenSetAuthFlowReason.RefreshFailed,
						refreshBarrierId,
					});
					return null;
				}
				this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshSucceeded, {
					...payload,
					outcome: TokenSetAuthFlowOutcome.Authenticated,
					freshness: getTokenFreshness(refreshed, this._freshnessOptions()),
					hasRefreshMaterial: Boolean(refreshed.tokens.refreshMaterial),
					refreshBarrierId,
				});
				return refreshed;
			} catch (error) {
				try {
					await this.clearState({ clearPersisted: true });
				} catch (clearError) {
					this._runtime.logger?.log({
						level: LogLevel.Warn,
						message: `Failed to clear ${this._traceScope} state after refresh failure`,
						scope: this._traceScope,
						code: `${this._tracePrefix}.refresh.clear_failed`,
						attributes: describeError(clearError),
					});
				}
				this._recordFailureTrace(
					`${this._tracePrefix}.refresh.barrier_failed`,
					error,
				);
				this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshFailed, {
					...payload,
					outcome: TokenSetAuthFlowOutcome.Failed,
					reason: TokenSetAuthFlowReason.RefreshFailed,
					errorSummary: summarizeAuthError(error),
					refreshBarrierId,
				});
				return null;
			} finally {
				this._activeRefreshAuthEventPayload = null;
				this._refreshBarrier = null;
				this._refreshBarrierId = null;
			}
		})();

		return this._refreshBarrier;
	}

	protected _cancelRefresh(reason: string): void {
		if (!this._refreshHandle) {
			return;
		}
		this._refreshHandle.cancel();
		this._refreshHandle = null;
		this._recordTrace(`${this._tracePrefix}.refresh.cancelled`, {
			reason,
		});
	}

	// =======================================================================
	// Protected: Tracing helpers
	// =======================================================================

	protected async _runOperation<T>(
		name: string,
		attributes: Record<string, unknown> | undefined,
		execute: (operation: OperationScope | undefined) => Promise<T>,
	): Promise<T> {
		const operation = this._runtime.operationTracer?.startOperation(
			name,
			attributes,
		);

		try {
			const result = await execute(operation);
			operation?.end({ outcome: "succeeded" });
			return result;
		} catch (error) {
			operation?.recordError(error);
			operation?.end({ outcome: "failed" });
			throw error;
		}
	}

	protected _recordTrace(
		type: string,
		attributes?: Record<string, unknown>,
		operation?: OperationScope,
	): void {
		this._runtime.traceSink?.record({
			type,
			at: this._runtime.clock.now(),
			scope: this._traceScope,
			operationId: operation?.id,
			source: this._traceSource,
			attributes,
		});
	}

	protected _recordFailureTrace(
		type: string,
		error: unknown,
		attributes?: Record<string, unknown>,
		operation?: OperationScope,
	): void {
		this._recordTrace(
			type,
			{
				...attributes,
				...describeError(error),
			},
			operation,
		);
	}
}

// ---------------------------------------------------------------------------
// Shared utility
// ---------------------------------------------------------------------------

/** Extract structured error attributes from an unknown error value. */
export function describeError(error: unknown): Record<string, unknown> {
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

	return { errorValue: String(error) };
}
