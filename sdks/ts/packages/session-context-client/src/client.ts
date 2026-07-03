import {
	type CancellationTokenSourceTrait,
	type CancellationTokenTrait,
	ClientError,
	ClientErrorKind,
	createCancellationTokenSource,
	createLinkedCancellationToken,
	createOnceAsyncLockCallable,
	createSignal,
	type DisposableTrait,
	defineInstrumentMethodDecorator,
	ENVIRONMENT_TOKEN,
	type EventStreamTrait,
	type FoundationEnvironment,
	injectDisposableStackFrom,
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
	SecuritydeptDestroyRef,
	type SecuritydeptInjectorTrait,
	SpanSharedAttributeName,
	type SpanTrait,
	SYMBOL_DISPOSE,
	UriReferenceString,
	type WritableSignalTrait,
	withDisposableStack,
} from "@securitydept/client";
import {
	type Command,
	type CommandResponse,
	commandResponseData,
	concatCommand,
	dispatchCommandLocallyToStream,
	RxEventSubject,
	RxStateSignal,
} from "@securitydept/client/rx";
import { filter, from, lastValueFrom, take, takeUntil } from "rxjs";
import { v7 as uuidv7 } from "uuid";
import { parseSessionInfoPayload } from "./contracts/parsers";
import {
	clientErrorFromSessionError,
	SessionContextErrorCode,
	SessionContextSource,
} from "./error";
import { SESSION_CONTEXT_CLIENT_CONFIG } from "./tokens";
import {
	type ResolvedSessionContextClientConfig,
	type SessionContextClientConfig,
	type SessionContextEvent,
	type SessionContextEventInput,
	SessionContextEventType,
	type SessionContextOperationOptions,
	type SessionInfo,
	type SessionLoginWithRedirectOptions,
} from "./types";

interface SessionContextOperationSignals {
	readonly startPending: ReadableSignalTrait<boolean>;
	readonly refreshPending: ReadableSignalTrait<boolean>;
	readonly logoutPending: ReadableSignalTrait<boolean>;
	readonly loginRedirectPending: ReadableSignalTrait<boolean>;
}

interface SessionCommandExtra {
	cancellationToken: CancellationTokenTrait;
	operationSpan?: OperationSpanTrait;
}

type SessionRefreshCommand = Command<void, SessionCommandExtra>;
type SessionLogoutCommand = Command<void, SessionCommandExtra>;

const POST_AUTH_REDIRECT_PARAM = "post_auth_redirect_uri";

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
				traceAttributes: { operation },
				clientErrorFromUnknown: (error, options) =>
					clientErrorFromSessionError(error, options),
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
		take(1),
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
	private readonly _eventSubject = new RxEventSubject<SessionContextEvent>();
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
		async (
			cancellationToken: CancellationTokenTrait,
			operationSpan?: OperationSpanTrait,
		) => {
			cancellationToken.throwIfCancellationRequested();
			this._operationSignals.startPending.set(true);
			try {
				return await this._dispatchRefresh(cancellationToken, operationSpan);
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

	static fromEnvironmentConfig(options: {
		readonly config: SessionContextClientConfig;
		readonly environment: FoundationEnvironment;
	}): SessionContextClient {
		return new SessionContextClient(options.config, options.environment);
	}

	static fromInjector(
		injector: SecuritydeptInjectorTrait,
	): SessionContextClient {
		const client = SessionContextClient.fromEnvironmentConfig({
			config: injector.get(SESSION_CONTEXT_CLIENT_CONFIG),
			environment: injector.get(ENVIRONMENT_TOKEN),
		});
		injector
			.get(SecuritydeptDestroyRef, null)
			?.onDestroy(() => client.dispose());
		return client;
	}

	protected constructor(
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
				[SpanSharedAttributeName.ClientName]: this.constructor.name,
				[SpanSharedAttributeName.ClientId]: this.id,
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
		this.destroyed$.subscribe(() => {
			this._rootCancellation.cancel(
				new ClientError({
					kind: ClientErrorKind.Cancelled,
					code: SessionContextErrorCode.ClientDisposed,
					message: "SessionContextClient has been disposed.",
					source: SessionContextSource.SessionContext,
				}),
			);
			this.isAuthenticated.dispose();
			this.sessionResource.dispose();
		});

		from(this._refreshCommandSubject)
			.pipe(
				takeUntil(this.destroyed$),
				concatCommand((command) =>
					this._executeRefresh(
						command.cancellationToken,
						command.operationSpan,
					),
				),
			)
			.subscribe(this._refreshResponseSubject);

		from(this._logoutCommandSubject)
			.pipe(
				takeUntil(this.destroyed$),
				concatCommand((command) =>
					this._executeLogout(command.cancellationToken, command.operationSpan),
				),
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
		const cancellationToken = this._rootCancellation.token;
		return await this._startOnce(cancellationToken, operationSpan);
	}

	@withDisposableStack(0, true)
	async refresh(
		options: SessionContextOperationOptions = {},
	): Promise<SessionInfo | null> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._refresh(cancellationToken);
	}

	@instrumentSessionMethod("refresh")
	private async _refresh(
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<SessionInfo | null> {
		cancellationToken.throwIfCancellationRequested();
		return await this._dispatchRefresh(cancellationToken, operationSpan);
	}

	@withDisposableStack(0, true)
	async logout(options: SessionContextOperationOptions = {}): Promise<void> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		await this._logout(cancellationToken);
	}

	@instrumentSessionMethod("logout")
	private async _logout(
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<void> {
		cancellationToken.throwIfCancellationRequested();
		await this._dispatchLogout(cancellationToken, operationSpan);
	}

	@withDisposableStack(0, true)
	async loginWithRedirect(
		options: SessionLoginWithRedirectOptions = {},
	): Promise<void> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		await this._loginWithRedirect(options, cancellationToken);
	}

	@instrumentSessionMethod("login.redirect")
	private async _loginWithRedirect(
		options: SessionLoginWithRedirectOptions,
		cancellationToken: CancellationTokenTrait,
		_operationSpan?: OperationSpanTrait,
	): Promise<void> {
		cancellationToken.throwIfCancellationRequested();
		const router = this._environment.router;
		if (!router) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: SessionContextErrorCode.RouterUnavailable,
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
			cancellationToken.throwIfCancellationRequested();
		} finally {
			this._operationSignals.loginRedirectPending.set(false);
		}
	}

	dispose(): void {
		this._destroyed.set(true);
		this._eventSubject.complete();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	private async _dispatchRefresh(
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<SessionInfo | null> {
		cancellationToken.throwIfCancellationRequested();
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
				createCommandExtra: () => ({ cancellationToken, operationSpan }),
			}).pipe(commandResponseData()),
		);
		cancellationToken.throwIfCancellationRequested();
		return sessionInfo;
	}

	private async _dispatchLogout(
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<void> {
		cancellationToken.throwIfCancellationRequested();
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
				createCommandExtra: () => ({ cancellationToken, operationSpan }),
			}).pipe(commandResponseData()),
		);
		cancellationToken.throwIfCancellationRequested();
	}

	private async _executeRefresh(
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<SessionInfo | null> {
		cancellationToken.throwIfCancellationRequested();
		this._operationSignals.refreshPending.set(true);
		const previous = this._sessionSnapshotSignal.get();
		const previousValue =
			previous.status === ResourceStatus.Reloading ||
			previous.status === ResourceStatus.Resolved ||
			previous.status === ResourceStatus.Error
				? previous.value
				: null;
		const loadingSnapshot = reduceResourceSnapshot(previous, {
			kind: ResourceSnapshotUpdateKind.Load,
		});
		this._sessionSnapshotSignal.set(loadingSnapshot);
		this._emitSessionEvent({
			type: SessionContextEventType.SessionRefreshStarted,
			session: previousValue,
		});
		try {
			const sessionInfo = await this._fetchSessionInfo(cancellationToken);
			cancellationToken.throwIfCancellationRequested();
			this._sessionSnapshotSignal.set(
				reduceResourceSnapshot(loadingSnapshot, {
					kind: ResourceSnapshotUpdateKind.Resolve,
					value: sessionInfo,
				}),
			);
			operationSpan?.setTraceAttributes({
				authenticated: sessionInfo !== null,
			});
			this._emitSessionEvent({
				type: SessionContextEventType.SessionRefreshSucceeded,
				session: sessionInfo,
			});
			return sessionInfo;
		} catch (error) {
			const clientError = clientErrorFromSessionError(error, {
				span: operationSpan?.span,
			});
			this._sessionSnapshotSignal.set(
				reduceResourceSnapshot(loadingSnapshot, {
					kind: ResourceSnapshotUpdateKind.Fail,
					error: clientError,
				}),
			);
			this._emitSessionEvent({
				type: SessionContextEventType.SessionRefreshFailed,
				session: previousValue,
				error: clientError,
			});
			throw clientError;
		} finally {
			this._operationSignals.refreshPending.set(false);
		}
	}

	private async _executeLogout(
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<void> {
		cancellationToken.throwIfCancellationRequested();
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
				cancellationToken,
			});

			if (response.status < 200 || response.status >= 300) {
				throw ClientError.fromHttpResponse({
					status: response.status,
					body: response.body,
				});
			}

			cancellationToken.throwIfCancellationRequested();
			this._sessionSnapshotSignal.set(
				reduceResourceSnapshot(loadingSnapshot, {
					kind: ResourceSnapshotUpdateKind.Resolve,
					value: null,
				}),
			);
			operationSpan?.setTraceAttributes({ authenticated: false });
			this._emitSessionEvent({
				type: SessionContextEventType.SessionLogoutSucceeded,
				session: null,
			});
		} catch (error) {
			const clientError = clientErrorFromSessionError(error, {
				span: operationSpan?.span,
			});
			this._sessionSnapshotSignal.set(
				reduceResourceSnapshot(loadingSnapshot, {
					kind: ResourceSnapshotUpdateKind.Fail,
					error: clientError,
				}),
			);
			this._emitSessionEvent({
				type: SessionContextEventType.SessionLogoutFailed,
				session: this._readCurrentSession(),
				error: clientError,
			});
			throw clientError;
		} finally {
			this._operationSignals.logoutPending.set(false);
		}
	}

	private async _fetchSessionInfo(
		cancellationToken: CancellationTokenTrait,
	): Promise<SessionInfo | null> {
		cancellationToken.throwIfCancellationRequested();
		const response = await this._environment.transport.execute({
			url: this._config.baseUrl + this._config.userInfoPath,
			method: "GET",
			headers: {},
			cancellationToken,
		});
		cancellationToken.throwIfCancellationRequested();

		if (response.status === 401 || response.status === 403) {
			return null;
		}

		if (response.status >= 200 && response.status < 300) {
			return parseSessionInfoPayload(response.body);
		}

		throw ClientError.fromHttpResponse({
			status: response.status,
			body: response.body,
		});
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
		const snapshot = this._sessionSnapshotSignal.get();
		return snapshot.status === ResourceStatus.Reloading ||
			snapshot.status === ResourceStatus.Resolved ||
			snapshot.status === ResourceStatus.Error
			? snapshot.value
			: null;
	}

	private _emitSessionEvent(input: SessionContextEventInput): void {
		this._eventSubject.next({
			...input,
			at: this._environment.time.now(),
			client: {
				id: this.id,
			},
		});
	}
}
