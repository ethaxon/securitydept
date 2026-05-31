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
	RouterNavigationIntent,
	RouterNavigationMode,
	readonlyReplaySignal,
	readonlySignal,
	type SpanTrait,
	SYMBOL_DISPOSE,
	throwValidationClientError,
	UriReferenceString,
	validateTraitInput,
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
import { BasicAuthContextClientConfigSchema } from "./schemas";
import {
	AuthGuardRedirectStatus,
	type AuthGuardResult,
	AuthGuardResultKind,
	type BasicAuthBoundaryKind,
	BasicAuthBoundaryKind as BasicAuthBoundaryKindValues,
	type BasicAuthBoundaryObservation,
	type BasicAuthBoundarySnapshot,
	type BasicAuthContextClientConfig,
	type BasicAuthContextEvent,
	BasicAuthContextEventType,
	type BasicAuthContextOperationSignals,
	BasicAuthContextSource,
	type BasicAuthLoginWithRedirectOptions,
	type BasicAuthLogoutOptions,
	type BasicAuthRefreshOptions,
	type BasicAuthZoneConfig,
	type ResolvedBasicAuthContextClientConfig,
	type ResolvedBasicAuthZone,
} from "./types";

const DEFAULT_LOGIN_SUBPATH = "/login";
const DEFAULT_LOGOUT_SUBPATH = "/logout";
const POST_AUTH_REDIRECT_PARAM = "post_auth_redirect_uri";

interface BasicAuthCommandExtra {
	operationSpan?: OperationSpanTrait;
}

type BasicAuthRefreshCommand = Command<
	Required<BasicAuthRefreshOptions>,
	BasicAuthCommandExtra
>;
type BasicAuthLogoutCommand = Command<
	ResolvedBasicAuthZone,
	BasicAuthCommandExtra
>;

const instrumentBasicAuthMethod = defineInstrumentMethodDecorator<
	[operation: string],
	BasicAuthContextClient
>(
	({ factoryArgs: [operation] }) =>
		function (this: BasicAuthContextClient) {
			return {
				environment: this.environment,
				span: this.span,
				name: `${this.config.tracing.prefix}.${operation}`,
				target: this.config.tracing.target,
				fields: { operation },
			};
		},
);

function resolveZone(config: BasicAuthZoneConfig): ResolvedBasicAuthZone {
	const prefix = config.zonePrefix.replace(/\/+$/, "");
	const loginSub = config.loginSubpath ?? DEFAULT_LOGIN_SUBPATH;
	const logoutSub = config.logoutSubpath ?? DEFAULT_LOGOUT_SUBPATH;

	return {
		zonePrefix: prefix,
		loginPath: prefix + loginSub,
		logoutPath: prefix + logoutSub,
	};
}

export function readBasicAuthBoundaryKind(
	options: BasicAuthBoundaryObservation,
): BasicAuthBoundaryKind {
	if (options.status < 400) {
		return BasicAuthBoundaryKindValues.Authenticated;
	}

	if (options.challengeHeader) {
		return BasicAuthBoundaryKindValues.Challenge;
	}

	if (options.status === 401 && options.isLogoutPath === true) {
		return BasicAuthBoundaryKindValues.LogoutPoison;
	}

	return BasicAuthBoundaryKindValues.Unauthorized;
}

/**
 * Basic Auth Context Client.
 *
 * Owns zone-aware Basic Auth boundary observations and redirect/logout
 * navigation. It does not manage credentials or principal data.
 */
export class BasicAuthContextClient implements DisposableTrait {
	static defaultOptions = {
		loginSubpath: DEFAULT_LOGIN_SUBPATH,
		logoutSubpath: DEFAULT_LOGOUT_SUBPATH,
		tracing: {
			target: "basic-auth-context-client",
			prefix: "basic_auth_context",
		},
	} as const;

	private readonly _environment: FoundationEnvironment;
	private readonly _config: ResolvedBasicAuthContextClientConfig;
	private readonly _span: SpanTrait;
	private readonly _rootCancellation: CancellationTokenSourceTrait =
		createCancellationTokenSource();
	private readonly _destroyed = createReplaySignal<void>();
	private readonly _boundarySnapshotSignal =
		createReplaySignal<BasicAuthBoundarySnapshot | null>();
	private readonly _lastBoundaryErrorSignal = createSignal<unknown | undefined>(
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
		createEventReplaySubject<BasicAuthContextEvent>(100);
	private readonly _refreshCommandSubject =
		createEventSubject<BasicAuthRefreshCommand>();
	private readonly _refreshResponseSubject =
		createEventSubject<
			CommandResponse<BasicAuthRefreshCommand, BasicAuthBoundarySnapshot>
		>();
	private readonly _logoutCommandSubject =
		createEventSubject<BasicAuthLogoutCommand>();
	private readonly _logoutResponseSubject =
		createEventSubject<
			CommandResponse<BasicAuthLogoutCommand, BasicAuthBoundarySnapshot>
		>();
	private readonly _startOnce = createOnceAsyncLockCallable(
		async (operationSpan?: OperationSpanTrait) => {
			this._throwIfNotOperational();
			this._operationSignals.startPending.set(true);
			try {
				return await this._dispatchRefresh(
					this._resolveRefreshOptions({}),
					operationSpan,
				);
			} finally {
				this._operationSignals.startPending.set(false);
			}
		},
	);

	readonly id: string;
	readonly zones: readonly ResolvedBasicAuthZone[];
	readonly boundarySnapshot: ReadableReplaySignalTrait<BasicAuthBoundarySnapshot | null>;
	readonly boundaryDetermined: ReadableReplaySignalTrait<true>;
	readonly isAuthenticated: ReadableReplaySignalTrait<boolean>;
	readonly lastBoundaryError: ReadableSignalTrait<unknown | undefined>;
	readonly operations: BasicAuthContextOperationSignals;
	readonly events: EventStreamTrait<BasicAuthContextEvent>;

	protected get environment(): FoundationEnvironment {
		return this._environment;
	}

	protected get span(): SpanTrait {
		return this._span;
	}

	protected get config(): ResolvedBasicAuthContextClientConfig {
		return this._config;
	}

	constructor(
		config: BasicAuthContextClientConfig,
		environment: FoundationEnvironment,
	) {
		validateTraitInput({
			value: config,
			bundledSchema: BasicAuthContextClientConfigSchema,
			onInvalid: (failure) =>
				throwValidationClientError({
					code: "basic_auth.invalid_config",
					source: BasicAuthContextSource.BasicAuthContext,
					messagePrefix: "BasicAuthContextClient could not validate config",
					failure,
				}),
		});
		const resolvedConfig: ResolvedBasicAuthContextClientConfig = {
			id: config.id ?? uuidv7(),
			baseUrl: (config.baseUrl ?? "").replace(/\/+$/, ""),
			zones: (config.zones ?? []).map(resolveZone),
			probePath: config.probePath,
			tracing: {
				target:
					config.tracing?.target ??
					BasicAuthContextClient.defaultOptions.tracing.target,
				prefix:
					config.tracing?.prefix ??
					BasicAuthContextClient.defaultOptions.tracing.prefix,
			},
		};

		this._environment = environment;
		this._config = resolvedConfig;
		this.id = resolvedConfig.id;
		this.zones = resolvedConfig.zones;
		this._span = environment.span.fork({
			attributes: {
				clientName: this.constructor.name,
				id: this.id,
			},
		});
		this.boundarySnapshot = readonlyReplaySignal(this._boundarySnapshotSignal);
		this.boundaryDetermined = createAndThenComputedReplaySignal(
			this._boundarySnapshotSignal,
			() => ({ kind: "value", value: true }),
		);
		this.isAuthenticated = createAndThenComputedReplaySignal(
			this._boundarySnapshotSignal,
			(snapshot) => ({
				kind: "value",
				value: snapshot?.authenticated === true,
			}),
		);
		this.lastBoundaryError = readonlySignal(this._lastBoundaryErrorSignal);
		this.operations = {
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
				concatCommand((command) =>
					this._executeRefresh(command.payload, command.operationSpan),
				),
				takeUntil(signalToObservable<void>(this._destroyed)),
			)
			.subscribe(this._refreshResponseSubject);

		from(this._logoutCommandSubject)
			.pipe(
				concatCommand((command) =>
					this._executeLogout(command.payload, command.operationSpan),
				),
				takeUntil(signalToObservable<void>(this._destroyed)),
			)
			.subscribe(this._logoutResponseSubject);

		if (config.autoStart === true) {
			this.start().catch(() => {
				// Startup failures are reflected through lastBoundaryError.
			});
		}
	}

	async start(): Promise<BasicAuthBoundarySnapshot> {
		return await this._start();
	}

	@instrumentBasicAuthMethod("start")
	private async _start(
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		return await this._startOnce(operationSpan);
	}

	async refresh(
		options: BasicAuthRefreshOptions = {},
	): Promise<BasicAuthBoundarySnapshot> {
		return await this._refresh(options);
	}

	@instrumentBasicAuthMethod("refresh")
	private async _refresh(
		options: BasicAuthRefreshOptions,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		this._throwIfNotOperational();
		return await this._dispatchRefresh(
			this._resolveRefreshOptions(options),
			operationSpan,
		);
	}

	async logout(
		options: BasicAuthLogoutOptions,
	): Promise<BasicAuthBoundarySnapshot> {
		return await this._logout(options);
	}

	@instrumentBasicAuthMethod("logout")
	private async _logout(
		options: BasicAuthLogoutOptions,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		this._throwIfNotOperational();
		return await this._dispatchLogout(
			this._resolveZoneForAction(options, "logout"),
			operationSpan,
		);
	}

	async loginWithRedirect(
		options: BasicAuthLoginWithRedirectOptions,
	): Promise<void> {
		await this._loginWithRedirect(options);
	}

	@instrumentBasicAuthMethod("login.redirect")
	private async _loginWithRedirect(
		options: BasicAuthLoginWithRedirectOptions,
		_operationSpan?: OperationSpanTrait,
	): Promise<void> {
		this._throwIfNotOperational();
		const router = this._environment.router;
		if (!router) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: "basic_auth.router_unavailable",
				message: "loginWithRedirect() requires environment.router.",
				source: BasicAuthContextSource.BasicAuthContext,
			});
		}
		const zone = this._resolveZoneForAction(options, "login redirect");
		const postAuthRedirectUri =
			options.postAuthRedirectUri ?? options.currentPath;

		this._operationSignals.loginRedirectPending.set(true);
		this._emitEvent({
			type: BasicAuthContextEventType.LoginRedirectStarted,
			zone,
		});
		try {
			await router.navigate({
				url: UriReferenceString.parse(this.loginUrl(zone, postAuthRedirectUri)),
				intent: RouterNavigationIntent.AuthRedirect,
				mode: RouterNavigationMode.External,
			});
			this._throwIfNotOperational();
			this._emitEvent({
				type: BasicAuthContextEventType.LoginRedirectSucceeded,
				zone,
			});
		} catch (error) {
			this._lastBoundaryErrorSignal.set(error);
			this._emitEvent({
				type: BasicAuthContextEventType.LoginRedirectFailed,
				zone,
				errorSummary: describeError(error),
			});
			throw error;
		} finally {
			this._operationSignals.loginRedirectPending.set(false);
		}
	}

	/** Find the zone that contains the given path. */
	zoneForPath(path: string): ResolvedBasicAuthZone | undefined {
		let matchedZone: ResolvedBasicAuthZone | undefined;

		for (const zone of this.zones) {
			const matches =
				path === zone.zonePrefix || path.startsWith(`${zone.zonePrefix}/`);
			if (!matches) {
				continue;
			}

			if (
				!matchedZone ||
				zone.zonePrefix.length > matchedZone.zonePrefix.length
			) {
				matchedZone = zone;
			}
		}

		return matchedZone;
	}

	zoneForPrefix(zonePrefix: string): ResolvedBasicAuthZone | undefined {
		return this.zones.find((zone) => zone.zonePrefix === zonePrefix);
	}

	/** Check whether a path falls inside any configured zone. */
	isInZone(path: string): boolean {
		return this.zoneForPath(path) !== undefined;
	}

	/** Build the full login URL for a zone, optionally with a post-auth redirect. */
	loginUrl(zone: ResolvedBasicAuthZone, postAuthRedirectUri?: string): string {
		const base = this._config.baseUrl + zone.loginPath;
		if (postAuthRedirectUri) {
			const params = new URLSearchParams({
				[POST_AUTH_REDIRECT_PARAM]: postAuthRedirectUri,
			});
			return `${base}?${params.toString()}`;
		}
		return base;
	}

	loginUrlForZonePrefix(
		zonePrefix: string,
		postAuthRedirectUri?: string,
	): string | null {
		const zone = this.zoneForPrefix(zonePrefix);
		return zone ? this.loginUrl(zone, postAuthRedirectUri) : null;
	}

	/** Build the full logout URL for a zone. */
	logoutUrl(zone: ResolvedBasicAuthZone): string {
		return this._config.baseUrl + zone.logoutPath;
	}

	/**
	 * Handle a 401 response: if the current path is inside a zone,
	 * return a redirect instruction to the zone's login URL.
	 */
	handleUnauthorized(
		currentPath: string,
		responseStatus: number,
	): AuthGuardResult<null> {
		if (responseStatus !== 401) {
			return { kind: AuthGuardResultKind.Ok, value: null };
		}

		const zone = this.zoneForPath(currentPath);
		if (!zone) {
			return { kind: AuthGuardResultKind.Ok, value: null };
		}

		return {
			kind: AuthGuardResultKind.Redirect,
			status: AuthGuardRedirectStatus.Found,
			location: this.loginUrl(zone, currentPath),
		};
	}

	dispose(): void {
		if (this._destroyed.hasValue()) {
			return;
		}
		this._destroyed.setValue();
		this._rootCancellation.cancel(
			new ClientError({
				kind: ClientErrorKind.Cancelled,
				code: "basic_auth.client_disposed",
				message: "BasicAuthContextClient has been disposed.",
				source: BasicAuthContextSource.BasicAuthContext,
			}),
		);
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	private _resolveRefreshOptions(
		options: BasicAuthRefreshOptions,
	): Required<BasicAuthRefreshOptions> {
		const path = options.path ?? this._config.probePath;
		if (!path) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: "basic_auth.probe_path_required",
				message:
					"BasicAuthContextClient.refresh() requires options.path or config.probePath.",
				source: BasicAuthContextSource.BasicAuthContext,
			});
		}
		return { path };
	}

	private _resolveZoneForAction(
		options: BasicAuthLogoutOptions,
		action: string,
	): ResolvedBasicAuthZone {
		if (options.zonePrefix) {
			const zone = this.zoneForPrefix(options.zonePrefix);
			if (zone) {
				return zone;
			}
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: "basic_auth.zone_not_found",
				message: `BasicAuthContextClient ${action} could not find zone "${options.zonePrefix}".`,
				source: BasicAuthContextSource.BasicAuthContext,
			});
		}

		const zone =
			typeof options.currentPath === "string"
				? this.zoneForPath(options.currentPath)
				: undefined;
		if (zone) {
			return zone;
		}

		throw new ClientError({
			kind: ClientErrorKind.Configuration,
			code: "basic_auth.zone_required",
			message: `BasicAuthContextClient ${action} requires options.currentPath inside a configured zone or options.zonePrefix.`,
			source: BasicAuthContextSource.BasicAuthContext,
		});
	}

	private async _dispatchRefresh(
		payload: Required<BasicAuthRefreshOptions>,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		this._throwIfNotOperational();
		const snapshot = await lastValueFrom(
			dispatchCommandLocallyToStream<
				Required<BasicAuthRefreshOptions>,
				BasicAuthCommandExtra,
				BasicAuthBoundarySnapshot,
				BasicAuthRefreshCommand
			>({
				payload,
				requestStream: this._refreshCommandSubject,
				responseStream: this._refreshResponseSubject,
				createCommandExtra: () => ({ operationSpan }),
			}).pipe(commandResponseData()),
		);
		this._throwIfNotOperational();
		return snapshot;
	}

	private async _dispatchLogout(
		payload: ResolvedBasicAuthZone,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		this._throwIfNotOperational();
		const snapshot = await lastValueFrom(
			dispatchCommandLocallyToStream<
				ResolvedBasicAuthZone,
				BasicAuthCommandExtra,
				BasicAuthBoundarySnapshot,
				BasicAuthLogoutCommand
			>({
				payload,
				requestStream: this._logoutCommandSubject,
				responseStream: this._logoutResponseSubject,
				createCommandExtra: () => ({ operationSpan }),
			}).pipe(commandResponseData()),
		);
		this._throwIfNotOperational();
		return snapshot;
	}

	private async _executeRefresh(
		options: Required<BasicAuthRefreshOptions>,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		this._throwIfNotOperational();
		this._operationSignals.refreshPending.set(true);
		this._emitEvent({
			type: BasicAuthContextEventType.BoundaryRefreshStarted,
			snapshot: this._readCurrentSnapshot(),
		});
		try {
			const response = await this._environment.transport.execute({
				url: this._config.baseUrl + options.path,
				method: "GET",
				headers: { accept: "application/json" },
				cancellationToken: this._rootCancellation.token,
			});
			if (
				response.status >= 400 &&
				response.status !== 401 &&
				response.status !== 403
			) {
				throw ClientError.fromHttpResponse(response.status, response.body);
			}

			this._throwIfNotOperational();
			const snapshot = this._snapshotFromResponse(options.path, response);
			this._boundarySnapshotSignal.setValue(snapshot);
			this._lastBoundaryErrorSignal.set(undefined);
			operationSpan?.setAttributes({
				authenticated: snapshot.authenticated,
				boundaryKind: snapshot.boundaryKind,
			});
			this._emitEvent({
				type: BasicAuthContextEventType.BoundaryRefreshSucceeded,
				snapshot,
				zone: snapshot.zone,
			});
			return snapshot;
		} catch (error) {
			this._lastBoundaryErrorSignal.set(error);
			this._emitEvent({
				type: BasicAuthContextEventType.BoundaryRefreshFailed,
				snapshot: this._readCurrentSnapshot(),
				errorSummary: describeError(error),
			});
			throw error;
		} finally {
			this._operationSignals.refreshPending.set(false);
		}
	}

	private async _executeLogout(
		zone: ResolvedBasicAuthZone,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		this._throwIfNotOperational();
		this._operationSignals.logoutPending.set(true);
		this._emitEvent({
			type: BasicAuthContextEventType.LogoutStarted,
			snapshot: this._readCurrentSnapshot(),
			zone,
		});
		try {
			const response = await this._environment.transport.execute({
				url: this.logoutUrl(zone),
				method: "POST",
				headers: { accept: "application/json" },
				cancellationToken: this._rootCancellation.token,
			});
			this._throwIfNotOperational();
			const snapshot = this._snapshotFromResponse(zone.logoutPath, response);
			if (snapshot.boundaryKind !== BasicAuthBoundaryKindValues.LogoutPoison) {
				throw new ClientError({
					kind: ClientErrorKind.Protocol,
					code: "basic_auth.logout_poison_expected",
					message:
						"BasicAuthContextClient.logout() expected a Basic Auth logout poison response.",
					source: BasicAuthContextSource.BasicAuthContext,
					cause: snapshot,
				});
			}

			this._boundarySnapshotSignal.setValue(snapshot);
			this._lastBoundaryErrorSignal.set(undefined);
			operationSpan?.setAttributes({
				authenticated: false,
				boundaryKind: snapshot.boundaryKind,
			});
			this._emitEvent({
				type: BasicAuthContextEventType.LogoutSucceeded,
				snapshot,
				zone,
			});
			return snapshot;
		} catch (error) {
			this._lastBoundaryErrorSignal.set(error);
			this._emitEvent({
				type: BasicAuthContextEventType.LogoutFailed,
				snapshot: this._readCurrentSnapshot(),
				zone,
				errorSummary: describeError(error),
			});
			throw error;
		} finally {
			this._operationSignals.logoutPending.set(false);
		}
	}

	private _snapshotFromResponse(
		path: string,
		response: { status: number; headers: Record<string, string> },
	): BasicAuthBoundarySnapshot {
		const challengeHeader =
			response.headers["WWW-Authenticate"] ??
			response.headers["www-authenticate"] ??
			null;
		const zone = this.zoneForPath(path);
		const boundaryKind = readBasicAuthBoundaryKind({
			status: response.status,
			challengeHeader,
			requestPath: path,
			isLogoutPath: zone?.logoutPath === path,
		});
		return {
			authenticated: boundaryKind === BasicAuthBoundaryKindValues.Authenticated,
			boundaryKind,
			status: response.status,
			path,
			challengeHeader,
			zone,
		};
	}

	private _readCurrentSnapshot(): BasicAuthBoundarySnapshot | null {
		const slot = this._boundarySnapshotSignal.get();
		return slot.kind === "value" ? slot.value : null;
	}

	private _emitEvent(
		input: Omit<BasicAuthContextEvent, "at" | "client">,
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
