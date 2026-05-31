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
	type TokenSetAuthEventPayloadInput,
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
	type BaseOidcModeClientDefaultOptions,
	type BaseOidcModeClientOptions,
	type BaseOidcModeClientTracingOptions,
	type OidcPopupLoginOptions,
	type OidcPopupLoginResult,
	type OidcRedirectLoginOptions,
	type TokenSetAuthOperationSignals,
} from "./types";
import {
	type AuthDeterminationCommit,
	type AuthDeterminationEvent,
	AuthDeterminationKind,
	PersistPolicy,
} from "./workflows/commit";

export { PersistPolicy } from "./workflows/commit";

import { TokenSetOrchestrationTraceEvent } from "./tracing";
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

const instrumentWorkflowMethod = defineInstrumentMethodDecorator<
	[workflow: string],
	BaseOidcModeClient
>(
	({ factoryArgs: [workflow] }) =>
		function (this: BaseOidcModeClient) {
			return {
				environment: this.environment,
				span: this.span,
				name: `${this._tracingOptions.prefix}.${workflow}`,
				fields: { workflow },
				target: this._tracingOptions.target,
			};
		},
);

export abstract class BaseOidcModeClient implements DisposableTrait {
	static defaultOptions = {
		tokenFreshness: {
			clockSkewMs: 60_000,
			refreshWindowMs: 60_000,
		},
	} as const satisfies BaseOidcModeClientDefaultOptions;

	protected readonly _environment: FoundationEnvironment;
	protected readonly _freshnessOptions: TokenFreshnessOptions;
	protected readonly _tracingOptions: BaseOidcModeClientTracingOptions;
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

	private readonly _destroyed = createReplaySignal<void>();
	public start = createOnceAsyncLockCallable(async () => {
		this._throwIfNotOperational();
		if (this._persistence) {
			return await this._restorePersistedState({
				persistence: this._persistence,
				time: this._environment.time,
				freshnessOptions: this._freshnessOptions,
			});
		} else {
			return await this._clearState(
				{
					snapshot: null,
				},
				undefined,
			);
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

	abstract loginWithRedirect(options?: OidcRedirectLoginOptions): Promise<void>;
	abstract loginWithPopup(
		options: OidcPopupLoginOptions,
	): Promise<OidcPopupLoginResult>;

	protected constructor(options: BaseOidcModeClientOptions) {
		this._environment = options.environment;
		this._tracingOptions = options.tracing;
		this.id = options.id ?? uuidv7();
		this._span = options.environment.span.fork({
			attributes: {
				clientName: this.constructor.name,
				id: this.id,
			},
		});
		this._freshnessOptions = Object.assign(
			{},
			BaseOidcModeClient.defaultOptions.tokenFreshness,
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
						`${this._tracingOptions.prefix}.${RefreshTimerWorkflowSource.name}.${type}`,
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
						`${this._tracingOptions.prefix}.${PageResumeWorkflowSource.name}.${type}`,
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
			.pipe(takeUntil(signalToObservable<void>(this._destroyed)))
			.subscribe(() => {
				this.refreshWorkflowSubject.next();
			});

		from(this.refreshWorkflowSubject)
			.pipe(
				withLatestFrom(signalToObservable(this.authSnapshot)),
				takeUntil(signalToObservable<void>(this._destroyed)),
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

	async restoreState(
		snapshot: AuthSnapshot,
		options: { persistPolicy?: PersistPolicy } = {},
	): Promise<AuthSnapshot> {
		this._throwIfNotOperational();
		return this._restoreState(
			{
				snapshot,
			},
			options,
		);
	}

	async restorePersistedState(): Promise<AuthSnapshot | null> {
		this._throwIfNotOperational();
		if (this._persistence === null) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				message:
					"restorePersistedState() requires configured persistence for this client.",
				code: "auth_restore.persistence_unavailable",
				source: this._tracingOptions.target,
			});
		}
		return await this._restorePersistedState({
			persistence: this._persistence,
			time: this._environment.time,
			freshnessOptions: this._freshnessOptions,
		});
	}

	async clearState(
		options: { persistPolicy?: PersistPolicy } = {},
	): Promise<void> {
		this._throwIfNotOperational();
		await this.logout(options);
	}

	async logout(options: { persistPolicy?: PersistPolicy } = {}): Promise<void> {
		this._throwIfNotOperational();
		await this._clearState({}, options);
	}

	async refreshState(): Promise<AuthSnapshot | null> {
		this._throwIfNotOperational();
		const determinatedSnapshot = await this.authSnapshot.whenValue({
			cancellationToken: this._rootCancellation.token,
		});
		this._throwIfNotOperational();
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
						payload: {},
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
			this._emitAuthEvent({
				type: TokenSetAuthEventType.AuthRefreshRequired,
				freshness: freshnessTiming,
				hasRefreshMaterial,
			});
			try {
				this._authOperationSignals.refreshPending.set(true);
				this._emitAuthEvent({
					type: TokenSetAuthEventType.AuthRefreshStarted,
					freshness: freshnessTiming,
					hasRefreshMaterial,
				});
				this._throwIfNotOperational();
				const refreshed = await this._refreshAuthSnapshot(
					snapshot,
					freshnessTiming,
					operationSpan,
				);
				this._throwIfNotOperational();
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
			const currentSnapshot = await this._authSnapshotSignal.whenValue({
				cancellationToken: this._rootCancellation.token,
			});
			this._throwIfNotOperational();
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
			this._throwIfNotOperational();
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
								payload: {},
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
									payload: {},
								}
							: {
									type: TokenSetAuthEventType.AuthUnauthenticated,
									payload: {},
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
		options: { persistPolicy?: PersistPolicy } | undefined,
		operationSpan?: OperationSpanTrait,
	): Promise<null> {
		this._throwIfNotOperational();
		this._authOperationSignals.clearPending.set(true);
		try {
			const clearPlan = await planClear(request);
			this._throwIfNotOperational();
			return await this._commitDetermination(
				{
					candidate: clearPlan,
					persistPolicy: options?.persistPolicy ?? PersistPolicy.FollowClient,
					events: [
						{
							type: TokenSetAuthEventType.AuthMaterialCleared,
							payload: {},
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
		options: { persistPolicy?: PersistPolicy } | undefined,
		operationSpan?: OperationSpanTrait,
	): Promise<AuthSnapshot> {
		this._throwIfNotOperational();
		this._authOperationSignals.restorePending.set(true);
		try {
			const restorePlan = await planRestore(request);
			this._throwIfNotOperational();
			return await this._commitDetermination(
				{
					candidate: restorePlan,
					persistPolicy: options?.persistPolicy ?? PersistPolicy.Skip,
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
		this._emitAuthEvent({
			type: TokenSetAuthEventType.AuthMaterialRestoreStarted,
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
			this._throwIfNotOperational();
			if (restorePlan.kind === AuthDeterminationKind.Failed) {
				return this._commitDetermination(
					{
						candidate: restorePlan,
						persistPolicy: PersistPolicy.FollowClient,
						events: [
							{
								type: TokenSetAuthEventType.AuthMaterialRestoreFailed,
								payload: {
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
								payload: {},
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
			this._throwIfNotOperational();
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
								payload: { persisted: true },
							},
							{
								type: TokenSetAuthEventType.AuthAuthenticated,
								payload: {},
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
							payload: {},
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
		this._throwIfNotOperational();
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
		this._throwIfNotOperational();
		return refreshedPlan.data;
	}

	dispose(): void {
		if (this._destroyed.hasValue()) {
			return;
		}
		this._destroyed.setValue(undefined);
		this._onDispose();
		this._rootCancellation.cancel(
			new ClientError({
				kind: ClientErrorKind.Cancelled,
				code: `${this._tracingOptions.prefix}.client_disposed`,
				message: `${this.constructor.name} was disposed`,
				source: this._tracingOptions.target,
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
		this._throwIfNotOperational();
		this._authSnapshotSignal.setValue(commit.candidate.snapshot ?? null);
		this._lastAuthErrorSignal.set(commit.candidate.error);
		await this._syncPersistence(commit);
		this._throwIfNotOperational();
		for (const event of commit.events ?? []) {
			this._emitAuthEvent({
				type: event.type,
				...event.payload,
			} as unknown as TokenSetAuthEventPayloadInput);
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
			this._throwIfNotOperational();
			if (commit.candidate.snapshot) {
				await savePersistedAuthSnapshot(
					this._persistence,
					commit.candidate.snapshot,
				);
			} else {
				await clearPersistedAuthSnapshot(this._persistence);
			}
			this._throwIfNotOperational();
		} catch (error) {
			this._rootCancellation.token.throwIfCancellationRequested();
			if (commit.candidate.error === undefined) {
				this._lastAuthErrorSignal.set(error);
			}
		}
	}

	private _emitAuthEvent(payload: TokenSetAuthEventPayloadInput): void {
		this._authEventSubject.next(
			createTokenSetAuthEvent({
				id: `${this._tracingOptions.prefix}.auth.${++this._authEventSequence}`,
				type: payload.type,
				at: this._environment.time.now(),
				payload: {
					client: {
						id: this.id,
					},
					...payload,
				},
			}),
		);
	}

	private _buildRefreshLifecycleEvents(
		snapshotBeforeRefresh: AuthSnapshot,
		refreshPlan: PlanRefreshResponse,
	): AuthDeterminationEvent[] {
		const events: AuthDeterminationEvent[] = [];
		if (
			snapshotBeforeRefresh.tokens.refreshMaterial != null &&
			refreshPlan.freshness.state !== TokenFreshnessState.Fresh &&
			refreshPlan.freshness.state !== TokenFreshnessState.NoExpiry
		) {
			if (refreshPlan.kind === AuthDeterminationKind.Authenticated) {
				events.push({
					type: TokenSetAuthEventType.AuthRefreshSucceeded,
					payload: {
						freshness: refreshPlan.freshness,
						hasRefreshMaterial: true,
					},
				});
			}
			if (refreshPlan.kind === AuthDeterminationKind.Failed) {
				events.push({
					type: TokenSetAuthEventType.AuthRefreshFailed,
					payload: {
						freshness: refreshPlan.freshness,
						hasRefreshMaterial: true,
						errorSummary: summarizeAuthError(refreshPlan.error),
					},
				});
			}
		}
		return events;
	}

	private _traceType(event: TokenSetOrchestrationTraceEvent): string {
		return `${this._tracingOptions.prefix}.${event}`;
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
			target: this._tracingOptions.target,
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
