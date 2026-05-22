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
	ClientEnvironment,
	EventStreamTrait,
	EventSubscriptionTrait,
	OperationScope,
	ReadableReplaySignalTrait,
	ReadableSignalTrait,
	RecordStore,
	WritableSignalTrait,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createAndThenComputedReplaySignal,
	createCancellationTokenSource,
	createReplaySignal,
	createReplaySubject,
	createSignal,
	describeError,
	LogLevel,
	readonlyReplaySignal,
	readonlySignal,
} from "@securitydept/client";
import {
	OnDemandTaskQueue,
	type OnDemandTaskQueueTaskEnvelope,
} from "@securitydept/client/struct";
import {
	createTokenSetAuthEvent,
	summarizeAuthError,
	type TokenSetAuthEvent,
	type TokenSetAuthEventPayload,
	TokenSetAuthEventType,
	TokenSetAuthFlowOutcome,
	TokenSetAuthFlowReason,
	TokenSetAuthFlowSource,
} from "../events/auth-events";
import type {
	TokenSetAuthCheckTriggerEvent,
	TokenSetAuthCheckTriggerSource,
} from "../state/auth-check-triggers";
import type { AuthMaterialController } from "../state/controller";
import { createAuthMaterialController } from "../state/controller";
import {
	freshBearerHeader,
	getTokenFreshness,
	resolveTokenFreshnessTiming,
	shouldRefreshAccessToken,
	TokenFreshnessState,
} from "../token/token-ops";
import type { AuthSnapshot } from "../token/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Maximum single setTimeout slice (30 minutes) — avoids platform timer overflow.
const MAX_SCHEDULE_SLICE_MS = 30 * 60 * 1000;
const DEFAULT_CLOCK_SKEW_MS = 30_000;

const ClientStartLifecycleStatus = {
	NotStarted: "not_started",
	Starting: "starting",
	Started: "started",
	Failed: "failed",
} as const;

type ClientStartLifecycle =
	| {
			status: typeof ClientStartLifecycleStatus.NotStarted;
	  }
	| {
			status: typeof ClientStartLifecycleStatus.Starting;
			promise: Promise<void>;
	  }
	| {
			status: typeof ClientStartLifecycleStatus.Started;
	  }
	| {
			status: typeof ClientStartLifecycleStatus.Failed;
			error: unknown;
	  };

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
	environment: ClientEnvironment;
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
	/**
	 * Start the auth state machine immediately after construction.
	 *
	 * Defaults to false. Registry-managed clients should leave this false
	 * because the registry owns their lifecycle.
	 */
	autoStart?: boolean;
}

export interface AuthCheckOptions {
	reason?: string;
	now?: number;
	clockSkewMs?: number;
	refreshWindowMs?: number;
	forceRefreshWhenDue?: boolean;
	clearStateWhenUnauthenticated?: boolean;
	allowBackgroundRefresh?: boolean;
}

export interface TokenSetAuthOperationSignals {
	readonly restorePending: ReadableSignalTrait<boolean>;
	readonly refreshPending: ReadableSignalTrait<boolean>;
	readonly clearPending: ReadableSignalTrait<boolean>;
	readonly loginPending: ReadableSignalTrait<boolean>;
}

interface TokenSetAuthOperationWritableSignals {
	readonly restorePending: WritableSignalTrait<boolean>;
	readonly refreshPending: WritableSignalTrait<boolean>;
	readonly clearPending: WritableSignalTrait<boolean>;
	readonly loginPending: WritableSignalTrait<boolean>;
}

type AuthCheckRunOptions = AuthCheckOptions & {
	source?: TokenSetAuthFlowSource;
	scheduleRefreshAfterAuthenticated?: boolean;
};

export const AuthCheckStatus = {
	Authenticated: "authenticated",
	Unauthenticated: "unauthenticated",
	Failed: "failed",
} as const;

export type AuthCheckStatus =
	(typeof AuthCheckStatus)[keyof typeof AuthCheckStatus];

export type AuthCheckResult =
	| {
			status: typeof AuthCheckStatus.Authenticated;
			snapshot: AuthSnapshot;
			freshness: TokenFreshnessState;
			authorizationHeader: string | undefined;
	  }
	| {
			status: typeof AuthCheckStatus.Unauthenticated;
			snapshot: null;
			freshness?: TokenFreshnessState;
			authorizationHeader: null;
			reason: TokenSetAuthFlowReason;
	  }
	| {
			status: typeof AuthCheckStatus.Failed;
			snapshot: null;
			authorizationHeader: null;
			reason: TokenSetAuthFlowReason;
			error: unknown;
	  };

interface AuthDeterminationEvent {
	type: TokenSetAuthEventType;
	payload: TokenSetAuthEventPayload;
}

interface AuthCheckContext {
	options: AuthCheckRunOptions;
	snapshot: AuthSnapshot | null;
	freshness: TokenFreshnessState | undefined;
	freshnessOptions: {
		now: number;
		clockSkewMs: number;
		refreshWindowMs: number;
	};
	basePayload: TokenSetAuthEventPayload;
}

interface AuthCheckTerminalEventPlan {
	type: TokenSetAuthEventType;
	outcome: TokenSetAuthFlowOutcome;
	reason: TokenSetAuthFlowReason;
	freshness: TokenFreshnessState | undefined;
}

type AuthCheckPlan =
	| {
			kind: "authenticated";
			snapshot: AuthSnapshot;
			freshness: TokenFreshnessState;
			terminalEvent?: AuthCheckTerminalEventPlan;
			backgroundRefresh?: boolean;
	  }
	| {
			kind: "unauthenticated";
			reason: TokenSetAuthFlowReason;
			freshness: TokenFreshnessState | undefined;
			terminalEvent?: AuthCheckTerminalEventPlan;
			refreshSkippedReason?: TokenSetAuthFlowReason;
			clearState?: boolean;
	  }
	| {
			kind: "refresh";
			reason: TokenSetAuthFlowReason;
	  };

type SyncAuthDeterminationMaterial =
	| {
			kind: "inject";
			snapshot: AuthSnapshot;
	  }
	| {
			kind: "current";
			snapshot: AuthSnapshot | null;
	  };

type AsyncAuthDeterminationMaterial =
	| {
			kind: "apply";
			snapshot: AuthSnapshot;
	  }
	| {
			kind: "clear";
			options?: { clearPersisted?: boolean };
	  };

type AuthRefreshScheduling =
	| {
			kind: "schedule";
	  }
	| {
			kind: "cancel";
			reason: string;
	  }
	| {
			kind: "unchanged";
	  };

interface AuthDeterminationOptionsBase {
	error?: unknown;
	events?: readonly AuthDeterminationEvent[];
	refreshScheduling: AuthRefreshScheduling;
}

interface SyncAuthDeterminationOptions extends AuthDeterminationOptionsBase {
	material: SyncAuthDeterminationMaterial;
}

interface AsyncAuthDeterminationOptions extends AuthDeterminationOptionsBase {
	material: AsyncAuthDeterminationMaterial;
}

type AuthDeterminationOptions =
	| SyncAuthDeterminationOptions
	| AsyncAuthDeterminationOptions;

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
	// --- Environment & config ---
	protected readonly _environment: ClientEnvironment;
	protected readonly _refreshWindowMs: number;
	protected readonly _traceScope: string;
	protected readonly _traceSource: string;
	protected readonly _tracePrefix: string;
	protected readonly _clientName: string;
	protected readonly _logicalClientId: string | undefined;

	// --- State management ---
	protected readonly _authMaterial: AuthMaterialController;
	private readonly _authSnapshotSignal =
		createReplaySignal<AuthSnapshot | null>();
	private readonly _lastAuthErrorSignal = createSignal<unknown | undefined>(
		undefined,
	);
	protected readonly _authOperationSignals: TokenSetAuthOperationWritableSignals =
		{
			restorePending: createSignal(false),
			refreshPending: createSignal(false),
			clearPending: createSignal(false),
			loginPending: createSignal(false),
		};
	protected readonly _rootCancellation: CancellationTokenSourceTrait =
		createCancellationTokenSource();
	private _refreshHandle: CancelableHandle | null = null;
	private _refreshBarrier: Promise<AuthSnapshot | null> | null = null;
	private _refreshBarrierId: string | null = null;
	private _activeRefreshAuthEventPayload: TokenSetAuthEventPayload | null =
		null;
	private _disposed = false;
	private readonly _startLifecycleSignal = createSignal<ClientStartLifecycle>({
		status: ClientStartLifecycleStatus.NotStarted,
	});
	private _authEventSequence = 0;
	private _refreshBarrierSequence = 0;
	private readonly _authEventSubject =
		createReplaySubject<TokenSetAuthEvent>(100);
	private readonly _authCheckSubscriptions = new Set<EventSubscriptionTrait>();
	private readonly _authCheckQueue: OnDemandTaskQueue<
		TokenSetAuthCheckTriggerEvent,
		AuthCheckResult
	>;

	readonly authDetermined: ReadableReplaySignalTrait<true>;
	readonly authSnapshot: ReadableReplaySignalTrait<AuthSnapshot | null>;
	readonly isAuthenticated: ReadableReplaySignalTrait<boolean>;
	readonly authorizationHeaderValue: ReadableReplaySignalTrait<
		string | undefined
	>;
	readonly lastAuthError: ReadableSignalTrait<unknown | undefined>;
	readonly authOperations: TokenSetAuthOperationSignals;
	/** Domain auth lifecycle events. Tokens are never emitted directly. */
	readonly authEvents: EventStreamTrait<TokenSetAuthEvent>;

	protected constructor(options: BaseOidcModeClientOptions) {
		this._environment = options.environment;
		this._refreshWindowMs = options.refreshWindowMs;
		this._traceScope = options.traceScope;
		this._traceSource = options.traceSource;
		this._tracePrefix = options.tracePrefix;
		this._clientName = options.clientName;
		this._logicalClientId = options.logicalClientId;
		this._authCheckQueue = new OnDemandTaskQueue({
			now: () => this._environment.clock.now(),
			run: (task) => this._runAuthCheckTask(task),
		});

		this._authMaterial = createAuthMaterialController(
			options.persistence
				? {
						persistence: {
							store: options.persistence.store,
							key: options.persistence.key,
							now: () => this._environment.clock.now(),
						},
					}
				: {},
		);

		this.authSnapshot = readonlyReplaySignal(this._authSnapshotSignal);
		this.authDetermined = createAndThenComputedReplaySignal(
			this._authSnapshotSignal,
			() => ({ kind: "value", value: true }),
		);
		this.authorizationHeaderValue = createAndThenComputedReplaySignal(
			this._authSnapshotSignal,
			(snapshot) => ({
				kind: "value",
				value:
					freshBearerHeader(snapshot, this._freshnessOptions()) ?? undefined,
			}),
		);
		this.isAuthenticated = createAndThenComputedReplaySignal(
			this.authorizationHeaderValue,
			(headerValue) => ({ kind: "value", value: headerValue !== undefined }),
		);
		this.lastAuthError = readonlySignal(this._lastAuthErrorSignal);
		this.authOperations = {
			restorePending: readonlySignal(this._authOperationSignals.restorePending),
			refreshPending: readonlySignal(this._authOperationSignals.refreshPending),
			clearPending: readonlySignal(this._authOperationSignals.clearPending),
			loginPending: readonlySignal(this._authOperationSignals.loginPending),
		};
		this.authEvents = this._authEventSubject;
		if (options.autoStart === true) {
			this.start().catch(() => {
				// Startup failures are reflected through lastAuthError.
			});
		}
	}

	// =======================================================================
	// Shared Public API
	// =======================================================================

	start(): Promise<void> {
		this._throwIfNotOperational();
		const startLifecycle = this._startLifecycleSignal.get();
		if (startLifecycle.status === ClientStartLifecycleStatus.Started) {
			return Promise.resolve();
		}
		if (startLifecycle.status === ClientStartLifecycleStatus.Starting) {
			return startLifecycle.promise;
		}
		if (startLifecycle.status === ClientStartLifecycleStatus.Failed) {
			return Promise.reject(startLifecycle.error);
		}

		const promise = (async () => {
			try {
				await this.restorePersistedState();
				this._startLifecycleSignal.set({
					status: ClientStartLifecycleStatus.Started,
				});
			} catch (error) {
				this._startLifecycleSignal.set({
					status: ClientStartLifecycleStatus.Failed,
					error,
				});
				this._lastAuthErrorSignal.set(error);
				throw error;
			}
		})();
		this._startLifecycleSignal.set({
			status: ClientStartLifecycleStatus.Starting,
			promise,
		});
		return promise;
	}

	/** Manually set auth state (e.g. from persisted storage or SSR bootstrap). */
	restoreState(snapshot: AuthSnapshot): void {
		this._throwIfNotOperational();
		const payload = {
			source: TokenSetAuthFlowSource.Manual,
			outcome: TokenSetAuthFlowOutcome.Authenticated,
			freshness: getTokenFreshness(snapshot, this._freshnessOptions()),
			hasRefreshMaterial: Boolean(snapshot.tokens.refreshMaterial),
		};
		this._emitAuthDetermination({
			material: { kind: "inject", snapshot },
			refreshScheduling: { kind: "schedule" },
			events: [
				{
					type: TokenSetAuthEventType.AuthMaterialRestored,
					payload,
				},
				{
					type: TokenSetAuthEventType.AuthAuthenticated,
					payload,
				},
			],
		});
		this._recordTrace(`${this._tracePrefix}.state.restored`, {
			sourceKind: StateRestoreSourceKind.Manual,
		});
	}

	/** Restore auth state from `environment.persistentStore` when available. */
	async restorePersistedState(): Promise<AuthSnapshot | null> {
		this._throwIfNotOperational();

		if (!this._authMaterial.persistence) {
			await this._emitAuthDetermination({
				material: { kind: "clear", options: { clearPersisted: false } },
				refreshScheduling: {
					kind: "cancel",
					reason: "restore_without_persistence",
				},
			});
			return null;
		}
		this._authOperationSignals.restorePending.set(true);
		try {
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
					this._environment.logger?.log({
						level: LogLevel.Warn,
						message: `Failed to clear invalid persisted ${this._traceScope} state`,
						scope: this._traceScope,
						code: `${this._tracePrefix}.persistence.clear_failed`,
						attributes: describeError(clearError),
					});
				}

				this._environment.logger?.log({
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
				await this._emitAuthDetermination({
					material: { kind: "clear", options: { clearPersisted: false } },
					refreshScheduling: {
						kind: "cancel",
						reason: "restore_invalid_persisted_state",
					},
					error,
					events: [
						{
							type: TokenSetAuthEventType.AuthMaterialRestoreFailed,
							payload: {
								source: TokenSetAuthFlowSource.Restore,
								persisted: true,
								outcome: TokenSetAuthFlowOutcome.Failed,
								reason: TokenSetAuthFlowReason.RefreshFailed,
								errorSummary: summarizeAuthError(error),
							},
						},
					],
				});
				return null;
			}

			this._throwIfNotOperational();

			if (!snapshot) {
				await this._emitAuthDetermination({
					material: { kind: "clear", options: { clearPersisted: false } },
					refreshScheduling: {
						kind: "cancel",
						reason: "restore_no_snapshot",
					},
					events: [
						{
							type: TokenSetAuthEventType.AuthMaterialRestored,
							payload: {
								source: TokenSetAuthFlowSource.Restore,
								persisted: true,
								outcome: TokenSetAuthFlowOutcome.Unauthenticated,
								reason: TokenSetAuthFlowReason.NoSnapshot,
							},
						},
					],
				});
				return null;
			}

			const restored = await this._enqueueAuthCheck({
				source: TokenSetAuthFlowSource.Restore,
				reason: "restore_completed",
				forceRefreshWhenDue: true,
				clearStateWhenUnauthenticated: true,
				scheduleRefreshAfterAuthenticated: true,
			});
			this._recordTrace(`${this._tracePrefix}.state.restored`, {
				sourceKind: StateRestoreSourceKind.PersistentStore,
			});

			return restored.snapshot;
		} finally {
			this._authOperationSignals.restorePending.set(false);
		}
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
		this._authOperationSignals.clearPending.set(true);
		try {
			await this._emitAuthDetermination({
				material: { kind: "clear", options },
				refreshScheduling: { kind: "cancel", reason: "clear_state" },
				events: [
					{
						type: TokenSetAuthEventType.AuthMaterialCleared,
						payload: {
							source: TokenSetAuthFlowSource.ExplicitCall,
							outcome: TokenSetAuthFlowOutcome.Unauthenticated,
							reason: TokenSetAuthFlowReason.Cleared,
							persisted: options.clearPersisted ?? true,
						},
					},
				],
			});
			this._recordTrace(`${this._tracePrefix}.state.cleared`, {
				clearPersisted: options.clearPersisted ?? true,
			});
		} finally {
			this._authOperationSignals.clearPending.set(false);
		}
	}

	addAuthCheckTriggerSource(
		source: TokenSetAuthCheckTriggerSource,
	): EventSubscriptionTrait {
		this._throwIfNotOperational();
		let unsubscribed = false;
		let sourceSubscription: EventSubscriptionTrait | null = null;
		const subscription: EventSubscriptionTrait = {
			unsubscribe: () => {
				if (unsubscribed) {
					return;
				}
				unsubscribed = true;
				this._authCheckSubscriptions.delete(subscription);
				sourceSubscription?.unsubscribe();
				sourceSubscription = null;
			},
		};
		sourceSubscription = source.subscribe({
			next: (trigger) => {
				this._enqueueAuthCheck(trigger).catch((error) => {
					this._lastAuthErrorSignal.set(error);
					this._environment.logger?.log({
						level: LogLevel.Warn,
						message: `Auth check trigger failed for ${this._traceScope}`,
						scope: this._traceScope,
						code: `${this._tracePrefix}.auth_check.failed`,
						attributes: describeError(error),
					});
				});
			},
			error: (error) => {
				this._lastAuthErrorSignal.set(error);
				this._environment.logger?.log({
					level: LogLevel.Warn,
					message: `Auth check trigger source failed for ${this._traceScope}`,
					scope: this._traceScope,
					code: `${this._tracePrefix}.auth_check.source_failed`,
					attributes: describeError(error),
				});
			},
		});
		this._authCheckSubscriptions.add(subscription);
		return subscription;
	}

	async authCheck(options: AuthCheckOptions = {}): Promise<AuthCheckResult> {
		return await this._enqueueAuthCheck({
			source: TokenSetAuthFlowSource.ExplicitCall,
			reason: options.reason ?? "manual_auth_check",
			forceRefreshWhenDue: options.forceRefreshWhenDue,
			clearStateWhenUnauthenticated: options.clearStateWhenUnauthenticated,
			allowBackgroundRefresh: options.allowBackgroundRefresh,
			clockSkewMs: options.clockSkewMs,
			refreshWindowMs: options.refreshWindowMs,
		});
	}

	private async _runAuthCheck(
		options: AuthCheckRunOptions = {},
	): Promise<AuthCheckResult> {
		this._throwIfNotOperational();
		const context = this._createAuthCheckContext(options);
		const plan = this._planAuthCheck(context);

		this._emitAuthEvent(
			TokenSetAuthEventType.AuthCheckRequested,
			context.basePayload,
		);
		return await this._commitAuthCheckPlan(context, plan);
	}

	private _createAuthCheckContext(
		options: AuthCheckRunOptions,
	): AuthCheckContext {
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

		return {
			options,
			snapshot,
			freshness,
			freshnessOptions,
			basePayload,
		};
	}

	private _planAuthCheck(context: AuthCheckContext): AuthCheckPlan {
		const { options, snapshot, freshness, freshnessOptions } = context;
		if (!snapshot) {
			return {
				kind: "unauthenticated",
				reason: TokenSetAuthFlowReason.NoSnapshot,
				freshness,
				terminalEvent: {
					type: TokenSetAuthEventType.AuthCheckSkipped,
					outcome: TokenSetAuthFlowOutcome.Skipped,
					reason: TokenSetAuthFlowReason.NoSnapshot,
					freshness,
				},
			};
		}

		if (
			freshness === TokenFreshnessState.Fresh ||
			freshness === TokenFreshnessState.NoExpiry
		) {
			const reason =
				freshness === TokenFreshnessState.Fresh
					? TokenSetAuthFlowReason.Fresh
					: TokenSetAuthFlowReason.NoExpiry;
			return {
				kind: "authenticated",
				snapshot,
				freshness,
				terminalEvent: {
					type: TokenSetAuthEventType.AuthCheckSkipped,
					outcome: TokenSetAuthFlowOutcome.Skipped,
					reason,
					freshness,
				},
			};
		}

		const forceRefreshWhenDue = options.forceRefreshWhenDue ?? false;
		if (
			freshness === TokenFreshnessState.RefreshDue &&
			!forceRefreshWhenDue &&
			options.allowBackgroundRefresh !== false
		) {
			return {
				kind: "authenticated",
				snapshot,
				freshness,
				backgroundRefresh: shouldRefreshAccessToken(snapshot, freshnessOptions),
			};
		}

		if (!snapshot.tokens.refreshMaterial) {
			return {
				kind: "unauthenticated",
				reason: TokenSetAuthFlowReason.NoRefreshMaterial,
				freshness,
				refreshSkippedReason: TokenSetAuthFlowReason.NoRefreshMaterial,
				clearState: options.clearStateWhenUnauthenticated !== false,
				terminalEvent: {
					type: TokenSetAuthEventType.AuthCheckSkipped,
					outcome: TokenSetAuthFlowOutcome.Skipped,
					reason: TokenSetAuthFlowReason.NoRefreshMaterial,
					freshness,
				},
			};
		}

		return {
			kind: "refresh",
			reason:
				freshness === TokenFreshnessState.Expired
					? TokenSetAuthFlowReason.Expired
					: TokenSetAuthFlowReason.RefreshDue,
		};
	}

	private async _commitAuthCheckPlan(
		context: AuthCheckContext,
		plan: AuthCheckPlan,
	): Promise<AuthCheckResult> {
		const { options, freshness, basePayload } = context;
		if (plan.kind === "authenticated") {
			this._emitAuthCheckTerminalEvent(options, plan.terminalEvent);
			if (plan.backgroundRefresh) {
				this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshSkipped, {
					...basePayload,
					outcome: TokenSetAuthFlowOutcome.Skipped,
					reason: TokenSetAuthFlowReason.BackgroundRefresh,
				});
				this._refreshThroughBarrier(basePayload).catch(() => {});
			}
			return this._authenticatedResult(plan.snapshot, plan.freshness, options);
		}

		if (plan.kind === "unauthenticated") {
			if (plan.refreshSkippedReason) {
				this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshSkipped, {
					...basePayload,
					outcome: TokenSetAuthFlowOutcome.Skipped,
					reason: plan.refreshSkippedReason,
				});
			}
			this._emitAuthCheckTerminalEvent(options, plan.terminalEvent);
			if (plan.clearState) {
				await this.clearState({ clearPersisted: true });
			}
			return this._unauthenticatedResult(options, plan.reason, plan.freshness);
		}

		this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshRequired, {
			...basePayload,
			reason: plan.reason,
		});
		const refreshed = await this._refreshThroughBarrier(basePayload);
		if (!refreshed) {
			this._emitAuthCheckTerminalEvent(options, {
				type: TokenSetAuthEventType.AuthCheckFailed,
				outcome: TokenSetAuthFlowOutcome.Failed,
				reason: TokenSetAuthFlowReason.RefreshFailed,
				freshness,
			});
			return this._unauthenticatedResult(
				options,
				TokenSetAuthFlowReason.RefreshFailed,
				freshness,
			);
		}
		const refreshedFreshness = getTokenFreshness(
			refreshed,
			this._freshnessOptions(options),
		);
		this._emitAuthCheckTerminalEvent(options, {
			type: TokenSetAuthEventType.AuthCheckCompleted,
			outcome: TokenSetAuthFlowOutcome.Authenticated,
			reason: TokenSetAuthFlowReason.RefreshSucceeded,
			freshness: refreshedFreshness,
		});
		return this._authenticatedResult(refreshed, refreshedFreshness, options);
	}

	/** Cancel pending refresh and release client resources. */
	dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		for (const subscription of [...this._authCheckSubscriptions]) {
			subscription.unsubscribe();
		}
		this._authCheckQueue.rejectQueued(
			new ClientError({
				kind: ClientErrorKind.Cancelled,
				code: `${this._tracePrefix}.auth_check_queue_disposed`,
				message: `${this._clientName} auth check queue was disposed`,
				source: this._traceScope,
			}),
		);
		this._onDispose();
		this._emitAuthDetermination({
			material: { kind: "current", snapshot: null },
			refreshScheduling: { kind: "cancel", reason: "dispose" },
		});
		this._rootCancellation.cancel(
			new ClientError({
				kind: ClientErrorKind.Cancelled,
				code: `${this._tracePrefix}.client_disposed`,
				message: `${this._clientName} was disposed`,
				source: this._traceScope,
			}),
		);
		this._authOperationSignals.restorePending.set(false);
		this._authOperationSignals.refreshPending.set(false);
		this._authOperationSignals.clearPending.set(false);
		this._authOperationSignals.loginPending.set(false);
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
		await this._emitAuthDetermination({
			material: { kind: "apply", snapshot },
			refreshScheduling: { kind: "schedule" },
			events: [
				{
					type: TokenSetAuthEventType.AuthAuthenticated,
					payload: {
						...payload,
						outcome: TokenSetAuthFlowOutcome.Authenticated,
						freshness: getTokenFreshness(snapshot, this._freshnessOptions()),
						hasRefreshMaterial: Boolean(snapshot.tokens.refreshMaterial),
					},
				},
			],
		});
	}

	protected _throwIfNotOperational(): void {
		this._rootCancellation.token.throwIfCancellationRequested();
	}

	protected async _trackRefreshOperation<T>(
		operation: () => Promise<T>,
	): Promise<T> {
		const alreadyPending = this._authOperationSignals.refreshPending.get();
		if (!alreadyPending) {
			this._authOperationSignals.refreshPending.set(true);
		}
		try {
			return await operation();
		} catch (error) {
			this._lastAuthErrorSignal.set(error);
			throw error;
		} finally {
			if (!alreadyPending) {
				this._authOperationSignals.refreshPending.set(false);
			}
		}
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
		if (!Number.isFinite(expiresAt)) {
			this._enqueueRefreshTimerAuthCheck();
			return;
		}
		const now = this._environment.clock.now();
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
			this._enqueueRefreshTimerAuthCheck();
			return;
		}

		const delayMs = Math.min(remainingMs, MAX_SCHEDULE_SLICE_MS);
		this._recordTrace(`${this._tracePrefix}.refresh.scheduled`, {
			refreshAt,
			delayMs,
			remainingMs,
			segmented: delayMs < remainingMs,
		});

		this._refreshHandle = this._environment.scheduler.setTimeout(
			delayMs,
			() => {
				if (this._rootCancellation.token.isCancellationRequested) {
					return;
				}

				const nextRemainingMs = refreshAt - this._environment.clock.now();
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

				this._enqueueRefreshTimerAuthCheck();
			},
		);
	}

	private _enqueueRefreshTimerAuthCheck(): void {
		this._refreshHandle = this._environment.scheduler.setTimeout(0, () => {
			this._refreshHandle = null;
			this._enqueueAuthCheck({
				source: TokenSetAuthFlowSource.Timer,
				reason: "refresh_timer",
				forceRefreshWhenDue: true,
				clearStateWhenUnauthenticated: true,
			}).catch(() => {});
		});
	}

	private _freshnessOptions(options: AuthCheckOptions = {}) {
		return {
			now: options.now ?? this._environment.clock.now(),
			clockSkewMs: options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS,
			refreshWindowMs: options.refreshWindowMs ?? this._refreshWindowMs,
		};
	}

	private _authenticatedResult(
		snapshot: AuthSnapshot,
		freshness: TokenFreshnessState,
		options: AuthCheckRunOptions,
	): AuthCheckResult {
		const source = options.source ?? TokenSetAuthFlowSource.ExplicitCall;
		const payload = this._authFlowPayload(options, {
			source,
			freshness,
			hasRefreshMaterial: Boolean(snapshot.tokens.refreshMaterial),
			outcome: TokenSetAuthFlowOutcome.Authenticated,
		});
		this._emitAuthDetermination({
			material: { kind: "current", snapshot },
			refreshScheduling:
				options.scheduleRefreshAfterAuthenticated === true
					? { kind: "schedule" }
					: { kind: "unchanged" },
			events: [
				{
					type: TokenSetAuthEventType.AuthAuthenticated,
					payload,
				},
			],
		});

		const authorizationHeader =
			freshBearerHeader(snapshot, this._freshnessOptions(options)) ?? undefined;
		return {
			status: AuthCheckStatus.Authenticated,
			snapshot,
			freshness,
			authorizationHeader,
		};
	}

	private _unauthenticatedResult(
		options: AuthCheckRunOptions,
		reason: TokenSetAuthFlowReason,
		freshness: TokenFreshnessState | undefined,
	): AuthCheckResult {
		const payload = this._authFlowPayload(options, {
			source: options.source ?? TokenSetAuthFlowSource.ExplicitCall,
			freshness,
			hasRefreshMaterial: false,
			outcome: TokenSetAuthFlowOutcome.Unauthenticated,
			reason,
		});
		this._emitAuthDetermination({
			material: { kind: "current", snapshot: null },
			refreshScheduling: {
				kind: "cancel",
				reason: `unauthenticated:${reason}`,
			},
			events: [
				{
					type: TokenSetAuthEventType.AuthUnauthenticated,
					payload,
				},
			],
		});
		return {
			status: AuthCheckStatus.Unauthenticated,
			snapshot: null,
			freshness,
			authorizationHeader: null,
			reason,
		};
	}

	private _authFlowPayload(
		options: AuthCheckRunOptions,
		payload: Pick<
			TokenSetAuthEventPayload,
			"source" | "freshness" | "hasRefreshMaterial" | "outcome" | "reason"
		>,
	): TokenSetAuthEventPayload {
		return {
			logicalClientId: this._logicalClientId,
			authCheckReason: options.reason,
			...payload,
		};
	}

	private _emitAuthEvent(
		type: TokenSetAuthEventType,
		payload: TokenSetAuthEventPayload,
	): void {
		this._authEventSubject.next(
			createTokenSetAuthEvent({
				id: `${this._tracePrefix}.auth.${++this._authEventSequence}`,
				type,
				at: this._environment.clock.now(),
				payload,
			}),
		);
	}

	protected _emitAuthDetermination(options: SyncAuthDeterminationOptions): void;
	protected _emitAuthDetermination(
		options: AsyncAuthDeterminationOptions,
	): Promise<void>;
	protected _emitAuthDetermination(
		options: AuthDeterminationOptions,
	): void | Promise<void> {
		const snapshot =
			options.material.kind === "clear" ? null : options.material.snapshot;
		const finish = () => {
			this._authSnapshotSignal.emit(snapshot);
			this._lastAuthErrorSignal.set(
				"error" in options ? options.error : undefined,
			);
			for (const event of options.events ?? []) {
				this._emitAuthEvent(event.type, event.payload);
			}
			this._applyAuthRefreshScheduling(options.refreshScheduling);
		};

		if (options.material.kind === "inject") {
			this._authMaterial.injectSnapshot(options.material.snapshot);
			finish();
			return;
		}
		if (options.material.kind === "current") {
			finish();
			return;
		}
		if (options.material.kind === "apply") {
			return this._authMaterial
				.applySnapshot(options.material.snapshot)
				.then(finish);
		}
		return this._authMaterial.clearState(options.material.options).then(finish);
	}

	private _applyAuthRefreshScheduling(
		refreshScheduling: AuthRefreshScheduling,
	): void {
		if (refreshScheduling.kind === "unchanged") {
			return;
		}
		if (refreshScheduling.kind === "cancel") {
			this._cancelRefresh(refreshScheduling.reason);
			return;
		}
		this._scheduleRefresh();
	}

	private _emitAuthCheckTerminalEvent(
		options: AuthCheckRunOptions,
		event: AuthCheckTerminalEventPlan | undefined,
	): void {
		if (!options.reason || !event) {
			return;
		}

		this._emitAuthEvent(
			event.type,
			this._authFlowPayload(options, {
				source: options.source ?? TokenSetAuthFlowSource.ExplicitCall,
				freshness: event.freshness,
				hasRefreshMaterial: Boolean(
					this._authMaterial.snapshot?.tokens.refreshMaterial,
				),
				outcome: event.outcome,
				reason: event.reason,
			}),
		);
	}

	private async _enqueueAuthCheck(
		trigger: TokenSetAuthCheckTriggerEvent,
	): Promise<AuthCheckResult> {
		this._throwIfNotOperational();
		return await this._authCheckQueue.enqueue(trigger);
	}

	private async _runAuthCheckTask(
		task: OnDemandTaskQueueTaskEnvelope<TokenSetAuthCheckTriggerEvent>,
	): Promise<AuthCheckResult> {
		this._throwIfNotOperational();
		const trigger = task.task;
		this._recordAuthCheckTaskTrace(trigger, {
			taskId: task.id,
			queuedForMs: Math.max(0, this._environment.clock.now() - task.enqueuedAt),
		});
		return await this._runAuthCheck(this._authCheckOptionsForTrigger(trigger));
	}

	private _recordAuthCheckTaskTrace(
		trigger: TokenSetAuthCheckTriggerEvent,
		attributes: {
			taskId?: number;
			queuedForMs?: number;
		},
	): void {
		this._recordTrace(`${this._tracePrefix}.auth_check.task.started`, {
			reason: trigger.reason,
			source: trigger.source,
			...attributes,
		});
	}

	private _authCheckOptionsForTrigger(
		trigger: TokenSetAuthCheckTriggerEvent,
	): AuthCheckRunOptions {
		return {
			source: trigger.source,
			forceRefreshWhenDue: trigger.forceRefreshWhenDue ?? true,
			clearStateWhenUnauthenticated:
				trigger.clearStateWhenUnauthenticated ?? true,
			scheduleRefreshAfterAuthenticated:
				trigger.scheduleRefreshAfterAuthenticated,
			allowBackgroundRefresh: trigger.allowBackgroundRefresh,
			clockSkewMs: trigger.clockSkewMs,
			refreshWindowMs: trigger.refreshWindowMs,
			reason: trigger.reason,
		};
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
		this._authOperationSignals.refreshPending.set(true);

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
					this._emitAuthDetermination({
						material: { kind: "current", snapshot: null },
						refreshScheduling: { kind: "unchanged" },
						events: [
							{
								type: TokenSetAuthEventType.AuthRefreshFailed,
								payload: {
									...payload,
									outcome: TokenSetAuthFlowOutcome.Failed,
									reason: TokenSetAuthFlowReason.RefreshFailed,
									refreshBarrierId,
								},
							},
						],
					});
					return null;
				}
				this._emitAuthDetermination({
					material: { kind: "current", snapshot: refreshed },
					refreshScheduling: { kind: "unchanged" },
					events: [
						{
							type: TokenSetAuthEventType.AuthRefreshSucceeded,
							payload: {
								...payload,
								outcome: TokenSetAuthFlowOutcome.Authenticated,
								freshness: getTokenFreshness(
									refreshed,
									this._freshnessOptions(),
								),
								hasRefreshMaterial: Boolean(refreshed.tokens.refreshMaterial),
								refreshBarrierId,
							},
						},
					],
				});
				return refreshed;
			} catch (error) {
				try {
					await this.clearState({ clearPersisted: true });
				} catch (clearError) {
					this._environment.logger?.log({
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
				this._emitAuthDetermination({
					material: { kind: "current", snapshot: null },
					refreshScheduling: { kind: "unchanged" },
					error,
					events: [
						{
							type: TokenSetAuthEventType.AuthRefreshFailed,
							payload: {
								...payload,
								outcome: TokenSetAuthFlowOutcome.Failed,
								reason: TokenSetAuthFlowReason.RefreshFailed,
								errorSummary: summarizeAuthError(error),
								refreshBarrierId,
							},
						},
					],
				});
				return null;
			} finally {
				this._activeRefreshAuthEventPayload = null;
				this._refreshBarrier = null;
				this._refreshBarrierId = null;
				this._authOperationSignals.refreshPending.set(false);
			}
		})();

		return this._refreshBarrier;
	}

	private _cancelRefresh(reason: string): void {
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
		const operation = this._environment.operationTracer?.startOperation(
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
		this._environment.traceSink?.record({
			type,
			at: this._environment.clock.now(),
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
