import {
	type CancellationTokenSourceTrait,
	ClientError,
	ClientErrorKind,
	UriReferenceString,
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
	commandResponseData,
	concatCommand,
	dispatchCommandLocallyToStream,
	signalToObservable,
} from "@securitydept/client/rx";
import { from, lastValueFrom, takeUntil } from "rxjs";
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
	private readonly _destroyed = createReplaySignal<void>();
	private readonly _sessionInfoSignal =
		createReplaySignal<SessionInfo | null>();
	private readonly _lastSessionErrorSignal = createSignal<unknown | undefined>(
		undefined,
	);
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
		createEventReplaySubject<SessionContextEvent>(100);
	private readonly _refreshCommandSubject =
		createEventSubject<SessionRefreshCommand>();
	private readonly _refreshResponseSubject =
		createEventSubject<
			CommandResponse<SessionRefreshCommand, SessionInfo | null>
		>();
	private readonly _logoutCommandSubject =
		createEventSubject<SessionLogoutCommand>();
	private readonly _logoutResponseSubject =
		createEventSubject<CommandResponse<SessionLogoutCommand, void>>();
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
	readonly sessionInfo: ReadableReplaySignalTrait<SessionInfo | null>;
	readonly sessionDetermined: ReadableReplaySignalTrait<true>;
	readonly isAuthenticated: ReadableReplaySignalTrait<boolean>;
	readonly lastSessionError: ReadableSignalTrait<unknown | undefined>;
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
		this.sessionInfo = readonlyReplaySignal(this._sessionInfoSignal);
		this.sessionDetermined = createAndThenComputedReplaySignal(
			this._sessionInfoSignal,
			() => ({ kind: "value", value: true }),
		);
		this.isAuthenticated = createAndThenComputedReplaySignal(
			this._sessionInfoSignal,
			(sessionInfo) => ({ kind: "value", value: sessionInfo !== null }),
		);
		this.lastSessionError = readonlySignal(this._lastSessionErrorSignal);
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
				concatCommand((command) => this._executeRefresh(command.operationSpan)),
				takeUntil(signalToObservable<void>(this._destroyed)),
			)
			.subscribe(this._refreshResponseSubject);

		from(this._logoutCommandSubject)
			.pipe(
				concatCommand((command) => this._executeLogout(command.operationSpan)),
				takeUntil(signalToObservable<void>(this._destroyed)),
			)
			.subscribe(this._logoutResponseSubject);

		if (config.autoStart === true) {
			this.start().catch(() => {
				// Startup failures are reflected through lastSessionError.
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
				intent: "auth_redirect",
				mode: "external",
			});
			this._throwIfNotOperational();
		} finally {
			this._operationSignals.loginRedirectPending.set(false);
		}
	}

	dispose(): void {
		if (this._destroyed.hasValue()) {
			return;
		}
		this._destroyed.setValue();
		this._rootCancellation.cancel(
			new ClientError({
				kind: ClientErrorKind.Cancelled,
				code: "session.client_disposed",
				message: "SessionContextClient has been disposed.",
				source: SessionContextSource.SessionContext,
			}),
		);
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
		this._emitSessionEvent({
			type: SessionContextEventType.SessionRefreshStarted,
			session: null,
		});
		try {
			const sessionInfo = await this._fetchSessionInfo();
			this._throwIfNotOperational();
			this._sessionInfoSignal.setValue(sessionInfo);
			this._lastSessionErrorSignal.set(undefined);
			operationSpan?.setAttributes({
				authenticated: sessionInfo !== null,
			});
			this._emitSessionEvent({
				type: SessionContextEventType.SessionRefreshSucceeded,
				session: sessionInfo,
			});
			return sessionInfo;
		} catch (error) {
			this._lastSessionErrorSignal.set(error);
			this._sessionInfoSignal.setValue(null);
			this._emitSessionEvent({
				type: SessionContextEventType.SessionRefreshFailed,
				session: null,
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
			this._sessionInfoSignal.setValue(null);
			this._lastSessionErrorSignal.set(undefined);
			operationSpan?.setAttributes({ authenticated: false });
			this._emitSessionEvent({
				type: SessionContextEventType.SessionLogoutSucceeded,
				session: null,
			});
		} catch (error) {
			this._lastSessionErrorSignal.set(error);
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
		const slot = this._sessionInfoSignal.get();
		return slot.kind === "value" ? slot.value : null;
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
