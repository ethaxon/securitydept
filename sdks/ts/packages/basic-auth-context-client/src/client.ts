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
	describeError,
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
	type SpanTrait,
	SYMBOL_DISPOSE,
	throwValidationClientError,
	UriReferenceString,
	validateTraitInput,
	type WritableSignalTrait,
	withDisposableStack,
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
import { filter, from, lastValueFrom, take, takeUntil } from "rxjs";
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
	BasicAuthContextErrorCode,
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
	cancellationToken: CancellationTokenTrait;
	operationSpan?: OperationSpanTrait;
}

type ResolvedBasicAuthRefreshOptions = { path: string };

type BasicAuthRefreshCommand = Command<
	ResolvedBasicAuthRefreshOptions,
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
				normalizeError: (error: unknown) =>
					ClientError.fromUnknown(error, {
						code: BasicAuthContextErrorCode.OperationFailed,
						message: "The Basic Auth operation failed unexpectedly",
						source: BasicAuthContextSource.BasicAuthContext,
					}),
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
	private readonly _destroyed = RxStateSignal.fromInitialValue(false);
	private readonly destroyed$ = from(this._destroyed).pipe(
		filter((value): value is true => value),
		take(1),
	);
	private readonly _boundarySnapshotSignal = RxStateSignal.fromInitialValue<
		ResourceSnapshot<BasicAuthBoundarySnapshot | null>
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
		new RxEventReplaySubject<BasicAuthContextEvent>(100);
	private readonly _refreshCommandSubject =
		new RxEventSubject<BasicAuthRefreshCommand>();
	private readonly _refreshResponseSubject = new RxEventSubject<
		CommandResponse<BasicAuthRefreshCommand, BasicAuthBoundarySnapshot>
	>();
	private readonly _logoutCommandSubject =
		new RxEventSubject<BasicAuthLogoutCommand>();
	private readonly _logoutResponseSubject = new RxEventSubject<
		CommandResponse<BasicAuthLogoutCommand, BasicAuthBoundarySnapshot>
	>();
	private readonly _startOnce = createOnceAsyncLockCallable(
		async (
			cancellationToken: CancellationTokenTrait,
			operationSpan?: OperationSpanTrait,
		) => {
			cancellationToken.throwIfCancellationRequested();
			this._operationSignals.startPending.set(true);
			try {
				return await this._dispatchRefresh(
					this._resolveRefreshOptions({}),
					cancellationToken,
					operationSpan,
				);
			} finally {
				this._operationSignals.startPending.set(false);
			}
		},
	);

	readonly id: string;
	readonly zones: readonly ResolvedBasicAuthZone[];
	readonly boundarySnapshot: ReadableSignalTrait<
		ResourceSnapshot<BasicAuthBoundarySnapshot | null>
	>;
	readonly boundaryResource: ResourceTrait<BasicAuthBoundarySnapshot | null>;
	readonly isAuthenticated: ResourceTrait<boolean>;
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
					code: BasicAuthContextErrorCode.InvalidConfig,
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
		this.boundarySnapshot = readonlySignal(this._boundarySnapshotSignal);
		this.boundaryResource = resourceFromSnapshots(() =>
			this._boundarySnapshotSignal.get(),
		);
		this.isAuthenticated = mapResource(
			this.boundaryResource,
			(snapshot) => snapshot?.authenticated === true,
		);
		this.operations = {
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
					code: BasicAuthContextErrorCode.ClientDisposed,
					message: "BasicAuthContextClient has been disposed.",
					source: BasicAuthContextSource.BasicAuthContext,
				}),
			);
			this.isAuthenticated.dispose();
			this.boundaryResource.dispose();
		});

		from(this._refreshCommandSubject)
			.pipe(
				takeUntil(this.destroyed$),
				concatCommand((command) =>
					this._executeRefresh(
						command.payload,
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
					this._executeLogout(
						command.payload,
						command.cancellationToken,
						command.operationSpan,
					),
				),
			)
			.subscribe(this._logoutResponseSubject);

		if (config.autoStart === true) {
			this.start().catch(() => {
				// Startup failure is reflected by boundarySnapshot.
			});
		}
	}

	async start(): Promise<BasicAuthBoundarySnapshot> {
		const cancellationToken = this._rootCancellation.token;
		return await this._start(cancellationToken);
	}

	@instrumentBasicAuthMethod("start")
	private async _start(
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		return await this._startOnce(cancellationToken, operationSpan);
	}

	@withDisposableStack(0, true)
	async refresh(
		options: BasicAuthRefreshOptions = {},
	): Promise<BasicAuthBoundarySnapshot> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._refresh(options, cancellationToken);
	}

	@instrumentBasicAuthMethod("refresh")
	private async _refresh(
		options: BasicAuthRefreshOptions,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		cancellationToken.throwIfCancellationRequested();
		return await this._dispatchRefresh(
			this._resolveRefreshOptions(options),
			cancellationToken,
			operationSpan,
		);
	}

	@withDisposableStack(0, true)
	async logout(
		options: BasicAuthLogoutOptions,
	): Promise<BasicAuthBoundarySnapshot> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._logout(options, cancellationToken);
	}

	@instrumentBasicAuthMethod("logout")
	private async _logout(
		options: BasicAuthLogoutOptions,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		cancellationToken.throwIfCancellationRequested();
		return await this._dispatchLogout(
			this._resolveZoneForAction(options, "logout"),
			cancellationToken,
			operationSpan,
		);
	}

	@withDisposableStack(0, true)
	async loginWithRedirect(
		options: BasicAuthLoginWithRedirectOptions,
	): Promise<void> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		await this._loginWithRedirect(options, cancellationToken);
	}

	@instrumentBasicAuthMethod("login.redirect")
	private async _loginWithRedirect(
		options: BasicAuthLoginWithRedirectOptions,
		cancellationToken: CancellationTokenTrait,
		_operationSpan?: OperationSpanTrait,
	): Promise<void> {
		cancellationToken.throwIfCancellationRequested();
		const router = this._environment.router;
		if (!router) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: BasicAuthContextErrorCode.RouterUnavailable,
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
			cancellationToken.throwIfCancellationRequested();
			this._emitEvent({
				type: BasicAuthContextEventType.LoginRedirectSucceeded,
				zone,
			});
		} catch (error) {
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
		this._destroyed.set(true);
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	private _resolveRefreshOptions(
		options: BasicAuthRefreshOptions,
	): ResolvedBasicAuthRefreshOptions {
		const path = options.path ?? this._config.probePath;
		if (!path) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: BasicAuthContextErrorCode.ProbePathRequired,
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
				code: BasicAuthContextErrorCode.ZoneNotFound,
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
			code: BasicAuthContextErrorCode.ZoneRequired,
			message: `BasicAuthContextClient ${action} requires options.currentPath inside a configured zone or options.zonePrefix.`,
			source: BasicAuthContextSource.BasicAuthContext,
		});
	}

	private async _dispatchRefresh(
		payload: ResolvedBasicAuthRefreshOptions,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		cancellationToken.throwIfCancellationRequested();
		const snapshot = await lastValueFrom(
			dispatchCommandLocallyToStream<
				ResolvedBasicAuthRefreshOptions,
				BasicAuthCommandExtra,
				BasicAuthBoundarySnapshot,
				BasicAuthRefreshCommand
			>({
				payload,
				requestStream: this._refreshCommandSubject,
				responseStream: this._refreshResponseSubject,
				createCommandExtra: () => ({ cancellationToken, operationSpan }),
			}).pipe(commandResponseData()),
		);
		cancellationToken.throwIfCancellationRequested();
		return snapshot;
	}

	private async _dispatchLogout(
		payload: ResolvedBasicAuthZone,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		cancellationToken.throwIfCancellationRequested();
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
				createCommandExtra: () => ({ cancellationToken, operationSpan }),
			}).pipe(commandResponseData()),
		);
		cancellationToken.throwIfCancellationRequested();
		return snapshot;
	}

	private async _executeRefresh(
		options: ResolvedBasicAuthRefreshOptions,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		cancellationToken.throwIfCancellationRequested();
		this._operationSignals.refreshPending.set(true);
		const previous = this._boundarySnapshotSignal.get();
		const loadingSnapshot = reduceResourceSnapshot(previous, {
			kind: ResourceSnapshotUpdateKind.Load,
		});
		this._boundarySnapshotSignal.set(loadingSnapshot);
		this._emitEvent({
			type: BasicAuthContextEventType.BoundaryRefreshStarted,
			snapshot: this._readCurrentSnapshot(),
		});
		try {
			const response = await this._environment.transport.execute({
				url: this._config.baseUrl + options.path,
				method: "GET",
				headers: { accept: "application/json" },
				cancellationToken,
			});
			if (
				response.status >= 400 &&
				response.status !== 401 &&
				response.status !== 403
			) {
				throw ClientError.fromHttpResponse({
					status: response.status,
					body: response.body,
				});
			}

			cancellationToken.throwIfCancellationRequested();
			const snapshot = this._snapshotFromResponse(options.path, response);
			this._boundarySnapshotSignal.set(
				reduceResourceSnapshot(loadingSnapshot, {
					kind: ResourceSnapshotUpdateKind.Resolve,
					value: snapshot,
				}),
			);
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
			this._boundarySnapshotSignal.set(
				reduceResourceSnapshot(loadingSnapshot, {
					kind: ResourceSnapshotUpdateKind.Fail,
					error,
				}),
			);
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
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<BasicAuthBoundarySnapshot> {
		cancellationToken.throwIfCancellationRequested();
		this._operationSignals.logoutPending.set(true);
		const previous = this._boundarySnapshotSignal.get();
		const loadingSnapshot = reduceResourceSnapshot(previous, {
			kind: ResourceSnapshotUpdateKind.Load,
		});
		this._boundarySnapshotSignal.set(loadingSnapshot);
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
				cancellationToken,
			});
			cancellationToken.throwIfCancellationRequested();
			const snapshot = this._snapshotFromResponse(zone.logoutPath, response);
			if (snapshot.boundaryKind !== BasicAuthBoundaryKindValues.LogoutPoison) {
				throw new ClientError({
					kind: ClientErrorKind.Protocol,
					code: BasicAuthContextErrorCode.LogoutPoisonExpected,
					message:
						"BasicAuthContextClient.logout() expected a Basic Auth logout poison response.",
					source: BasicAuthContextSource.BasicAuthContext,
					cause: snapshot,
				});
			}

			this._boundarySnapshotSignal.set(
				reduceResourceSnapshot(loadingSnapshot, {
					kind: ResourceSnapshotUpdateKind.Resolve,
					value: snapshot,
				}),
			);
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
			this._boundarySnapshotSignal.set(
				reduceResourceSnapshot(loadingSnapshot, {
					kind: ResourceSnapshotUpdateKind.Fail,
					error,
				}),
			);
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
		const snapshot = this._boundarySnapshotSignal.get();
		return snapshot.status === ResourceStatus.Reloading ||
			snapshot.status === ResourceStatus.Resolved ||
			snapshot.status === ResourceStatus.Error
			? snapshot.value
			: null;
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
}
