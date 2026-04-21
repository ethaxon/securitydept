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
	OperationScope,
	ReadableSignalTrait,
	RecordStore,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createCancellationTokenSource,
	createSignal,
	LogLevel,
	readonlySignal,
} from "@securitydept/client";
import type { AuthMaterialController } from "./controller";
import { createAuthMaterialController } from "./controller";
import type { AuthSnapshot } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Maximum single setTimeout slice (30 minutes) — avoids platform timer overflow.
const MAX_SCHEDULE_SLICE_MS = 30 * 60 * 1000;

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
	/** Persistence config. When provided, the controller can restore/save to a durable store. */
	persistence?: {
		store: RecordStore;
		key: string;
	};
}

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

	// --- State management ---
	protected readonly _authMaterial: AuthMaterialController;
	protected readonly _stateSignal = createSignal<AuthSnapshot | null>(null);
	protected readonly _rootCancellation: CancellationTokenSourceTrait =
		createCancellationTokenSource();
	private _refreshHandle: CancelableHandle | null = null;
	private _disposed = false;

	/** Read-only signal exposing the current auth state snapshot. */
	readonly state: ReadableSignalTrait<AuthSnapshot | null>;

	protected constructor(options: BaseOidcModeClientOptions) {
		this._runtime = options.runtime;
		this._refreshWindowMs = options.refreshWindowMs;
		this._traceScope = options.traceScope;
		this._traceSource = options.traceSource;
		this._tracePrefix = options.tracePrefix;
		this._clientName = options.clientName;

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
			return null;
		}

		this._throwIfNotOperational();

		if (!snapshot) {
			return null;
		}

		this._stateSignal.set(snapshot);
		this._scheduleRefresh();
		this._recordTrace(`${this._tracePrefix}.state.restored`, {
			sourceKind: StateRestoreSourceKind.PersistentStore,
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
		this._recordTrace(`${this._tracePrefix}.state.cleared`, {
			clearPersisted: options.clearPersisted ?? true,
		});
	}

	/** Get the current bearer authorization header value. */
	authorizationHeader(): string | null {
		return this._authMaterial.authorizationHeader;
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

	protected async _applySnapshot(snapshot: AuthSnapshot): Promise<void> {
		await this._authMaterial.applySnapshot(snapshot);
		this._stateSignal.set(snapshot);
		this._scheduleRefresh();
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
		const refreshAt = expiresAt - this._refreshWindowMs;
		const now = this._runtime.clock.now();
		const remainingMs = refreshAt - now;

		if (remainingMs <= 0) {
			this._recordTrace(`${this._tracePrefix}.refresh.fired`, {
				trigger: RefreshTriggerKind.Immediate,
			});
			this.refresh().catch(() => {});
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

			this.refresh().catch(() => {});
		});
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
