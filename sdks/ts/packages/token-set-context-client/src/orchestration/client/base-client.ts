// Base OIDC Mode Client — shared lifecycle infrastructure
//
// Shared lifecycle host for backend/frontend OIDC mode clients:
//   - Auth snapshot authority + resources
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
	createCancellationTokenSource,
	createOnceAsyncLockCallable,
	createSignal,
	type DisposableTrait,
	defineInstrumentMethodDecorator,
	describeError,
	type EventStreamTrait,
	type FoundationEnvironment,
	mapResource,
	type OperationSpanTrait,
	type ReadableSignalTrait,
	type ResourceSnapshot,
	ResourceSnapshotUpdateKind,
	ResourceStatus,
	type ResourceTrait,
	readonlySignal,
	reduceResourceSnapshot,
	resourceFromSnapshots,
	resourceSnapshotValueOr,
	type SpanTrait,
	SYMBOL_DISPOSE,
	type WritableSignalTrait,
} from "@securitydept/client";
import {
	type Command,
	type CommandResponse,
	concatCommand,
	dispatchCommandLocallyToPromise,
	RxEventReplaySubject,
	RxEventSubject,
	RxStateSignal,
} from "@securitydept/client/rx";
import { filter, from, merge, take, takeUntil } from "rxjs";
import { v7 as uuidv7 } from "uuid";
import {
	createTokenSetAuthEvent,
	summarizeAuthError,
	type TokenSetAuthEvent,
	type TokenSetAuthEventPayloadInput,
	TokenSetAuthEventType,
} from "../events/auth-events";
import {
	type TokenSetTokenFreshnessOptions,
	TokenSetTokenFreshnessState,
	type TokenSetTokenFreshnessTiming,
} from "../token/freshness";
import { tokenSetBearerHeader } from "../token/ops";
import { type TokenSetAuthSnapshot } from "../token/types";
import { TokenSetAuthorizationRevocationError } from "./error";
import {
	clearPersistedAuthSnapshot,
	savePersistedAuthSnapshot,
	type TokenSetAuthSnapshotPersistenceOptions,
} from "./persistence";
import {
	type BaseOidcModeClientDefaultOptions,
	type BaseOidcModeClientOptions,
	type BaseOidcModeClientTracingOptions,
	type TokenSetAuthOperationSignals,
	type TokenSetOidcPopupLoginOptions,
	type TokenSetOidcPopupLoginResult,
	type TokenSetOidcRedirectLoginOptions,
} from "./types";
import {
	PersistPolicy,
	type TokenSetAuthDeterminationCommit,
	type TokenSetAuthDeterminationEvent,
	TokenSetAuthDeterminationKind,
} from "./workflows/commit";

export { PersistPolicy } from "./workflows/commit";

import { TokenSetOrchestrationTraceEvent } from "./tracing";
import {
	planClear,
	type TokenSetPlanClearRequest,
} from "./workflows/plan/clear";
import {
	planRefresh,
	type TokenSetFetchRefreshedSnapshot,
	type TokenSetPlanRefreshRequest,
	type TokenSetPlanRefreshResponse,
} from "./workflows/plan/refresh";
import {
	planRestore,
	planRestorePersisted,
	type TokenSetPlanRestorePersistedRequest,
	type TokenSetPlanRestoreRequest,
} from "./workflows/plan/restore";
import { TokenSetPageResumeWorkflowSource } from "./workflows/source/page-resume";
import { TokenSetRefreshTimerWorkflowSource } from "./workflows/source/refresh-timer";

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
	protected readonly _freshnessOptions: TokenSetTokenFreshnessOptions;
	protected readonly _tracingOptions: BaseOidcModeClientTracingOptions;
	protected readonly _persistence: TokenSetAuthSnapshotPersistenceOptions | null;
	protected readonly _span: SpanTrait;
	protected readonly _authSnapshotSignal = RxStateSignal.fromInitialValue<
		ResourceSnapshot<TokenSetAuthSnapshot | null>
	>({ status: ResourceStatus.Idle });
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

	private readonly _destroyed = RxStateSignal.fromInitialValue(false);
	protected readonly destroyed$ = from(this._destroyed).pipe(
		filter((value): value is true => value),
		take(1),
	);
	public start = createOnceAsyncLockCallable(async () => {
		this._throwIfNotOperational();
		this._authSnapshotSignal.set(
			reduceResourceSnapshot(this._authSnapshotSignal.get(), {
				kind: ResourceSnapshotUpdateKind.Load,
			}),
		);
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
		new RxEventReplaySubject<TokenSetAuthEvent>(100);
	private readonly refreshWorkflowSubject = new RxEventSubject<void>();
	private readonly planRefreshRequest = new RxEventSubject<
		Command<TokenSetPlanRefreshRequest>
	>();
	private readonly planRefreshResponse = new RxEventSubject<
		CommandResponse<
			Command<TokenSetPlanRefreshRequest>,
			TokenSetPlanRefreshResponse
		>
	>();

	readonly authSnapshot: ReadableSignalTrait<
		ResourceSnapshot<TokenSetAuthSnapshot | null>
	>;
	readonly authResource: ResourceTrait<TokenSetAuthSnapshot | null>;
	readonly isAuthenticated: ResourceTrait<boolean>;
	readonly authorizationHeaderValue: ResourceTrait<string | undefined>;
	readonly authOperations: TokenSetAuthOperationSignals = {
		restorePending: readonlySignal(this._authOperationSignals.restorePending),
		refreshPending: readonlySignal(this._authOperationSignals.refreshPending),
		clearPending: readonlySignal(this._authOperationSignals.clearPending),
		loginPending: readonlySignal(this._authOperationSignals.loginPending),
	};
	readonly authEvents: EventStreamTrait<TokenSetAuthEvent> =
		this._authEventSubject;
	readonly refreshTimerWorkflowSource: TokenSetRefreshTimerWorkflowSource;
	readonly pageResumeWorkflowSource: TokenSetPageResumeWorkflowSource;
	readonly id: string;

	protected get environment(): FoundationEnvironment {
		return this._environment;
	}

	protected get span(): SpanTrait {
		return this._span;
	}

	abstract loginWithRedirect(
		options?: TokenSetOidcRedirectLoginOptions,
	): Promise<void>;
	abstract loginWithPopup(
		options: TokenSetOidcPopupLoginOptions,
	): Promise<TokenSetOidcPopupLoginResult>;

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

		this.authSnapshot = readonlySignal(this._authSnapshotSignal);
		this.authResource = resourceFromSnapshots(() =>
			this._authSnapshotSignal.get(),
		);
		this.authorizationHeaderValue = mapResource(
			this.authResource,
			(snapshot) => tokenSetBearerHeader(snapshot?.tokens) ?? undefined,
		);
		this.isAuthenticated = mapResource(
			this.authorizationHeaderValue,
			(headerValue) => headerValue !== undefined,
		);

		this.refreshTimerWorkflowSource =
			TokenSetRefreshTimerWorkflowSource.fromBuiltin(
				{
					time: options.environment.time,
					freshnessOptions: this._freshnessOptions,
					authSnapshot: this.authSnapshot,
					recordTrace: (type, attributes) => {
						this._recordTrace(
							`${this._tracingOptions.prefix}.${TokenSetRefreshTimerWorkflowSource.name}.${type}`,
							attributes,
							this._span,
						);
					},
				},
				options.refresh?.sources?.[TokenSetRefreshTimerWorkflowSource.name],
			);

		this.pageResumeWorkflowSource =
			TokenSetPageResumeWorkflowSource.fromBuiltin(
				{
					pageLifecycle: options.environment.pageLifecycle,
					time: options.environment.time,
					recordTrace: (type, attributes) => {
						this._recordTrace(
							`${this._tracingOptions.prefix}.${TokenSetPageResumeWorkflowSource.name}.${type}`,
							attributes,
							this._span,
						);
					},
				},
				options.refresh?.sources?.[TokenSetPageResumeWorkflowSource.name],
			);
		this.destroyed$.subscribe(() => {
			this._onDispose();
			this._rootCancellation.cancel(
				new ClientError({
					kind: ClientErrorKind.Cancelled,
					code: `${this._tracingOptions.prefix}.client_disposed`,
					message: `${this.constructor.name} was disposed`,
					source: this._tracingOptions.target,
				}),
			);
			this.isAuthenticated.dispose();
			this.authorizationHeaderValue.dispose();
			this.authResource.dispose();
			this._recordTrace(
				this._traceType(TokenSetOrchestrationTraceEvent.Disposed),
				undefined,
				this._span,
			);
		});

		merge(
			from(this.pageResumeWorkflowSource.eventStream),
			from(this.refreshTimerWorkflowSource.eventStream),
		)
			.pipe(takeUntil(this.destroyed$))
			.subscribe(() => {
				this.refreshWorkflowSubject.next();
			});

		from(this.refreshWorkflowSubject)
			.pipe(takeUntil(this.destroyed$))
			.subscribe(() => {
				const snapshot = this._readAuthSnapshotValue();
				if (snapshot) {
					this._refreshState({
						snapshot,
						freshnessOptions: this._freshnessOptions,
					}).catch(() => {
						// Refresh failure is reflected by authSnapshot.
					});
				}
			});

		from(this.planRefreshRequest)
			.pipe(
				takeUntil(this.destroyed$),
				concatCommand((request) => planRefresh(request.payload)),
			)
			.subscribe(this.planRefreshResponse);

		if (options.autoStart === true) {
			this.start().catch(() => {
				// Startup failure is reflected by authSnapshot.
			});
		}
	}

	async restoreState(
		snapshot: TokenSetAuthSnapshot,
		options: { persistPolicy?: PersistPolicy } = {},
	): Promise<TokenSetAuthSnapshot> {
		this._throwIfNotOperational();
		return this._restoreState(
			{
				snapshot,
			},
			options,
		);
	}

	async restorePersistedState(): Promise<TokenSetAuthSnapshot | null> {
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

	async refreshState(): Promise<TokenSetAuthSnapshot | null> {
		this._throwIfNotOperational();
		const current = this._authSnapshotSignal.get();
		const determinatedSnapshot =
			current.status === ResourceStatus.Error
				? current.value
				: await this.authResource.whenValue({
						cancellationToken: this._rootCancellation.token,
					});
		this._throwIfNotOperational();
		return this._refreshState({
			snapshot: determinatedSnapshot,
			freshnessOptions: this._freshnessOptions,
		});
	}

	protected async _applySnapshot(
		snapshot: TokenSetAuthSnapshot,
		options: { persistPolicy?: PersistPolicy } = {},
		span?: SpanTrait,
	): Promise<TokenSetAuthSnapshot> {
		this._throwIfNotOperational();
		return await this._commitDetermination(
			{
				candidate: {
					kind: TokenSetAuthDeterminationKind.Authenticated,
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
	): TokenSetFetchRefreshedSnapshot {
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
			snapshot: TokenSetAuthSnapshot | null;
			freshnessOptions: TokenSetTokenFreshnessOptions;
		},
		operationSpan?: OperationSpanTrait,
	): Promise<TokenSetAuthSnapshot | null> {
		this._throwIfNotOperational();
		try {
			this._authOperationSignals.refreshPending.set(true);
			const currentSnapshot = request.snapshot;
			this._authSnapshotSignal.set(
				reduceResourceSnapshot(this._authSnapshotSignal.get(), {
					kind: ResourceSnapshotUpdateKind.Load,
				}),
			);
			if (!currentSnapshot) {
				this._authSnapshotSignal.set(
					reduceResourceSnapshot(this._authSnapshotSignal.get(), {
						kind: ResourceSnapshotUpdateKind.Resolve,
						value: null,
					}),
				);
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
			if (refreshPlan.kind === TokenSetAuthDeterminationKind.Failed) {
				const revoked =
					refreshPlan.error instanceof TokenSetAuthorizationRevocationError;
				await this._commitDetermination(
					{
						candidate: refreshPlan,
						failureValue: revoked ? null : currentSnapshot,
						persistPolicy: revoked
							? PersistPolicy.FollowClient
							: PersistPolicy.Skip,
						events: [
							...this._buildRefreshLifecycleEvents(
								currentSnapshot,
								refreshPlan,
							),
							...(revoked
								? [
										{
											type: TokenSetAuthEventType.AuthUnauthenticated,
											payload: {},
										} as const,
									]
								: []),
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
				throw refreshPlan.error;
			}
			return this._commitDetermination(
				{
					candidate: refreshPlan,
					persistPolicy: PersistPolicy.FollowClient,
					events: [
						...this._buildRefreshLifecycleEvents(currentSnapshot, refreshPlan),
						refreshPlan.kind === TokenSetAuthDeterminationKind.Authenticated
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
		request: TokenSetPlanClearRequest,
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
		request: TokenSetPlanRestoreRequest,
		options: { persistPolicy?: PersistPolicy } | undefined,
		operationSpan?: OperationSpanTrait,
	): Promise<TokenSetAuthSnapshot> {
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
		request: TokenSetPlanRestorePersistedRequest,
		operationSpan?: OperationSpanTrait,
	): Promise<TokenSetAuthSnapshot | null> {
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
			if (restorePlan.kind === TokenSetAuthDeterminationKind.Failed) {
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
			if (restorePlan.kind === TokenSetAuthDeterminationKind.Unauthenticated) {
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
			if (refreshPlan.kind === TokenSetAuthDeterminationKind.Failed) {
				const revoked =
					refreshPlan.error instanceof TokenSetAuthorizationRevocationError;
				await this._commitDetermination(
					{
						candidate: refreshPlan,
						failureValue: revoked ? null : restorePlan.snapshot,
						persistPolicy: revoked
							? PersistPolicy.FollowClient
							: PersistPolicy.Skip,
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
							...(revoked
								? [
										{
											type: TokenSetAuthEventType.AuthUnauthenticated,
											payload: {},
										} as const,
									]
								: []),
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
				throw refreshPlan.error;
			}
			if (refreshPlan.kind === TokenSetAuthDeterminationKind.Authenticated) {
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
		request: Omit<
			TokenSetPlanRefreshRequest,
			"fetchRefreshedSnapshot" | "time"
		>,
		operationSpan?: SpanTrait,
	): Promise<TokenSetPlanRefreshResponse> {
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
		this._destroyed.set(true);
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	protected abstract _refreshAuthSnapshot(
		authSnapshot: TokenSetAuthSnapshot,
		freshnessTiming: TokenSetTokenFreshnessTiming,
		operationSpan?: SpanTrait,
	): Promise<TokenSetAuthSnapshot | null>;

	protected _onDispose(): void {
		// Default no-op. Subclasses override as needed.
	}

	protected _throwIfNotOperational(): void {
		this._rootCancellation.token.throwIfCancellationRequested();
	}

	protected _readAuthSnapshotValue(): TokenSetAuthSnapshot | null {
		return resourceSnapshotValueOr(this._authSnapshotSignal.get(), null);
	}

	private async _commitDetermination<TResult>(
		commit: TokenSetAuthDeterminationCommit<TResult>,
		span?: SpanTrait,
	): Promise<TResult> {
		this._throwIfNotOperational();
		const previous = this._authSnapshotSignal.get();
		this._authSnapshotSignal.set(
			commit.candidate.kind === TokenSetAuthDeterminationKind.Failed
				? reduceResourceSnapshot(
						previous,
						commit.failureValue === undefined
							? {
									kind: ResourceSnapshotUpdateKind.Fail,
									error: commit.candidate.error,
								}
							: {
									kind: ResourceSnapshotUpdateKind.FailWithValue,
									value: commit.failureValue,
									error: commit.candidate.error,
								},
					)
				: reduceResourceSnapshot(previous, {
						kind: ResourceSnapshotUpdateKind.Resolve,
						value: commit.candidate.snapshot ?? null,
					}),
		);
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
		commit: TokenSetAuthDeterminationCommit<TResult>,
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
			this._authSnapshotSignal.set(
				reduceResourceSnapshot(this._authSnapshotSignal.get(), {
					kind: ResourceSnapshotUpdateKind.Fail,
					error,
				}),
			);
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
		snapshotBeforeRefresh: TokenSetAuthSnapshot,
		refreshPlan: TokenSetPlanRefreshResponse,
	): TokenSetAuthDeterminationEvent[] {
		const events: TokenSetAuthDeterminationEvent[] = [];
		if (
			snapshotBeforeRefresh.tokens.refreshMaterial != null &&
			refreshPlan.freshness.state !== TokenSetTokenFreshnessState.Fresh &&
			refreshPlan.freshness.state !== TokenSetTokenFreshnessState.NoExpiry
		) {
			if (refreshPlan.kind === TokenSetAuthDeterminationKind.Authenticated) {
				events.push({
					type: TokenSetAuthEventType.AuthRefreshSucceeded,
					payload: {
						freshness: refreshPlan.freshness,
						hasRefreshMaterial: true,
					},
				});
			}
			if (refreshPlan.kind === TokenSetAuthDeterminationKind.Failed) {
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
