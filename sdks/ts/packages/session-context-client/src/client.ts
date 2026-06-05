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
	RouterNavigationIntent,
	RouterNavigationMode,
	readonlySignal,
	reduceResourceSnapshot,
	resourceFromSnapshots,
	resourceSnapshotValueOr,
	type SpanTrait,
	SYMBOL_DISPOSE,
	UriReferenceString,
	type WritableSignalTrait,
} from "@securitydept/client";
import {
	type Command,
	type CommandResponse,
	commandResponseData,
	concatCommand,
	dispatchCommandLocallyToStream,
	RxEventReplaySubject,
	RxEventSubject,
	RxStateSignal,
} from "@securitydept/client/rx";
import { filter, from, lastValueFrom, takeUntil } from "rxjs";
import { v7 as uuidv7 } from "uuid";
import { parseSessionInfoPayload } from "./contracts/parsers";
import {
	type ResolvedSessionContextClientConfig,
	type SessionContextClientConfig,
	type SessionContextEvent,
	SessionContextEventType,
	SessionContextSource,
	type SessionInfo,
} from "./types";

interface SessionContextOperationSignals {
	readonly startPending: ReadableSignalTrait<boolean>;
	readonly refreshPending: ReadableSignalTrait<boolean>;
	readonly logoutPending: ReadableSignalTrait<boolean>;
	readonly loginRedirectPending: ReadableSignalTrait<boolean>;
}

interface SessionCommandExtra {
	operationSpan?: OperationSpanTrait;
}

type SessionRefreshCommand = Command<void, SessionCommandExtra>;
type SessionLogoutCommand = Command<void, SessionCommandExtra>;

const POST_AUTH_REDIRECT_PARAM = "post_auth_redirect_uri";

export interface SessionLoginWithRedirectOptions {
	postAuthRedirectUri?: string;
}

const instrumentSessionMethod = defineInstrumentMethodDecorator<
	[operation: string],
	SessionContextClient
>(
	({ factoryArgs: [operation] }) =>
		function (this: SessionContextClient) {
			return {
				environment: this.environment,
				span: this.span,
				name: `${this.config.tracing.prefix}.${operation}`,
				target: this.config.tracing.target,
				fields: { operation },
			};
		},
);

/**
 * Session Context Client.
 *
 * Owns session state, lifecycle, login/logout navigation, and tracing.
 * Host capabilities are resolved once through FoundationEnvironment at
 * construction time.
 */
export class SessionContextClient implements DisposableTrait {
	static defaultOptions = {
		loginPath: "/auth/session/login",
		logoutPath: "/auth/session/logout",
		userInfoPath: "/auth/session/user-info",
		tracing: {
			target: "session-context-client",
			prefix: "session_context",
		},
	} as const;

	private readonly _environment: FoundationEnvironment;
	private readonly _config: ResolvedSessionContextClientConfig;
	private readonly _span: SpanTrait;
	private readonly _rootCancellation: CancellationTokenSourceTrait =
		createCancellationTokenSource();
	private readonly _destroyed = RxStateSignal.fromInitialValue(false);
	private readonly destroyed$ = from(this._destroyed).pipe(
		filter((value): value is true => value),
	);
	private readonly _sessionSnapshotSignal = RxStateSignal.fromInitialValue<
		ResourceSnapshot<SessionInfo | null>
	>({ status: ResourceStatus.Idle });
	private readonly _operationSignals: {
		readonly startPending: WritableSignalTrait<boolean>;
		readonly refreshPending: WritableSignalTrait<boolean>;
		readonly logoutPending: WritableSignalTrait<boolean>;
		readonly loginRedirectPending: WritableSignalTrait<boolean>;
	} = {
		startPending: createSignal(false),
		refreshPending: createSignal(false),
		logoutPending: createSignal(false),
		loginRedirectPending: createSignal(false),
	};
	private readonly _eventSubject =
		new RxEventReplaySubject<SessionContextEvent>(100);
	private readonly _refreshCommandSubject =
		new RxEventSubject<SessionRefreshCommand>();
	private readonly _refreshResponseSubject = new RxEventSubject<
		CommandResponse<SessionRefreshCommand, SessionInfo | null>
	>();
	private readonly _logoutCommandSubject =
		new RxEventSubject<SessionLogoutCommand>();
	private readonly _logoutResponseSubject = new RxEventSubject<
		CommandResponse<SessionLogoutCommand, void>
	>();
	private readonly _startOnce = createOnceAsyncLockCallable(
		async (operationSpan?: OperationSpanTrait) => {
			this._throwIfNotOperational();
			this._operationSignals.startPending.set(true);
			try {
				return await this._dispatchRefresh(operationSpan);
			} finally {
				this._operationSignals.startPending.set(false);
			}
		},
	);

	readonly id: string;
	readonly sessionSnapshot: ReadableSignalTrait<
		ResourceSnapshot<SessionInfo | null>
	>;
	readonly sessionResource: ResourceTrait<SessionInfo | null>;
	readonly isAuthenticated: ResourceTrait<boolean>;
	readonly sessionOperations: SessionContextOperationSignals;
	readonly events: EventStreamTrait<SessionContextEvent>;

	protected get environment(): FoundationEnvironment {
		return this._environment;
	}

	protected get span(): SpanTrait {
		return this._span;
	}

	protected get config(): ResolvedSessionContextClientConfig {
		return this._config;
	}

	constructor(
		config: SessionContextClientConfig,
		environment: FoundationEnvironment,
	) {
		this._environment = environment;
		const baseUrl = config.baseUrl.replace(/\/+$/, "");
		this._config = {
			id: config.id ?? uuidv7(),
			baseUrl,
			loginPath:
				config.loginPath ?? SessionContextClient.defaultOptions.loginPath,
			logoutPath:
				config.logoutPath ?? SessionContextClient.defaultOptions.logoutPath,
			userInfoPath:
				config.userInfoPath ?? SessionContextClient.defaultOptions.userInfoPath,
			tracing: {
				target:
					config.tracing?.target ??
					SessionContextClient.defaultOptions.tracing.target,
				prefix:
					config.tracing?.prefix ??
					SessionContextClient.defaultOptions.tracing.prefix,
			},
		};
		this.id = this._config.id;
		this._span = environment.span.fork({
			attributes: {
				clientName: this.constructor.name,
				id: this.id,
			},
		});
		this.sessionSnapshot = readonlySignal(this._sessionSnapshotSignal);
		this.sessionResource = resourceFromSnapshots(() =>
			this._sessionSnapshotSignal.get(),
		);
		this.isAuthenticated = mapResource(
			this.sessionResource,
			(sessionInfo) => sessionInfo !== null,
		);
		this.sessionOperations = {
			startPending: readonlySignal(this._operationSignals.startPending),
			refreshPending: readonlySignal(this._operationSignals.refreshPending),
			logoutPending: readonlySignal(this._operationSignals.logoutPending),
			loginRedirectPending: readonlySignal(
				this._operationSignals.loginRedirectPending,
			),
		};
		this.events = this._eventSubject;

		from(this._refreshCommandSubject)
			.pipe(
				takeUntil(this.destroyed$),
				concatCommand((command) => this._executeRefresh(command.operationSpan)),
			)
			.subscribe(this._refreshResponseSubject);

		from(this._logoutCommandSubject)
			.pipe(
				takeUntil(this.destroyed$),
				concatCommand((command) => this._executeLogout(command.operationSpan)),
			)
			.subscribe(this._logoutResponseSubject);

		if (config.autoStart === true) {
			this.start().catch(() => {
				// Startup failure is reflected by sessionSnapshot.
			});
		}
	}

	@instrumentSessionMethod("start")
	async start(operationSpan?: OperationSpanTrait): Promise<SessionInfo | null> {
		return await this._startOnce(operationSpan);
	}

	@instrumentSessionMethod("refresh")
	async refresh(
		operationSpan?: OperationSpanTrait,
	): Promise<SessionInfo | null> {
		this._throwIfNotOperational();
		return await this._dispatchRefresh(operationSpan);
	}

	@instrumentSessionMethod("logout")
	async logout(operationSpan?: OperationSpanTrait): Promise<void> {
		this._throwIfNotOperational();
		await this._dispatchLogout(operationSpan);
	}

	async loginWithRedirect(
		options: SessionLoginWithRedirectOptions = {},
	): Promise<void> {
		await this._loginWithRedirect(options);
	}

	@instrumentSessionMethod("login.redirect")
	private async _loginWithRedirect(
		options: SessionLoginWithRedirectOptions,
		_operationSpan?: OperationSpanTrait,
	): Promise<void> {
		this._throwIfNotOperational();
		const router = this._environment.router;
		if (!router) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: "session.router_unavailable",
				message: "loginWithRedirect() requires environment.router.",
				source: SessionContextSource.SessionContext,
			});
		}
		this._operationSignals.loginRedirectPending.set(true);
		try {
			await router.navigate({
				url: UriReferenceString.parse(
					this._createLoginRedirectUrl(options.postAuthRedirectUri),
				),
				intent: RouterNavigationIntent.AuthRedirect,
				mode: RouterNavigationMode.External,
			});
			this._throwIfNotOperational();
		} finally {
			this._operationSignals.loginRedirectPending.set(false);
		}
	}

	dispose(): void {
		if (this._destroyed.get()) {
			return;
		}
		this._destroyed.set(true);
		this._rootCancellation.cancel(
			new ClientError({
				kind: ClientErrorKind.Cancelled,
				code: "session.client_disposed",
				message: "SessionContextClient has been disposed.",
				source: SessionContextSource.SessionContext,
			}),
		);
		this.isAuthenticated.dispose();
		this.sessionResource.dispose();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	private async _dispatchRefresh(
		operationSpan?: OperationSpanTrait,
	): Promise<SessionInfo | null> {
		this._throwIfNotOperational();
		const sessionInfo = await lastValueFrom(
			dispatchCommandLocallyToStream<
				void,
				SessionCommandExtra,
				SessionInfo | null,
				SessionRefreshCommand
			>({
				payload: undefined,
				requestStream: this._refreshCommandSubject,
				responseStream: this._refreshResponseSubject,
				createCommandExtra: () => ({ operationSpan }),
			}).pipe(commandResponseData()),
		);
		this._throwIfNotOperational();
		return sessionInfo;
	}

	private async _dispatchLogout(
		operationSpan?: OperationSpanTrait,
	): Promise<void> {
		this._throwIfNotOperational();
		await lastValueFrom(
			dispatchCommandLocallyToStream<
				void,
				SessionCommandExtra,
				void,
				SessionLogoutCommand
			>({
				payload: undefined,
				requestStream: this._logoutCommandSubject,
				responseStream: this._logoutResponseSubject,
				createCommandExtra: () => ({ operationSpan }),
			}).pipe(commandResponseData()),
		);
		this._throwIfNotOperational();
	}

	private async _executeRefresh(
		operationSpan?: OperationSpanTrait,
	): Promise<SessionInfo | null> {
		this._throwIfNotOperational();
		this._operationSignals.refreshPending.set(true);
		const previous = this._sessionSnapshotSignal.get();
		const previousValue = resourceSnapshotValueOr(previous, null);
		const loadingSnapshot = reduceResourceSnapshot(previous, {
			kind: ResourceSnapshotUpdateKind.Load,
		});
		this._sessionSnapshotSignal.set(loadingSnapshot);
		this._emitSessionEvent({
			type: SessionContextEventType.SessionRefreshStarted,
			session: previousValue,
		});
		try {
			const sessionInfo = await this._fetchSessionInfo();
			this._throwIfNotOperational();
			this._sessionSnapshotSignal.set(
				reduceResourceSnapshot(loadingSnapshot, {
					kind: ResourceSnapshotUpdateKind.Resolve,
					value: sessionInfo,
				}),
			);
			operationSpan?.setAttributes({
				authenticated: sessionInfo !== null,
			});
			this._emitSessionEvent({
				type: SessionContextEventType.SessionRefreshSucceeded,
				session: sessionInfo,
			});
			return sessionInfo;
		} catch (error) {
			this._sessionSnapshotSignal.set(
				reduceResourceSnapshot(loadingSnapshot, {
					kind: ResourceSnapshotUpdateKind.Fail,
					error,
				}),
			);
			this._emitSessionEvent({
				type: SessionContextEventType.SessionRefreshFailed,
				session: previousValue,
				errorSummary: describeError(error),
			});
			throw error;
		} finally {
			this._operationSignals.refreshPending.set(false);
		}
	}

	private async _executeLogout(
		operationSpan?: OperationSpanTrait,
	): Promise<void> {
		this._throwIfNotOperational();
		this._operationSignals.logoutPending.set(true);
		const previous = this._sessionSnapshotSignal.get();
		const loadingSnapshot = reduceResourceSnapshot(previous, {
			kind: ResourceSnapshotUpdateKind.Load,
		});
		this._sessionSnapshotSignal.set(loadingSnapshot);
		this._emitSessionEvent({
			type: SessionContextEventType.SessionLogoutStarted,
			session: this._readCurrentSession(),
		});
		try {
			const response = await this._environment.transport.execute({
				url: this._createLogoutUrl(),
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
				cancellationToken: this._rootCancellation.token,
			});

			if (response.status < 200 || response.status >= 300) {
				throw ClientError.fromHttpResponse(response.status, response.body);
			}

			this._throwIfNotOperational();
			this._sessionSnapshotSignal.set(
				reduceResourceSnapshot(loadingSnapshot, {
					kind: ResourceSnapshotUpdateKind.Resolve,
					value: null,
				}),
			);
			operationSpan?.setAttributes({ authenticated: false });
			this._emitSessionEvent({
				type: SessionContextEventType.SessionLogoutSucceeded,
				session: null,
			});
		} catch (error) {
			this._sessionSnapshotSignal.set(
				reduceResourceSnapshot(loadingSnapshot, {
					kind: ResourceSnapshotUpdateKind.Fail,
					error,
				}),
			);
			this._emitSessionEvent({
				type: SessionContextEventType.SessionLogoutFailed,
				session: this._readCurrentSession(),
				errorSummary: describeError(error),
			});
			throw error;
		} finally {
			this._operationSignals.logoutPending.set(false);
		}
	}

	private async _fetchSessionInfo(): Promise<SessionInfo | null> {
		this._throwIfNotOperational();
		const response = await this._environment.transport.execute({
			url: this._config.baseUrl + this._config.userInfoPath,
			method: "GET",
			headers: {},
			cancellationToken: this._rootCancellation.token,
		});
		this._throwIfNotOperational();

		if (response.status === 401 || response.status === 403) {
			return null;
		}

		if (response.status >= 200 && response.status < 300) {
			return parseSessionInfoPayload(response.body);
		}

		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	private _createLoginRedirectUrl(postAuthRedirectUri?: string): string {
		const base = this._config.baseUrl + this._config.loginPath;
		if (postAuthRedirectUri) {
			const params = new URLSearchParams({
				[POST_AUTH_REDIRECT_PARAM]: postAuthRedirectUri,
			});
			return `${base}?${params.toString()}`;
		}
		return base;
	}

	private _createLogoutUrl(): string {
		return this._config.baseUrl + this._config.logoutPath;
	}

	private _readCurrentSession(): SessionInfo | null {
		return resourceSnapshotValueOr(this._sessionSnapshotSignal.get(), null);
	}

	private _emitSessionEvent(
		input: Omit<SessionContextEvent, "at" | "client">,
	): void {
		this._eventSubject.next({
			...input,
			at: this._environment.time.now(),
			client: {
				id: this.id,
			},
		});
	}

	private _throwIfNotOperational(): void {
		this._rootCancellation.token.throwIfCancellationRequested();
	}
}
