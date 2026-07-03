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
	type CancellationTokenOptions,
	type CancellationTokenSourceTrait,
	type CancellationTokenTrait,
	ClientError,
	ClientErrorKind,
	createCancellationTokenSource,
	createLinkedCancellationToken,
	createOnceAsyncLockCallable,
	createSignal,
	type DisposableTrait,
	describeError,
	type EventStreamTrait,
	type FoundationEnvironment,
	injectDisposableStackFrom,
	mapResource,
	OperationSpan,
	type OperationSpanTrait,
	type ReadableSignalTrait,
	type ResourceSnapshot,
	ResourceSnapshotUpdateKind,
	ResourceStatus,
	type ResourceTrait,
	readonlySignal,
	reduceResourceSnapshot,
	resourceFromSnapshots,
	type SpanAttributes,
	SpanSharedAttributeName,
	type SpanTrait,
	SYMBOL_DISPOSE,
	type WritableSignalTrait,
	withDisposableStack,
} from "@securitydept/client";
import {
	type Command,
	type CommandResponse,
	concatCommand,
	dispatchCommandLocallyToPromise,
	RxEventSubject,
	RxStateSignal,
} from "@securitydept/client/rx";
import { filter, from, merge, take, takeUntil } from "rxjs";
import { v7 as uuidv7 } from "uuid";
import {
	createTokenSetAuthEvent,
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
import {
	clientErrorFromTokenSetAuthorizationError,
	TokenSetAuthorizationRevocationError,
} from "./error";
import {
	clearPersistedAuthSnapshot,
	savePersistedAuthSnapshot,
	type TokenSetAuthSnapshotPersistenceOptions,
	TokenSetPersistenceErrorCode,
} from "./persistence";
import {
	type BaseOidcModeClientDefaultOptions,
	type BaseOidcModeClientOptions,
	type BaseOidcModeClientTracingOptions,
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
	type TokenSetAuthOperationSignals,
	type TokenSetAuthStateOperationOptions,
	type TokenSetOidcPopupLoginOptions,
	type TokenSetOidcPopupLoginResult,
	type TokenSetOidcRedirectLoginOptions,
} from "./types";
import {
	PersistPolicy,
	type TokenSetAuthDeterminationCommit,
	type TokenSetAuthDeterminationEvent,
	TokenSetAuthDeterminationKind,
	TokenSetAuthDeterminationOutcomeKind,
	type TokenSetAuthDeterminationTerminal,
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
		const cancellationToken = this._rootCancellation.token;
		this._authSnapshotSignal.set(
			reduceResourceSnapshot(this._authSnapshotSignal.get(), {
				kind: ResourceSnapshotUpdateKind.Load,
			}),
		);
		// start only selects the restoration workflow. Each workflow owns
		// cancellation and must determine auth state before it rejects; catching
		// here would re-apply failures already committed by that workflow.
		const callbackResult =
			await this._restoreStateFromCallbackInput(cancellationToken);
		if (callbackResult.kind === OidcModeCallbackHandlingKind.Handled) {
			return callbackResult.result;
		}
		if (this._persistence) {
			return await this._restorePersistedState(
				{
					persistence: this._persistence,
					time: this._environment.time,
					freshnessOptions: this._freshnessOptions,
				},
				cancellationToken,
			);
		}
		return await this._clearState(
			{
				snapshot: null,
			},
			undefined,
			cancellationToken,
		);
	});
	private _authEventSequence = 0;
	private readonly _authEventSubject = new RxEventSubject<TokenSetAuthEvent>();
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
				[SpanSharedAttributeName.ClientName]: this.constructor.name,
				[SpanSharedAttributeName.ClientId]: this.id,
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
				const cancellationToken = this._rootCancellation.token;
				const snapshot = this._readAuthSnapshotValue();
				if (snapshot) {
					this._refreshState(
						{
							snapshot,
							freshnessOptions: this._freshnessOptions,
						},
						cancellationToken,
					).catch(() => {
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
			queueMicrotask(() => {
				this.start().catch(() => {
					// Startup failure is reflected by authSnapshot.
				});
			});
		}
	}

	@withDisposableStack(1, true)
	async restoreState(
		snapshot: TokenSetAuthSnapshot,
		options: TokenSetAuthStateOperationOptions = {},
	): Promise<TokenSetAuthSnapshot> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		cancellationToken.throwIfCancellationRequested();
		return await this._restoreState(
			{
				snapshot,
			},
			options,
			cancellationToken,
		);
	}

	@withDisposableStack(0, true)
	async restorePersistedState(
		options: CancellationTokenOptions = {},
	): Promise<TokenSetAuthSnapshot | null> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		cancellationToken.throwIfCancellationRequested();
		if (this._persistence === null) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				message:
					"restorePersistedState() requires configured persistence for this client.",
				code: TokenSetPersistenceErrorCode.Unavailable,
				source: this._tracingOptions.target,
			});
		}
		return await this._restorePersistedState(
			{
				persistence: this._persistence,
				time: this._environment.time,
				freshnessOptions: this._freshnessOptions,
			},
			cancellationToken,
		);
	}

	@withDisposableStack(0, true)
	async clearState(
		options: TokenSetAuthStateOperationOptions = {},
	): Promise<void> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		cancellationToken.throwIfCancellationRequested();
		await this._clearState({}, options, cancellationToken);
	}

	@withDisposableStack(0, true)
	async logout(options: TokenSetAuthStateOperationOptions = {}): Promise<void> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		cancellationToken.throwIfCancellationRequested();
		await this._clearState({}, options, cancellationToken);
	}

	@withDisposableStack(0, true)
	async refreshState(
		options: CancellationTokenOptions = {},
	): Promise<TokenSetAuthSnapshot | null> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		cancellationToken.throwIfCancellationRequested();
		const current = this._authSnapshotSignal.get();
		const determinatedSnapshot =
			current.status === ResourceStatus.Error
				? current.value
				: await this.authResource.whenValue({
						cancellationToken,
					});
		cancellationToken.throwIfCancellationRequested();
		return await this._refreshState(
			{
				snapshot: determinatedSnapshot,
				freshnessOptions: this._freshnessOptions,
			},
			cancellationToken,
		);
	}

	protected async _runDeterminationWorkflow<TResult>(options: {
		name: string;
		traceAttributes?: SpanAttributes;
		pendingSignal?: WritableSignalTrait<boolean>;
		clientErrorFromUnknown?: (
			error: unknown,
			options: { span: SpanTrait },
		) => ClientError;
		workflow: (
			operationSpan: OperationSpan,
		) => Promise<TokenSetAuthDeterminationTerminal<TResult>>;
	}): Promise<TResult> {
		const operationSpan = OperationSpan.start({
			environment: this._environment,
			span: this._span,
			name: options.name,
			target: this._tracingOptions.target,
			traceAttributes: options.traceAttributes,
		});
		let commitStarted = false;
		options.pendingSignal?.set(true);
		try {
			const terminal = await options.workflow(operationSpan);
			// Committing is the point of no return. Cancellation and other fallible
			// planning must finish before this boundary so determination is published
			// exactly once.
			commitStarted = true;
			await this._commitDetermination(terminal.commit, operationSpan.span);
			if (
				terminal.outcome.kind === TokenSetAuthDeterminationOutcomeKind.Throw
			) {
				throw terminal.outcome.error;
			}
			operationSpan.recordEnded("succeeded");
			return terminal.outcome.value;
		} catch (sourceError) {
			const error = options.clientErrorFromUnknown
				? options.clientErrorFromUnknown(sourceError, {
						span: operationSpan.span,
					})
				: clientErrorFromTokenSetAuthorizationError(sourceError, {
						span: operationSpan.span,
					});
			if (!commitStarted) {
				commitStarted = true;
				await this._commitDetermination(
					{
						candidate: {
							kind: TokenSetAuthDeterminationKind.Failed,
							error,
						},
						persistPolicy: PersistPolicy.Skip,
					},
					operationSpan.span,
				);
			}
			operationSpan.recordError(error);
			operationSpan.recordEnded("failed");
			throw error;
		} finally {
			options.pendingSignal?.set(false);
		}
	}

	private _createRefreshFetcher(
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): TokenSetFetchRefreshedSnapshot {
		return async (snapshot, freshnessTiming) => {
			const hasRefreshMaterial = snapshot.tokens.refreshMaterial != null;
			this._emitAuthEvent({
				type: TokenSetAuthEventType.AuthRefreshRequired,
				freshness: freshnessTiming,
				hasRefreshMaterial,
			});
			this._emitAuthEvent({
				type: TokenSetAuthEventType.AuthRefreshStarted,
				freshness: freshnessTiming,
				hasRefreshMaterial,
			});
			cancellationToken.throwIfCancellationRequested();
			let refreshed: TokenSetAuthSnapshot | null;
			try {
				refreshed = await this._refreshAuthSnapshot(
					snapshot,
					freshnessTiming,
					cancellationToken,
					operationSpan,
				);
			} catch (error) {
				throw clientErrorFromTokenSetAuthorizationError(error, {
					span: operationSpan?.span,
				});
			}
			cancellationToken.throwIfCancellationRequested();
			return refreshed;
		};
	}

	protected async _refreshState(
		request: {
			snapshot: TokenSetAuthSnapshot | null;
			freshnessOptions: TokenSetTokenFreshnessOptions;
		},
		cancellationToken: CancellationTokenTrait,
	): Promise<TokenSetAuthSnapshot | null> {
		return await this._runDeterminationWorkflow({
			name: `${this._tracingOptions.prefix}.refresh`,
			traceAttributes: { workflow: "refresh" },
			pendingSignal: this._authOperationSignals.refreshPending,
			workflow: async (operationSpan) => {
				cancellationToken.throwIfCancellationRequested();
				const currentSnapshot = request.snapshot;
				this._authSnapshotSignal.set(
					reduceResourceSnapshot(this._authSnapshotSignal.get(), {
						kind: ResourceSnapshotUpdateKind.Load,
					}),
				);
				if (!currentSnapshot) {
					return {
						commit: {
							candidate: {
								kind: TokenSetAuthDeterminationKind.Unauthenticated,
							},
							persistPolicy: PersistPolicy.Skip,
						},
						outcome: {
							kind: TokenSetAuthDeterminationOutcomeKind.Return,
							value: null,
						},
					};
				}
				const refreshPlan = await this._planRefreshInQueue(
					{
						snapshot: currentSnapshot,
						freshnessOptions: request.freshnessOptions,
					},
					cancellationToken,
					operationSpan,
				);
				cancellationToken.throwIfCancellationRequested();
				if (refreshPlan.kind === TokenSetAuthDeterminationKind.Failed) {
					const error = clientErrorFromTokenSetAuthorizationError(
						refreshPlan.error,
						{ span: operationSpan.span },
					);
					const revoked = error instanceof TokenSetAuthorizationRevocationError;
					return {
						commit: {
							candidate: { ...refreshPlan, error },
							failureValue: revoked ? null : currentSnapshot,
							persistPolicy: revoked
								? PersistPolicy.FollowClient
								: PersistPolicy.Skip,
							events: [
								...this._buildRefreshLifecycleEvents(
									currentSnapshot,
									refreshPlan,
									operationSpan.span,
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
							trace: {
								type: this._traceType(
									TokenSetOrchestrationTraceEvent.RefreshFailed,
								),
							},
							traceError: error,
						},
						outcome: {
							kind: TokenSetAuthDeterminationOutcomeKind.Throw,
							error,
						},
					};
				}
				return {
					commit: {
						candidate: refreshPlan,
						persistPolicy: PersistPolicy.FollowClient,
						events: [
							...this._buildRefreshLifecycleEvents(
								currentSnapshot,
								refreshPlan,
								operationSpan.span,
							),
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
						trace: {
							type: this._traceType(
								TokenSetOrchestrationTraceEvent.RefreshCommitted,
							),
						},
					},
					outcome: {
						kind: TokenSetAuthDeterminationOutcomeKind.Return,
						value: refreshPlan.snapshot ?? null,
					},
				};
			},
		});
	}

	protected async _clearState(
		request: TokenSetPlanClearRequest,
		options: { persistPolicy?: PersistPolicy } | undefined,
		cancellationToken: CancellationTokenTrait,
	): Promise<null> {
		return await this._runDeterminationWorkflow({
			name: `${this._tracingOptions.prefix}.clear`,
			traceAttributes: { workflow: "clear" },
			pendingSignal: this._authOperationSignals.clearPending,
			workflow: async () => {
				cancellationToken.throwIfCancellationRequested();
				const clearPlan = await planClear(request);
				cancellationToken.throwIfCancellationRequested();
				return {
					commit: {
						candidate: clearPlan,
						persistPolicy: options?.persistPolicy ?? PersistPolicy.FollowClient,
						events: [
							{
								type: TokenSetAuthEventType.AuthMaterialCleared,
								payload: {},
							},
						],
						trace: {
							type: this._traceType(
								TokenSetOrchestrationTraceEvent.StateCleared,
							),
						},
					},
					outcome: {
						kind: TokenSetAuthDeterminationOutcomeKind.Return,
						value: null,
					},
				};
			},
		});
	}

	protected async _restoreState(
		request: TokenSetPlanRestoreRequest,
		options: { persistPolicy?: PersistPolicy } | undefined,
		cancellationToken: CancellationTokenTrait,
	): Promise<TokenSetAuthSnapshot> {
		return await this._runDeterminationWorkflow({
			name: `${this._tracingOptions.prefix}.restore`,
			traceAttributes: { workflow: "restore" },
			pendingSignal: this._authOperationSignals.restorePending,
			workflow: async () => {
				cancellationToken.throwIfCancellationRequested();
				const restorePlan = await planRestore(request);
				cancellationToken.throwIfCancellationRequested();
				return {
					commit: {
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
						trace: {
							type: this._traceType(
								TokenSetOrchestrationTraceEvent.StateRestored,
							),
						},
					},
					outcome: {
						kind: TokenSetAuthDeterminationOutcomeKind.Return,
						value: restorePlan.snapshot,
					},
				};
			},
		});
	}

	protected async _restorePersistedState(
		request: TokenSetPlanRestorePersistedRequest,
		cancellationToken: CancellationTokenTrait,
	): Promise<TokenSetAuthSnapshot | null> {
		return await this._runDeterminationWorkflow({
			name: `${this._tracingOptions.prefix}.restore.persisted`,
			traceAttributes: { workflow: "restore.persisted" },
			pendingSignal: this._authOperationSignals.restorePending,
			workflow: async (operationSpan) => {
				cancellationToken.throwIfCancellationRequested();
				this._emitAuthEvent({
					type: TokenSetAuthEventType.AuthMaterialRestoreStarted,
					persisted: true,
				});
				this._recordTrace(
					this._traceType(
						TokenSetOrchestrationTraceEvent.PersistedRestoreStarted,
					),
					undefined,
					operationSpan.span,
				);
				const restorePlan = await planRestorePersisted(request);
				cancellationToken.throwIfCancellationRequested();
				if (restorePlan.kind === TokenSetAuthDeterminationKind.Failed) {
					const error = clientErrorFromTokenSetAuthorizationError(
						restorePlan.error,
						{ span: operationSpan.span },
					);
					return {
						commit: {
							candidate: { ...restorePlan, error },
							persistPolicy: PersistPolicy.FollowClient,
							events: [
								{
									type: TokenSetAuthEventType.AuthMaterialRestoreFailed,
									payload: {
										persisted: true,
										error,
									},
								},
							],
							trace: {
								type: this._traceType(
									TokenSetOrchestrationTraceEvent.PersistedRestoreFailed,
								),
							},
							traceError: error,
						},
						outcome: {
							kind: TokenSetAuthDeterminationOutcomeKind.Return,
							value: null,
						},
					};
				}
				if (
					restorePlan.kind === TokenSetAuthDeterminationKind.Unauthenticated
				) {
					return {
						commit: {
							candidate: restorePlan,
							persistPolicy: PersistPolicy.FollowClient,
							events: [
								{
									type: TokenSetAuthEventType.AuthUnauthenticated,
									payload: {},
								},
							],
							trace: {
								type: this._traceType(
									TokenSetOrchestrationTraceEvent.PersistedRestoreLoaded,
								),
							},
						},
						outcome: {
							kind: TokenSetAuthDeterminationOutcomeKind.Return,
							value: null,
						},
					};
				}
				// A persisted snapshot was loaded; reconcile its freshness before
				// committing the restored determination.
				const refreshPlan = await this._planRefreshInQueue(
					{
						snapshot: restorePlan.snapshot,
						freshnessOptions: request.freshnessOptions,
					},
					cancellationToken,
					operationSpan,
				);
				cancellationToken.throwIfCancellationRequested();
				if (refreshPlan.kind === TokenSetAuthDeterminationKind.Failed) {
					const error = clientErrorFromTokenSetAuthorizationError(
						refreshPlan.error,
						{ span: operationSpan.span },
					);
					const revoked = error instanceof TokenSetAuthorizationRevocationError;
					return {
						commit: {
							candidate: { ...refreshPlan, error },
							failureValue: revoked ? null : restorePlan.snapshot,
							persistPolicy: revoked
								? PersistPolicy.FollowClient
								: PersistPolicy.Skip,
							events: [
								...this._buildRefreshLifecycleEvents(
									restorePlan.snapshot,
									refreshPlan,
									operationSpan.span,
								),
								{
									type: TokenSetAuthEventType.AuthMaterialRestoreFailed,
									payload: {
										persisted: true,
										error,
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
							trace: {
								type: this._traceType(
									TokenSetOrchestrationTraceEvent.PersistedRestoreFailed,
								),
							},
							traceError: error,
						},
						outcome: {
							kind: TokenSetAuthDeterminationOutcomeKind.Throw,
							error: refreshPlan.error,
						},
					};
				}
				if (refreshPlan.kind === TokenSetAuthDeterminationKind.Authenticated) {
					return {
						commit: {
							candidate: refreshPlan,
							persistPolicy: PersistPolicy.FollowClient,
							events: [
								...this._buildRefreshLifecycleEvents(
									restorePlan.snapshot,
									refreshPlan,
									operationSpan.span,
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
							trace: {
								type: this._traceType(
									TokenSetOrchestrationTraceEvent.PersistedRestoreLoaded,
								),
							},
						},
						outcome: {
							kind: TokenSetAuthDeterminationOutcomeKind.Return,
							value: refreshPlan.snapshot,
						},
					};
				}
				// Persisted snapshot loaded but the refresh determination found it is
				// no longer usable.
				return {
					commit: {
						candidate: refreshPlan,
						persistPolicy: PersistPolicy.FollowClient,
						events: [
							...this._buildRefreshLifecycleEvents(
								restorePlan.snapshot,
								refreshPlan,
								operationSpan.span,
							),
							{
								type: TokenSetAuthEventType.AuthUnauthenticated,
								payload: {},
							},
						],
						trace: {
							type: this._traceType(
								TokenSetOrchestrationTraceEvent.PersistedRestoreLoaded,
							),
						},
					},
					outcome: {
						kind: TokenSetAuthDeterminationOutcomeKind.Return,
						value: null,
					},
				};
			},
		});
	}

	private async _planRefreshInQueue(
		request: Omit<
			TokenSetPlanRefreshRequest,
			"fetchRefreshedSnapshot" | "time"
		>,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<TokenSetPlanRefreshResponse> {
		cancellationToken.throwIfCancellationRequested();
		const refreshedPlan = await dispatchCommandLocallyToPromise({
			requestStream: this.planRefreshRequest,
			responseStream: this.planRefreshResponse,
			payload: {
				snapshot: request.snapshot,
				freshnessOptions: request.freshnessOptions,
				time: this._environment.time,
				fetchRefreshedSnapshot: this._createRefreshFetcher(
					cancellationToken,
					operationSpan,
				),
			},
		});
		cancellationToken.throwIfCancellationRequested();
		return refreshedPlan.data;
	}

	dispose(): void {
		this._destroyed.set(true);
		this._authEventSubject.complete();
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
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	protected abstract _refreshAuthSnapshot(
		authSnapshot: TokenSetAuthSnapshot,
		freshnessTiming: TokenSetTokenFreshnessTiming,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<TokenSetAuthSnapshot | null>;

	private async _restoreStateFromCallbackInput(
		cancellationToken: CancellationTokenTrait,
	): Promise<OidcModeCallbackHandlingResult<TokenSetAuthSnapshot | null>> {
		const snapshotBeforeRestore = this._authSnapshotSignal.get();
		try {
			return await this._restoreStateFromCallbackInputOperation(
				cancellationToken,
			);
		} catch (error) {
			if (this._authSnapshotSignal.get() !== snapshotBeforeRestore) {
				throw error;
			}

			// A claimed callback is already a determination workflow. Only resolver
			// failures reach this branch before that workflow starts.
			return await this._runDeterminationWorkflow<never>({
				name: `${this._tracingOptions.prefix}.callback`,
				traceAttributes: { flow: "callback.restore" },
				workflow: async () => {
					throw error;
				},
			});
		}
	}

	protected async _restoreStateFromCallbackInputOperation(
		_cancellationToken: CancellationTokenTrait,
	): Promise<OidcModeCallbackHandlingResult<TokenSetAuthSnapshot | null>> {
		return { kind: OidcModeCallbackHandlingKind.NotApplicable };
	}

	protected _onDispose(): void {
		// Default no-op. Subclasses override as needed.
	}

	protected _readAuthSnapshotValue(): TokenSetAuthSnapshot | null {
		const snapshot = this._authSnapshotSignal.get();
		return snapshot.status === ResourceStatus.Reloading ||
			snapshot.status === ResourceStatus.Resolved ||
			snapshot.status === ResourceStatus.Error
			? snapshot.value
			: null;
	}

	private async _commitDetermination(
		commit: TokenSetAuthDeterminationCommit,
		span?: SpanTrait,
	): Promise<void> {
		const previous = this._authSnapshotSignal.get();
		const nextSnapshot =
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
					});
		this._authSnapshotSignal.set(nextSnapshot);
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
		await this._syncPersistence(commit, span);
	}

	private async _syncPersistence(
		commit: TokenSetAuthDeterminationCommit,
		span?: SpanTrait,
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
			this._recordFailureTrace(
				this._traceType(TokenSetOrchestrationTraceEvent.PersistenceSyncFailed),
				error,
				undefined,
				span ?? this._span,
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
		span: SpanTrait,
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
				const error = clientErrorFromTokenSetAuthorizationError(
					refreshPlan.error,
					{ span },
				);
				events.push({
					type: TokenSetAuthEventType.AuthRefreshFailed,
					payload: {
						freshness: refreshPlan.freshness,
						hasRefreshMaterial: true,
						error,
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
		fields: SpanAttributes | undefined,
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
		fields: SpanAttributes | undefined,
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
