// Base OIDC Mode Client — shared lifecycle infrastructure
//
// Shared lifecycle host for backend/frontend OIDC mode clients:
//   - Auth snapshot authority + replay signals
//   - Queue-serialized top-level auth workflows
//   - Final candidate commit
//   - Persistence-backed restore helpers
//   - Cancellation / dispose
//   - Tracing helpers
//
// Planner modules are intentionally kept pure and closed:
// they return only final candidates and never enqueue follow-up tasks.

import type {
	CancellationTokenSourceTrait,
	EventStreamTrait,
	FoundationEnvironment,
	OperationScope,
	ReadableReplaySignalTrait,
	ReadableSignalTrait,
	SpanTrait,
	StorageTrait,
	WritableSignalTrait,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createAndThenComputedReplaySignal,
	createCancellationTokenSource,
	createEventReplaySubject,
	createEventSubject,
	createReplaySignal,
	createSignal,
	createSpan,
	describeError,
	readonlyReplaySignal,
	readonlySignal,
} from "@securitydept/client";
import {
	type Command,
	type CommandResponse,
	concatCommand,
	dispatchCommandLocallyToPromise,
} from "@securitydept/client/rx";
import { createOnceAsyncLockCallable } from "@securitydept/client/struct";
import { from, merge, takeUntil, withLatestFrom } from "rxjs";
import type { Disposable } from "vitest/optional-runtime-types.js";
import {
	createTokenSetAuthEvent,
	type TokenSetAuthEvent,
	type TokenSetAuthEventPayload,
	TokenSetAuthEventType,
} from "../events/auth-events";

import type {
	TokenFreshnessOptions,
	TokenFreshnessTiming,
} from "../token/freshness";
import { bearerHeader } from "../token/ops";
import type { AuthSnapshot } from "../token/types";
import type { AuthSnapshotPersistenceOptions } from "./persistence";
import {
	type AuthDeterminationCommit,
	PersistPolicy,
} from "./workflows/commit";
import { type PlanClearRequest, planClear } from "./workflows/plan/clear";
import {
	type FetchRefreshedSnapshot,
	type PlanRefreshRequest,
	type PlanRefreshResponse,
	planRefresh,
} from "./workflows/plan/refresh";
import {
	type PlanRestorePersistedRequest,
	type PlanRestoreRequest,
	planRestore,
	planRestorePersisted,
} from "./workflows/plan/restore";
import {
	type CreatePageResumeWorkflowSourceOptions,
	PageResumeWorkflowSource,
} from "./workflows/source/page-resume";
import {
	type CreateRefreshTimerWorkflowSourceOptions,
	RefreshTimerWorkflowSource,
} from "./workflows/source/refresh-timer";
import type { BuiltinAuthWorkflowSourceConfig } from "./workflows/source/types";

export interface BaseOidcModeClientOptions {
	environment: FoundationEnvironment;
	refresh?: Partial<{
		tokenFreshness?: Partial<TokenFreshnessOptions>;
		sources: {
			[RefreshTimerWorkflowSource.name]?: BuiltinAuthWorkflowSourceConfig<
				Partial<CreateRefreshTimerWorkflowSourceOptions>
			>;
			[PageResumeWorkflowSource.name]?: BuiltinAuthWorkflowSourceConfig<
				Partial<CreatePageResumeWorkflowSourceOptions>
			>;
		};
	}>;
	traceScope: string;
	traceSource: string;
	tracePrefix: string;
	clientName: string;
	logicalClientId?: string;
	persistence?: {
		store: StorageTrait;
		key: string;
	};
	autoStart?: boolean;
}

export abstract class BaseOidcModeClient implements Disposable {
	static defaultFreshnessOptions: TokenFreshnessOptions = {
		clockSkewMs: 60 * 1000,
		refreshWindowMs: 5 * 60 * 1000,
	};

	protected readonly _environment: FoundationEnvironment;
	protected readonly _freshnessOptions: TokenFreshnessOptions;
	protected readonly _traceScope: string;
	protected readonly _traceSource: string;
	protected readonly _tracePrefix: string;
	protected readonly _clientName: string;
	protected readonly _logicalClientId: string | undefined;
	protected readonly _persistence: AuthSnapshotPersistenceOptions | null;
	protected readonly _authSnapshotSignal =
		createReplaySignal<AuthSnapshot | null>();

	private readonly _lastAuthErrorSignal = createSignal<unknown | undefined>(
		undefined,
	);
	protected readonly _authOperationSignals: {
		readonly restorePending: WritableSignalTrait<boolean>;
		readonly refreshPending: WritableSignalTrait<boolean>;
		readonly clearPending: WritableSignalTrait<boolean>;
		readonly loginPending: WritableSignalTrait<boolean>;
	} = {
		restorePending: createSignal(false),
		refreshPending: createSignal(false),
		clearPending: createSignal(false),
		loginPending: createSignal(false),
	};
	protected readonly _rootCancellation: CancellationTokenSourceTrait =
		createCancellationTokenSource();

	private _disposed = false;
	private _destroyed = createEventReplaySubject<void>(1);
	public start = createOnceAsyncLockCallable(async () => {
		this._throwIfNotOperational();
		if (this._persistence) {
			return await this._restorePersistedState({
				persistence: this._persistence,
				time: this._environment.time,
				freshnessOptions: this._freshnessOptions,
			});
		} else {
			return await this._clearState({
				snapshot: null,
			});
		}
	});
	private _authEventSequence = 0;
	private readonly _authEventSubject =
		createEventReplaySubject<TokenSetAuthEvent>(100);
	readonly refreshWorkflowSubject = createEventSubject<void>();
	readonly planRefreshRequest =
		createEventSubject<Command<PlanRefreshRequest>>();
	readonly planRefreshResponse =
		createEventSubject<
			CommandResponse<Command<PlanRefreshRequest>, PlanRefreshResponse>
		>();

	readonly authDetermined: ReadableReplaySignalTrait<true>;
	readonly authSnapshot: ReadableReplaySignalTrait<AuthSnapshot | null>;
	readonly isAuthenticated: ReadableReplaySignalTrait<boolean>;
	readonly authorizationHeaderValue: ReadableReplaySignalTrait<
		string | undefined
	>;
	readonly lastAuthError: ReadableSignalTrait<unknown | undefined> =
		readonlySignal(this._lastAuthErrorSignal);
	readonly authOperations: {
		readonly restorePending: ReadableSignalTrait<boolean>;
		readonly refreshPending: ReadableSignalTrait<boolean>;
		readonly clearPending: ReadableSignalTrait<boolean>;
		readonly loginPending: ReadableSignalTrait<boolean>;
	} = {
		restorePending: readonlySignal(this._authOperationSignals.restorePending),
		refreshPending: readonlySignal(this._authOperationSignals.refreshPending),
		clearPending: readonlySignal(this._authOperationSignals.clearPending),
		loginPending: readonlySignal(this._authOperationSignals.loginPending),
	};
	readonly authEvents: EventStreamTrait<TokenSetAuthEvent> =
		this._authEventSubject;
	readonly refreshTimerWorkflowSource: RefreshTimerWorkflowSource;
	readonly pageResumeWorkflowSource: PageResumeWorkflowSource;

	protected constructor(options: BaseOidcModeClientOptions) {
		this._environment = options.environment;
		this._traceScope = options.traceScope;
		this._traceSource = options.traceSource;
		this._tracePrefix = options.tracePrefix;
		this._clientName = options.clientName;
		this._logicalClientId = options.logicalClientId;
		this._freshnessOptions = Object.assign(
			{},
			BaseOidcModeClient.defaultFreshnessOptions,
			options.refresh?.tokenFreshness,
		);
		this._persistence = options.persistence
			? {
					store: options.persistence.store,
					key: options.persistence.key,
					time: options.environment.time,
				}
			: null;

		this.authSnapshot = readonlyReplaySignal(this._authSnapshotSignal);
		this.authDetermined = createAndThenComputedReplaySignal(
			this._authSnapshotSignal,
			() => ({ kind: "value", value: true }),
		);
		this.authorizationHeaderValue = createAndThenComputedReplaySignal(
			this._authSnapshotSignal,
			(snapshot) => ({
				kind: "value",
				value: bearerHeader(snapshot?.tokens) ?? undefined,
			}),
		);
		this.isAuthenticated = createAndThenComputedReplaySignal(
			this.authorizationHeaderValue,
			(headerValue) => ({ kind: "value", value: headerValue !== undefined }),
		);

		this.refreshTimerWorkflowSource = RefreshTimerWorkflowSource.fromBuiltin(
			{
				time: options.environment.time,
				freshnessOptions: this._freshnessOptions,
				authSnapshot: this.authSnapshot,
			},
			options.refresh?.sources?.[RefreshTimerWorkflowSource.name],
		);

		this.pageResumeWorkflowSource = PageResumeWorkflowSource.fromBuiltin(
			{
				pageLifecycle: options.environment.pageLifecycle,
				time: options.environment.time,
			},
			options.refresh?.sources?.[PageResumeWorkflowSource.name],
		);

		merge(
			this.pageResumeWorkflowSource.eventStream,
			this.refreshTimerWorkflowSource.eventStream,
		)
			.pipe(takeUntil(this._destroyed))
			.subscribe(() => {
				this.refreshWorkflowSubject.next();
			});

		from(this.refreshWorkflowSubject)
			.pipe(withLatestFrom(this.authSnapshot), takeUntil(this._destroyed))
			.subscribe(([_, snapshot]) => {
				this._refreshState({
					snapshot: snapshot,
					freshnessOptions: this._freshnessOptions,
				});
			});

		from(this.planRefreshRequest)
			.pipe(
				concatCommand((request) => planRefresh(request.payload)),
				takeUntil(this._destroyed),
			)
			.subscribe(this.planRefreshResponse);

		if (options.autoStart === true) {
			this.start().catch(() => {
				// Startup failures are reflected through lastAuthError.
			});
		}
	}

	async restoreState(snapshot: AuthSnapshot): Promise<AuthSnapshot> {
		this._throwIfNotOperational();
		return this._restoreState({
			snapshot,
		});
	}

	async restorePersistedState(): Promise<AuthSnapshot | null> {
		this._throwIfNotOperational();
		if (this._persistence === null) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				message:
					"restorePersistedState() requires configured persistence for this client.",
				code: "auth_restore.persistence_unavailable",
				source: this._traceScope,
			});
		}
		return await this._restorePersistedState({
			persistence: this._persistence,
			time: this._environment.time,
			freshnessOptions: this._freshnessOptions,
		});
	}

	async clearState(
		_options: { persistPolicy?: PersistPolicy } = {},
	): Promise<void> {
		await this._clearState({});
	}

	async refreshState(): Promise<AuthSnapshot | null> {
		const determinatedSnapshot = await this.authSnapshot.whenValue();
		return this._refreshState({
			snapshot: determinatedSnapshot,
			freshnessOptions: this._freshnessOptions,
		});
	}

	private _createRefreshFetcher(): FetchRefreshedSnapshot {
		return async (snapshot, freshnessTiming) => {
			this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshRequired, {});
			try {
				this._authOperationSignals.refreshPending.set(true);
				this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshStarted, {});
				return await this._refreshAuthSnapshot(snapshot, freshnessTiming);
			} finally {
				this._authOperationSignals.refreshPending.set(false);
			}
		};
	}

	protected async _refreshState(request: {
		snapshot: AuthSnapshot | null;
		freshnessOptions: TokenFreshnessOptions;
	}): Promise<AuthSnapshot | null> {
		this._throwIfNotOperational();
		try {
			this._authOperationSignals.refreshPending.set(true);
			const currentSnapshot = await this._authSnapshotSignal.whenValue();
			if (currentSnapshot) {
				const refreshPlan = await this._planRefreshInQueue({
					snapshot: currentSnapshot,
					freshnessOptions: request.freshnessOptions,
				});
				return this._commitDetermination({
					candidate: refreshPlan,
					persistPolicy: PersistPolicy.FollowClient,
					events: [],
					result: refreshPlan.snapshot ?? null,
				});
			} else {
				return currentSnapshot;
			}
		} finally {
			this._authOperationSignals.refreshPending.set(false);
		}
	}

	protected async _clearState(request: PlanClearRequest): Promise<null> {
		this._throwIfNotOperational();
		this._authOperationSignals.clearPending.set(true);
		try {
			const clearPlan = await planClear(request);
			return await this._commitDetermination({
				candidate: clearPlan,
				persistPolicy: PersistPolicy.FollowClient,
				events: [
					{
						type: TokenSetAuthEventType.AuthMaterialCleared,
						payload: {},
					},
				],
				result: null,
				trace: {
					type: `${this._tracePrefix}.state.cleared`,
					attributes: {},
				},
			});
		} finally {
			this._authOperationSignals.clearPending.set(false);
		}
	}

	protected async _restoreState(
		request: PlanRestoreRequest,
	): Promise<AuthSnapshot> {
		this._throwIfNotOperational();
		this._authOperationSignals.restorePending.set(false);
		try {
			const restorePlan = await planRestore(request);
			return await this._commitDetermination({
				candidate: restorePlan,
				persistPolicy: PersistPolicy.Skip,
				events: [
					{
						type: TokenSetAuthEventType.AuthMaterialRestored,
						payload: {},
					},
					{
						type: TokenSetAuthEventType.AuthAuthenticated,
						payload: {},
					},
				],
				result: restorePlan.snapshot,
				trace: {
					type: `${this._tracePrefix}.state.restored`,
					attributes: {},
				},
			});
		} finally {
			this._authOperationSignals.restorePending.set(false);
		}
	}

	protected async _restorePersistedState(
		request: PlanRestorePersistedRequest,
	): Promise<AuthSnapshot | null> {
		this._throwIfNotOperational();
		this._emitAuthEvent(TokenSetAuthEventType.AuthMaterialRestoreStarted, {
			persisted: true,
		});
		try {
			this._authOperationSignals.restorePending.set(true);
			const restorePlan = await planRestorePersisted(request);
			if (restorePlan.snapshot) {
				const refreshPlan = await this._planRefreshInQueue({
					snapshot: restorePlan.snapshot,
					freshnessOptions: request.freshnessOptions,
				});
				return this._commitDetermination({
					candidate: refreshPlan,
					persistPolicy: PersistPolicy.FollowClient,
					events: [
						// TODO
					],
					result: refreshPlan.snapshot ?? null,
				});
			} else {
				return this._commitDetermination({
					candidate: restorePlan,
					persistPolicy: PersistPolicy.FollowClient,
					events: [
						// TODO
					],
					result: null,
				});
			}
		} finally {
			this._authOperationSignals.restorePending.set(false);
		}
	}

	private async _planRefreshInQueue(
		request: Omit<PlanRefreshRequest, "fetchRefreshedSnapshot" | "time">,
	): Promise<PlanRefreshResponse> {
		const refreshedPlan = await dispatchCommandLocallyToPromise({
			requestStream: this.planRefreshRequest,
			responseStream: this.planRefreshResponse,
			payload: {
				snapshot: request.snapshot,
				freshnessOptions: request.freshnessOptions,
				fetchRefreshedSnapshot: this._createRefreshFetcher(),
			},
		});
		return refreshedPlan.data;
	}

	[Symbol.dispose](): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._destroyed.next();
		this._onDispose();
		this._rootCancellation.cancel(
			new ClientError({
				kind: ClientErrorKind.Cancelled,
				code: `${this._tracePrefix}.client_disposed`,
				message: `${this._clientName} was disposed`,
				source: this._traceScope,
			}),
		);
		this._recordTrace(`${this._tracePrefix}.disposed`);
	}

	protected abstract _refreshAuthSnapshot(
		authSnapshot: AuthSnapshot,
		freshnessTiming: TokenFreshnessTiming,
	): Promise<AuthSnapshot | null>;

	protected _onDispose(): void {
		// Default no-op. Subclasses override as needed.
	}

	protected _throwIfNotOperational(): void {
		this._rootCancellation.token.throwIfCancellationRequested();
	}

	private async _commitDetermination<TResult>(
		commit: AuthDeterminationCommit<TResult>,
	): Promise<TResult> {
		this._authSnapshotSignal.setValue(commit.candidate.snapshot ?? null);
		this._lastAuthErrorSignal.set(commit.candidate.error);
		for (const event of commit.events ?? []) {
			this._emitAuthEvent(event.type, event.payload);
		}
		if (commit.trace) {
			if (commit.traceError !== undefined) {
				this._recordFailureTrace(
					commit.trace.type,
					commit.traceError,
					commit.trace.attributes,
				);
			} else {
				this._recordTrace(commit.trace.type, commit.trace.attributes);
			}
		}
		return commit.result;
	}

	private _emitAuthEvent(
		type: TokenSetAuthEventType,
		payload: TokenSetAuthEventPayload,
	): void {
		this._authEventSubject.next(
			createTokenSetAuthEvent({
				id: `${this._tracePrefix}.auth.${++this._authEventSequence}`,
				type,
				at: this._environment.time.now(),
				payload,
			}),
		);
	}

	private _forkWorkflowSpan(
		attributes?: Record<string, unknown>,
	): SpanTrait | undefined {
		const spanContext = this._environment.spanContext;
		if (!spanContext) {
			return undefined;
		}
		const currentSpan = spanContext.currentSpan();
		return (
			currentSpan?.fork({ attributes }) ??
			createSpan({
				attributes,
			})
		);
	}

	protected async _runOperation<T>(
		name: string,
		attributes: Record<string, unknown> | undefined,
		execute: (operation: OperationScope | undefined) => Promise<T>,
	): Promise<T> {
		const operation =
			this._environment.telemetry?.operationTracer?.startOperation(
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
		const currentSpan = this._environment.spanContext?.currentSpan();
		this._environment.telemetry?.traceSink?.record({
			type,
			at: this._environment.time.now(),
			scope: this._traceScope,
			operationId: operation?.id,
			spanId: currentSpan?.id,
			parentSpanId: currentSpan?.parentId,
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
