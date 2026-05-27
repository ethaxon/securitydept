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

import {
	type CancellationTokenSourceTrait,
	ClientError,
	ClientErrorKind,
	createAndThenComputedReplaySignal,
	createCancellationTokenSource,
	createEventReplaySubject,
	createEventSubject,
	createOnceAsyncLockCallable,
	createReplaySignal,
	createSignal,
	type DisposableTrait,
	defineInstrumentMethodDecorator,
	describeError,
	type EventStreamTrait,
	type FoundationEnvironment,
	type OperationSpanTrait,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
	readonlyReplaySignal,
	readonlySignal,
	type SpanTrait,
	SYMBOL_DISPOSE,
	type WritableSignalTrait,
} from "@securitydept/client";
import {
	type Command,
	type CommandResponse,
	concatCommand,
	dispatchCommandLocallyToPromise,
	signalToObservable,
} from "@securitydept/client/rx";
import { from, merge, takeUntil, withLatestFrom } from "rxjs";
import { v7 as uuidv7 } from "uuid";
import {
	createTokenSetAuthEvent,
	summarizeAuthError,
	type TokenSetAuthEvent,
	type TokenSetAuthEventPayload,
	TokenSetAuthEventType,
} from "../events/auth-events";
import {
	type TokenFreshnessOptions,
	TokenFreshnessState,
	type TokenFreshnessTiming,
} from "../token/freshness";
import { bearerHeader } from "../token/ops";
import { type AuthSnapshot } from "../token/types";
import {
	type AuthSnapshotPersistenceOptions,
	clearPersistedAuthSnapshot,
	savePersistedAuthSnapshot,
} from "./persistence";
import {
	type BaseOidcModeClientOptions,
	type TokenSetAuthOperationSignals,
} from "./types";
import {
	type AuthDeterminationCommit,
	type AuthDeterminationEvent,
	AuthDeterminationKind,
	PersistPolicy,
} from "./workflows/commit";

export { PersistPolicy } from "./workflows/commit";

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
import { PageResumeWorkflowSource } from "./workflows/source/page-resume";
import { RefreshTimerWorkflowSource } from "./workflows/source/refresh-timer";
import { TokenSetOrchestrationTraceEvent } from "./workflows/trace-events";

const instrumentWorkflowMethod = defineInstrumentMethodDecorator<
	[workflow: string],
	BaseOidcModeClient
>(
	({ factoryArgs: [workflow] }) =>
		function (this: BaseOidcModeClient) {
			return {
				environment: this.environment,
				span: this.span,
				name: `${this._tracePrefix}.${workflow}`,
				fields: { workflow },
				target: this._traceTarget,
			};
		},
);

export abstract class BaseOidcModeClient implements DisposableTrait {
	static defaultFreshnessOptions: TokenFreshnessOptions = {
		clockSkewMs: 60 * 1000,
		refreshWindowMs: 5 * 60 * 1000,
	};

	protected readonly _environment: FoundationEnvironment;
	protected readonly _freshnessOptions: TokenFreshnessOptions;
	protected readonly _traceTarget: string;
	protected readonly _tracePrefix: string;
	protected readonly _clientName: string;
	protected readonly _persistence: AuthSnapshotPersistenceOptions | null;
	protected readonly _span: SpanTrait;
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
	readonly authOperations: TokenSetAuthOperationSignals = {
		restorePending: readonlySignal(this._authOperationSignals.restorePending),
		refreshPending: readonlySignal(this._authOperationSignals.refreshPending),
		clearPending: readonlySignal(this._authOperationSignals.clearPending),
		loginPending: readonlySignal(this._authOperationSignals.loginPending),
	};
	readonly authEvents: EventStreamTrait<TokenSetAuthEvent> =
		this._authEventSubject;
	readonly refreshTimerWorkflowSource: RefreshTimerWorkflowSource;
	readonly pageResumeWorkflowSource: PageResumeWorkflowSource;
	readonly id: string;

	protected get environment(): FoundationEnvironment {
		return this._environment;
	}

	protected get span(): SpanTrait {
		return this._span;
	}

	protected constructor(options: BaseOidcModeClientOptions) {
		this._environment = options.environment;
		this._traceTarget = options.traceTarget;
		this._tracePrefix = options.tracePrefix;
		this._clientName = options.clientName;
		this.id = options.id ?? uuidv7();
		this._span = options.environment.span.fork({
			attributes: {
				clientName: options.clientName,
				id: this.id,
			},
		});
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
				recordTrace: (type, attributes) => {
					this._recordTrace(
						`${this._tracePrefix}.${RefreshTimerWorkflowSource.name}.${type}`,
						attributes,
						this._span,
					);
				},
			},
			options.refresh?.sources?.[RefreshTimerWorkflowSource.name],
		);

		this.pageResumeWorkflowSource = PageResumeWorkflowSource.fromBuiltin(
			{
				pageLifecycle: options.environment.pageLifecycle,
				time: options.environment.time,
				recordTrace: (type, attributes) => {
					this._recordTrace(
						`${this._tracePrefix}.${PageResumeWorkflowSource.name}.${type}`,
						attributes,
						this._span,
					);
				},
			},
			options.refresh?.sources?.[PageResumeWorkflowSource.name],
		);

		merge(
			from(this.pageResumeWorkflowSource.eventStream),
			from(this.refreshTimerWorkflowSource.eventStream),
		)
			.pipe(takeUntil(this._destroyed))
			.subscribe(() => {
				this.refreshWorkflowSubject.next();
			});

		from(this.refreshWorkflowSubject)
			.pipe(
				withLatestFrom(signalToObservable(this.authSnapshot)),
				takeUntil(this._destroyed),
			)
			.subscribe(([_, snapshot]) => {
				this._refreshState({
					snapshot: snapshot,
					freshnessOptions: this._freshnessOptions,
				});
			});

		from(this.planRefreshRequest)
			.pipe(concatCommand((request) => planRefresh(request.payload)))
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
				source: this._traceTarget,
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

	protected async _applySnapshot(
		snapshot: AuthSnapshot,
		options: { persistPolicy?: PersistPolicy } = {},
		span?: SpanTrait,
	): Promise<AuthSnapshot> {
		this._throwIfNotOperational();
		return await this._commitDetermination(
			{
				candidate: {
					kind: AuthDeterminationKind.Authenticated,
					snapshot,
				},
				persistPolicy: options.persistPolicy ?? PersistPolicy.FollowClient,
				events: [
					{
						type: TokenSetAuthEventType.AuthAuthenticated,
						payload: this._authIdentity(),
					},
				],
				result: snapshot,
			},
			span,
		);
	}

	private _createRefreshFetcher(
		operationSpan?: SpanTrait,
	): FetchRefreshedSnapshot {
		return async (snapshot, freshnessTiming) => {
			const hasRefreshMaterial = snapshot.tokens.refreshMaterial != null;
			this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshRequired, {
				...this._authIdentity(),
				freshness: freshnessTiming,
				hasRefreshMaterial,
			});
			try {
				this._authOperationSignals.refreshPending.set(true);
				this._emitAuthEvent(TokenSetAuthEventType.AuthRefreshStarted, {
					...this._authIdentity(),
					freshness: freshnessTiming,
					hasRefreshMaterial,
				});
				const refreshed = await this._refreshAuthSnapshot(
					snapshot,
					freshnessTiming,
					operationSpan,
				);
				return refreshed;
			} finally {
				this._authOperationSignals.refreshPending.set(false);
			}
		};
	}

	@instrumentWorkflowMethod("refresh")
	protected async _refreshState(
		request: {
			snapshot: AuthSnapshot | null;
			freshnessOptions: TokenFreshnessOptions;
		},
		operationSpan?: OperationSpanTrait,
	): Promise<AuthSnapshot | null> {
		this._throwIfNotOperational();
		try {
			this._authOperationSignals.refreshPending.set(true);
			const currentSnapshot = await this._authSnapshotSignal.whenValue();
			if (!currentSnapshot) {
				return currentSnapshot;
			}
			const refreshPlan = await this._planRefreshInQueue(
				{
					snapshot: currentSnapshot,
					freshnessOptions: request.freshnessOptions,
				},
				operationSpan,
			);
			if (refreshPlan.kind === AuthDeterminationKind.Failed) {
				return this._commitDetermination(
					{
						candidate: refreshPlan,
						persistPolicy: PersistPolicy.FollowClient,
						events: [
							...this._buildRefreshLifecycleEvents(
								currentSnapshot,
								refreshPlan,
							),
							{
								type: TokenSetAuthEventType.AuthUnauthenticated,
								payload: this._authIdentity(),
							},
						],
						result: null,
						trace: {
							type: this._traceType(
								TokenSetOrchestrationTraceEvent.RefreshFailed,
							),
						},
						traceError: refreshPlan.error,
					},
					operationSpan,
				);
			}
			return this._commitDetermination(
				{
					candidate: refreshPlan,
					persistPolicy: PersistPolicy.FollowClient,
					events: [
						...this._buildRefreshLifecycleEvents(currentSnapshot, refreshPlan),
						refreshPlan.kind === AuthDeterminationKind.Authenticated
							? {
									type: TokenSetAuthEventType.AuthAuthenticated,
									payload: this._authIdentity(),
								}
							: {
									type: TokenSetAuthEventType.AuthUnauthenticated,
									payload: this._authIdentity(),
								},
					],
					result: refreshPlan.snapshot ?? null,
					trace: {
						type: this._traceType(
							TokenSetOrchestrationTraceEvent.RefreshCommitted,
						),
					},
				},
				operationSpan,
			);
		} finally {
			this._authOperationSignals.refreshPending.set(false);
		}
	}

	@instrumentWorkflowMethod("clear")
	protected async _clearState(
		request: PlanClearRequest,
		operationSpan?: OperationSpanTrait,
	): Promise<null> {
		this._throwIfNotOperational();
		this._authOperationSignals.clearPending.set(true);
		try {
			const clearPlan = await planClear(request);
			return await this._commitDetermination(
				{
					candidate: clearPlan,
					persistPolicy: PersistPolicy.FollowClient,
					events: [
						{
							type: TokenSetAuthEventType.AuthMaterialCleared,
							payload: this._authIdentity(),
						},
					],
					result: null,
					trace: {
						type: this._traceType(TokenSetOrchestrationTraceEvent.StateCleared),
					},
				},
				operationSpan,
			);
		} finally {
			this._authOperationSignals.clearPending.set(false);
		}
	}

	@instrumentWorkflowMethod("restore")
	protected async _restoreState(
		request: PlanRestoreRequest,
		operationSpan?: OperationSpanTrait,
	): Promise<AuthSnapshot> {
		this._throwIfNotOperational();
		this._authOperationSignals.restorePending.set(true);
		try {
			const restorePlan = await planRestore(request);
			return await this._commitDetermination(
				{
					candidate: restorePlan,
					persistPolicy: PersistPolicy.Skip,
					events: [
						{
							type: TokenSetAuthEventType.AuthMaterialRestored,
							payload: this._authIdentity(),
						},
						{
							type: TokenSetAuthEventType.AuthAuthenticated,
							payload: this._authIdentity(),
						},
					],
					result: restorePlan.snapshot,
					trace: {
						type: this._traceType(
							TokenSetOrchestrationTraceEvent.StateRestored,
						),
					},
				},
				operationSpan,
			);
		} finally {
			this._authOperationSignals.restorePending.set(false);
		}
	}

	@instrumentWorkflowMethod("restore.persisted")
	protected async _restorePersistedState(
		request: PlanRestorePersistedRequest,
		operationSpan?: OperationSpanTrait,
	): Promise<AuthSnapshot | null> {
		this._throwIfNotOperational();
		this._emitAuthEvent(TokenSetAuthEventType.AuthMaterialRestoreStarted, {
			...this._authIdentity(),
			persisted: true,
		});
		this._recordTrace(
			this._traceType(TokenSetOrchestrationTraceEvent.PersistedRestoreStarted),
			undefined,
			operationSpan ?? this._span,
		);
		try {
			this._authOperationSignals.restorePending.set(true);
			const restorePlan = await planRestorePersisted(request);
			if (restorePlan.kind === AuthDeterminationKind.Failed) {
				return this._commitDetermination(
					{
						candidate: restorePlan,
						persistPolicy: PersistPolicy.FollowClient,
						events: [
							{
								type: TokenSetAuthEventType.AuthMaterialRestoreFailed,
								payload: {
									...this._authIdentity(),
									persisted: true,
									errorSummary: summarizeAuthError(restorePlan.error),
								},
							},
						],
						result: null,
						trace: {
							type: this._traceType(
								TokenSetOrchestrationTraceEvent.PersistedRestoreFailed,
							),
						},
						traceError: restorePlan.error,
					},
					operationSpan,
				);
			}
			if (restorePlan.kind === AuthDeterminationKind.Unauthenticated) {
				return this._commitDetermination(
					{
						candidate: restorePlan,
						persistPolicy: PersistPolicy.FollowClient,
						events: [
							{
								type: TokenSetAuthEventType.AuthUnauthenticated,
								payload: this._authIdentity(),
							},
						],
						result: null,
						trace: {
							type: this._traceType(
								TokenSetOrchestrationTraceEvent.PersistedRestoreLoaded,
							),
						},
					},
					operationSpan,
				);
			}
			// A persisted snapshot was loaded; reconcile its freshness before
			// committing the restored determination.
			const refreshPlan = await this._planRefreshInQueue(
				{
					snapshot: restorePlan.snapshot,
					freshnessOptions: request.freshnessOptions,
				},
				operationSpan,
			);
			if (refreshPlan.kind === AuthDeterminationKind.Failed) {
				return this._commitDetermination(
					{
						candidate: refreshPlan,
						persistPolicy: PersistPolicy.FollowClient,
						events: [
							...this._buildRefreshLifecycleEvents(
								restorePlan.snapshot,
								refreshPlan,
							),
							{
								type: TokenSetAuthEventType.AuthMaterialRestoreFailed,
								payload: {
									...this._authIdentity(),
									persisted: true,
									errorSummary: summarizeAuthError(refreshPlan.error),
								},
							},
						],
						result: null,
						trace: {
							type: this._traceType(
								TokenSetOrchestrationTraceEvent.PersistedRestoreFailed,
							),
						},
						traceError: refreshPlan.error,
					},
					operationSpan,
				);
			}
			if (refreshPlan.kind === AuthDeterminationKind.Authenticated) {
				return this._commitDetermination(
					{
						candidate: refreshPlan,
						persistPolicy: PersistPolicy.FollowClient,
						events: [
							...this._buildRefreshLifecycleEvents(
								restorePlan.snapshot,
								refreshPlan,
							),
							{
								type: TokenSetAuthEventType.AuthMaterialRestored,
								payload: { ...this._authIdentity(), persisted: true },
							},
							{
								type: TokenSetAuthEventType.AuthAuthenticated,
								payload: this._authIdentity(),
							},
						],
						result: refreshPlan.snapshot,
						trace: {
							type: this._traceType(
								TokenSetOrchestrationTraceEvent.PersistedRestoreLoaded,
							),
						},
					},
					operationSpan,
				);
			}
			// Persisted snapshot loaded but the refresh determination found it is
			// no longer usable.
			return this._commitDetermination(
				{
					candidate: refreshPlan,
					persistPolicy: PersistPolicy.FollowClient,
					events: [
						...this._buildRefreshLifecycleEvents(
							restorePlan.snapshot,
							refreshPlan,
						),
						{
							type: TokenSetAuthEventType.AuthUnauthenticated,
							payload: this._authIdentity(),
						},
					],
					result: null,
					trace: {
						type: this._traceType(
							TokenSetOrchestrationTraceEvent.PersistedRestoreLoaded,
						),
					},
				},
				operationSpan,
			);
		} finally {
			this._authOperationSignals.restorePending.set(false);
		}
	}

	private async _planRefreshInQueue(
		request: Omit<PlanRefreshRequest, "fetchRefreshedSnapshot" | "time">,
		operationSpan?: SpanTrait,
	): Promise<PlanRefreshResponse> {
		const refreshedPlan = await dispatchCommandLocallyToPromise({
			requestStream: this.planRefreshRequest,
			responseStream: this.planRefreshResponse,
			payload: {
				snapshot: request.snapshot,
				freshnessOptions: request.freshnessOptions,
				time: this._environment.time,
				fetchRefreshedSnapshot: this._createRefreshFetcher(operationSpan),
			},
		});
		return refreshedPlan.data;
	}

	dispose(): void {
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
				source: this._traceTarget,
			}),
		);
		this._recordTrace(
			this._traceType(TokenSetOrchestrationTraceEvent.Disposed),
			undefined,
			this._span,
		);
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	protected abstract _refreshAuthSnapshot(
		authSnapshot: AuthSnapshot,
		freshnessTiming: TokenFreshnessTiming,
		operationSpan?: SpanTrait,
	): Promise<AuthSnapshot | null>;

	protected _onDispose(): void {
		// Default no-op. Subclasses override as needed.
	}

	protected _throwIfNotOperational(): void {
		this._rootCancellation.token.throwIfCancellationRequested();
	}

	private async _commitDetermination<TResult>(
		commit: AuthDeterminationCommit<TResult>,
		span?: SpanTrait,
	): Promise<TResult> {
		this._authSnapshotSignal.setValue(commit.candidate.snapshot ?? null);
		this._lastAuthErrorSignal.set(commit.candidate.error);
		await this._syncPersistence(commit);
		for (const event of commit.events ?? []) {
			this._emitAuthEvent(event.type, event.payload);
		}
		if (commit.trace) {
			if (commit.traceError !== undefined) {
				this._recordFailureTrace(
					commit.trace.type,
					commit.traceError,
					commit.trace.attributes,
					span ?? this._span,
				);
			} else {
				this._recordTrace(
					commit.trace.type,
					commit.trace.attributes,
					span ?? this._span,
				);
			}
		}
		return commit.result;
	}

	private async _syncPersistence<TResult>(
		commit: AuthDeterminationCommit<TResult>,
	): Promise<void> {
		if (
			commit.persistPolicy !== PersistPolicy.FollowClient ||
			this._persistence === null
		) {
			return;
		}

		try {
			if (commit.candidate.snapshot) {
				await savePersistedAuthSnapshot(
					this._persistence,
					commit.candidate.snapshot,
				);
			} else {
				await clearPersistedAuthSnapshot(this._persistence);
			}
		} catch (error) {
			if (commit.candidate.error === undefined) {
				this._lastAuthErrorSignal.set(error);
			}
		}
	}

	private _emitAuthEvent<TType extends TokenSetAuthEventType>(
		type: TType,
		payload: TokenSetAuthEventPayload<TType>,
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

	private _authIdentity(): TokenSetAuthEventPayload<
		typeof TokenSetAuthEventType.AuthAuthenticated
	> {
		return { id: this.id };
	}

	private _buildRefreshLifecycleEvents(
		snapshotBeforeRefresh: AuthSnapshot,
		refreshPlan: PlanRefreshResponse,
	): AuthDeterminationEvent[] {
		const events: AuthDeterminationEvent[] = [];
		if (this._didRunRefreshProtocol(snapshotBeforeRefresh, refreshPlan)) {
			if (refreshPlan.kind === AuthDeterminationKind.Authenticated) {
				events.push({
					type: TokenSetAuthEventType.AuthRefreshSucceeded,
					payload: {
						...this._authIdentity(),
						freshness: refreshPlan.freshness,
						hasRefreshMaterial: true,
					},
				});
			}
			if (refreshPlan.kind === AuthDeterminationKind.Failed) {
				events.push({
					type: TokenSetAuthEventType.AuthRefreshFailed,
					payload: {
						...this._authIdentity(),
						freshness: refreshPlan.freshness,
						hasRefreshMaterial: true,
						errorSummary: summarizeAuthError(refreshPlan.error),
					},
				});
			}
		}
		return events;
	}

	private _didRunRefreshProtocol(
		snapshotBeforeRefresh: AuthSnapshot,
		refreshPlan: PlanRefreshResponse,
	): boolean {
		return (
			snapshotBeforeRefresh.tokens.refreshMaterial != null &&
			refreshPlan.freshness.state !== TokenFreshnessState.Fresh &&
			refreshPlan.freshness.state !== TokenFreshnessState.NoExpiry
		);
	}

	private _traceType(event: TokenSetOrchestrationTraceEvent): string {
		return `${this._tracePrefix}.${event}`;
	}

	protected _recordTrace(
		name: string,
		fields: Record<string, unknown> | undefined,
		span: SpanTrait,
		level: "info" | "error" = "info",
	): void {
		this._environment.tracing.record({
			name,
			at: this._environment.time.now(),
			target: this._traceTarget,
			span,
			level,
			fields,
		});
	}

	protected _recordFailureTrace(
		name: string,
		error: unknown,
		fields: Record<string, unknown> | undefined,
		span: SpanTrait,
	): void {
		this._recordTrace(
			name,
			{
				...fields,
				...describeError(error),
			},
			span,
			"error",
		);
	}
}
