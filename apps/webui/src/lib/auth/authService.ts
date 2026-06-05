import {
	BASIC_AUTH_CONTEXT_CLIENT,
	type BasicAuthContextService,
} from "@securitydept/basic-auth-context-client-react";
import {
	ClientError,
	ClientErrorKind,
	createReplaySignal,
	createRootSpan,
	createTraceTimelineStore,
	createTracing,
	ENVIRONMENT_TOKEN,
	FetchTransportRedirectKind,
	type FoundationEnvironment,
	INJECTOR_TOKEN,
	type ReadableReplaySignalTrait,
	SecuritydeptInjectionToken,
	type SecuritydeptInjector,
	type SecuritydeptProvider,
	takeCompatFragmentFromRouter,
} from "@securitydept/client";
import { observableToReplaySignal } from "@securitydept/client/rx";
import { createEnvironmentForNativeWeb } from "@securitydept/client/web";
import {
	SESSION_CONTEXT_CLIENT,
	type SessionContextService,
} from "@securitydept/session-context-client-react";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	createFrontendOidcModeBrowserClient,
	createFrontendOidcModeWebClientEnvironment,
	type FrontendOidcModeClient,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	provideTokenSetClientRegistry,
	TOKEN_SET_CLIENT_REGISTRY,
	type TokenSetClientRegistryService,
} from "@securitydept/token-set-context-client-react";
import { defer, from, map, type Observable, switchMap } from "rxjs";
import {
	type DashboardUser,
	projectDashboardUser,
} from "@/lib/dashboardPrincipal";
import {
	TOKEN_SET_BACKEND_MODE_CLIENT_KEY,
	TOKEN_SET_BACKEND_MODE_LOGIN_PATH,
	TOKEN_SET_BACKEND_MODE_METADATA_REDEEM_PATH,
	TOKEN_SET_BACKEND_MODE_REFRESH_PATH,
	TOKEN_SET_BACKEND_MODE_USER_INFO_PATH,
	TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH,
	TOKEN_SET_FRONTEND_MODE_CLIENT_KEY,
	TOKEN_SET_FRONTEND_MODE_CONFIG_PATH,
} from "@/lib/tokenSetConfig";

const STORAGE_KEY = "securitydept.webui.auth_context_mode";
const AUTH_CONTEXT_CHANGE_EVENT = "securitydept.webui.auth_context_mode.change";
const TOKEN_SET_FRONTEND_PERSISTENT_PREFIX =
	"securitydept.webui.token-set-frontend:persistent:";
const TOKEN_SET_FRONTEND_SESSION_PREFIX =
	"securitydept.webui.token-set-frontend:session:";

const tokenSetBackendModeRootSpan = createRootSpan();
export const tokenSetBackendModeTraceTimeline = createTraceTimelineStore();
export const tokenSetBackendModeTracing = createTracing({
	subscribers: [tokenSetBackendModeTraceTimeline],
});
export const tokenSetBackendModeHostSpan = tokenSetBackendModeRootSpan.fork({
	attributes: {
		target: "apps.webui.token-set-backend",
		role: "host",
	},
});

const tokenSetFrontendModeRootSpan = createRootSpan();
export const tokenSetFrontendModeTraceTimeline = createTraceTimelineStore();
const tokenSetFrontendModeTracing = createTracing({
	subscribers: [tokenSetFrontendModeTraceTimeline],
});

const tokenSetBackendModeClient = new BackendOidcModeClient(
	{
		baseUrl: "",
		defaultPostAuthRedirectUri: "/",
		loginPath: TOKEN_SET_BACKEND_MODE_LOGIN_PATH,
		refreshPath: TOKEN_SET_BACKEND_MODE_REFRESH_PATH,
		metadataRedeemPath: TOKEN_SET_BACKEND_MODE_METADATA_REDEEM_PATH,
		userInfoPath: TOKEN_SET_BACKEND_MODE_USER_INFO_PATH,
	},
	createEnvironmentForNativeWeb({
		span: tokenSetBackendModeRootSpan,
		tracing: tokenSetBackendModeTracing,
		transportForStdFetchCreateOptions: {
			redirect: FetchTransportRedirectKind.Manual,
		},
	}),
);

let tokenSetFrontendModeClientPromise: Promise<FrontendOidcModeClient> | null =
	null;

function getTokenSetFrontendModeClient(): Promise<FrontendOidcModeClient> {
	tokenSetFrontendModeClientPromise ??= createFrontendOidcModeBrowserClient({
		configEndpoint: TOKEN_SET_FRONTEND_MODE_CONFIG_PATH,
		redirectUri: new URL(
			TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH,
			window.location.origin,
		).toString(),
		defaultPostAuthRedirectUri: "/",
		environment: createFrontendOidcModeWebClientEnvironment({
			persistentStoragePrefix: TOKEN_SET_FRONTEND_PERSISTENT_PREFIX,
			sessionStoragePrefix: TOKEN_SET_FRONTEND_SESSION_PREFIX,
			span: tokenSetFrontendModeRootSpan,
			tracing: tokenSetFrontendModeTracing,
		}),
	}).then(({ client }) => client);

	return tokenSetFrontendModeClientPromise;
}

export const AuthContextMode = {
	Session: "session",
	TokenSetBackend: "token-set-backend-mode",
	TokenSetFrontend: "token-set-frontend-mode",
	Basic: "basic",
} as const;

export type AuthContextMode =
	(typeof AuthContextMode)[keyof typeof AuthContextMode];

export const WebuiAuthUserKind = {
	Session: "session",
	Basic: "basic",
	TokenSetBackendOidcMode: "token-set-backend-oidc-mode",
	TokenSetFrontendOidcMode: "token-set-frontend-oidc-mode",
} as const;

export type WebuiAuthUserKind =
	(typeof WebuiAuthUserKind)[keyof typeof WebuiAuthUserKind];

export interface WebuiSessionAuthUser {
	readonly type: typeof WebuiAuthUserKind.Session;
	readonly userInfo: DashboardUser;
}

export interface WebuiBasicAuthUser {
	readonly type: typeof WebuiAuthUserKind.Basic;
	readonly userInfo: DashboardUser;
}

export interface WebuiTokenSetBackendOidcModeAuthUser {
	readonly type: typeof WebuiAuthUserKind.TokenSetBackendOidcMode;
	readonly userInfo: DashboardUser;
}

export interface WebuiTokenSetFrontendOidcModeAuthUser {
	readonly type: typeof WebuiAuthUserKind.TokenSetFrontendOidcMode;
	readonly userInfo: DashboardUser;
}

export type WebuiAuthUser =
	| WebuiSessionAuthUser
	| WebuiBasicAuthUser
	| WebuiTokenSetBackendOidcModeAuthUser
	| WebuiTokenSetFrontendOidcModeAuthUser
	| null;

export interface DashboardCookieAccess {
	readonly kind: "cookie";
	readonly mode: typeof AuthContextMode.Session | typeof AuthContextMode.Basic;
	readonly basePath: "" | "/basic";
}

export interface DashboardTokenSetAccess {
	readonly kind: "token-set";
	readonly mode:
		| typeof AuthContextMode.TokenSetBackend
		| typeof AuthContextMode.TokenSetFrontend;
	readonly clientKey: string;
	readonly client: BaseOidcModeClient;
}

export type DashboardAccess = DashboardCookieAccess | DashboardTokenSetAccess;

export interface AuthLoginOptions {
	readonly mode?: AuthContextMode;
	readonly postAuthRedirectUri?: string;
}

export const AUTH_SERVICE = new SecuritydeptInjectionToken<AuthService>(
	"AUTH_SERVICE",
);

export function isTokenSetAuthContextMode(
	mode: AuthContextMode | null,
): mode is
	| typeof AuthContextMode.TokenSetBackend
	| typeof AuthContextMode.TokenSetFrontend {
	return (
		mode === AuthContextMode.TokenSetBackend ||
		mode === AuthContextMode.TokenSetFrontend
	);
}

export function resolveTokenSetClientKey(
	mode: AuthContextMode | null,
): string | null {
	if (mode === AuthContextMode.TokenSetBackend) {
		return TOKEN_SET_BACKEND_MODE_CLIENT_KEY;
	}
	if (mode === AuthContextMode.TokenSetFrontend) {
		return TOKEN_SET_FRONTEND_MODE_CLIENT_KEY;
	}
	return null;
}

export class AuthService {
	private readonly session: SessionContextService;
	private readonly basic: BasicAuthContextService;
	private readonly registry: TokenSetClientRegistryService;
	private readonly environment: FoundationEnvironment;
	private readonly modeSignal = createReplaySignal<AuthContextMode>();
	readonly authUser: ReadableReplaySignalTrait<WebuiAuthUser>;

	tokenSetBackendModeClient$: Observable<BaseOidcModeClient>;
	tokenSetFrontendModeClient$: Observable<BaseOidcModeClient>;

	constructor(injector: SecuritydeptInjector) {
		this.session = injector.get(
			SESSION_CONTEXT_CLIENT,
		) as SessionContextService;
		this.basic = injector.get(
			BASIC_AUTH_CONTEXT_CLIENT,
		) as BasicAuthContextService;
		this.registry = injector.get(TOKEN_SET_CLIENT_REGISTRY);
		this.environment = injector.get(ENVIRONMENT_TOKEN);
		this.modeSignal.setValue(this.resolveMode());
		this.tokenSetBackendModeClient$ = defer(() =>
			from(this.registry.clientSignalFor(TOKEN_SET_BACKEND_MODE_CLIENT_KEY)),
		);
		this.tokenSetFrontendModeClient$ = defer(() =>
			from(this.registry.clientSignalFor(TOKEN_SET_FRONTEND_MODE_CLIENT_KEY)),
		);

		this.authUser = observableToReplaySignal(
			from(this.modeSignal).pipe(
					switchMap((mode) => {
						if (mode === AuthContextMode.Session) {
							return from(this.session.sessionInfo).pipe(
								map(
									(session): WebuiAuthUser =>
										session
											? {
													type: WebuiAuthUserKind.Session,
													userInfo: projectDashboardUser({
														principal: session.principal,
														contextLabel: "Session",
													}),
												}
											: null,
								),
							);
						}

						if (mode === AuthContextMode.Basic) {
							return from(this.basic.boundarySnapshot).pipe(
								map(
									(snapshot): WebuiAuthUser =>
										snapshot?.authenticated
											? {
													type: WebuiAuthUserKind.Basic,
													userInfo: projectDashboardUser({
														contextLabel: "Basic",
														fallbackDisplayName: "Basic auth context",
														fallbackSubject: "context.basic-auth",
														showIdentity: false,
													}),
												}
											: null,
								),
							);
						}

						if (mode === AuthContextMode.TokenSetBackend) {
							return this.tokenSetBackendModeClient$.pipe(
								switchMap((client) => from(client.authSnapshot)),
								map(
									(snapshot): WebuiAuthUser =>
										snapshot?.metadata.principal
											? {
													type: WebuiAuthUserKind.TokenSetBackendOidcMode,
													userInfo: projectDashboardUser({
														principal: snapshot.metadata.principal,
														contextLabel: "Token Set Backend Mode",
													}),
												}
											: null,
								),
							);
						}

						return this.tokenSetFrontendModeClient$.pipe(
							switchMap((client) => from(client.authSnapshot)),
							map(
								(snapshot): WebuiAuthUser =>
									snapshot?.metadata.principal
										? {
												type: WebuiAuthUserKind.TokenSetFrontendOidcMode,
												userInfo: projectDashboardUser({
													principal: snapshot.metadata.principal,
													contextLabel: "Token Set Frontend Mode",
												}),
											}
										: null,
							),
						);
					}),
			),
		);
	}

	getMode(): AuthContextMode | null {
		if (typeof localStorage === "undefined") {
			return null;
		}
		const raw = localStorage.getItem(STORAGE_KEY);
		return this.parseMode(raw);
	}

	resolveMode(): AuthContextMode {
		return this.getMode() ?? AuthContextMode.Session;
	}

	setMode(mode: AuthContextMode): void {
		localStorage.setItem(STORAGE_KEY, mode);
		this.modeSignal.setValue(mode);
		this.notifyModeChanged();
	}

	clearMode(): void {
		localStorage.removeItem(STORAGE_KEY);
		this.modeSignal.setValue(AuthContextMode.Session);
		this.notifyModeChanged();
	}

	subscribeMode(listener: () => void): () => void {
		if (typeof window === "undefined") {
			return () => {};
		}
		const storageListener = (event: StorageEvent) => {
			if (event.key === null || event.key === STORAGE_KEY) {
				listener();
			}
		};
		const localListener = () => listener();
		window.addEventListener("storage", storageListener);
		window.addEventListener(AUTH_CONTEXT_CHANGE_EVENT, localListener);
		return () => {
			window.removeEventListener("storage", storageListener);
			window.removeEventListener(AUTH_CONTEXT_CHANGE_EVENT, localListener);
		};
	}

	async ensureAuthenticatedForRoute(_url: string): Promise<boolean> {
		const mode = this.resolveMode();
		if (mode === AuthContextMode.Session) {
			return (await this.session.refresh()) !== null;
		}
		if (mode === AuthContextMode.Basic) {
			return (await this.basic.refresh({ path: "/basic/api/entries" }))
				.authenticated;
		}
		const client = await this.resolveTokenSetClient(mode);
		if (mode === AuthContextMode.TokenSetBackend) {
			await this.resumeBackendCallbackIfPresent(client);
		} else {
			await client.start();
		}
		return (await client.isAuthenticated.whenValue()) === true;
	}

	async login(options: AuthLoginOptions = {}): Promise<void> {
		const mode = options.mode ?? this.resolveMode();
		this.setMode(mode);
		if (mode === AuthContextMode.Session) {
			await this.session.loginWithRedirect({
				postAuthRedirectUri: options.postAuthRedirectUri,
			});
			return;
		}
		if (mode === AuthContextMode.Basic) {
			await this.basic.loginWithRedirect({
				zonePrefix: "/basic",
				postAuthRedirectUri: options.postAuthRedirectUri,
			});
			return;
		}
		const client = await this.resolveTokenSetClient(mode);
		await client.loginWithRedirect({
			postAuthRedirectUri: options.postAuthRedirectUri,
		});
	}

	async logout(): Promise<void> {
		const mode = this.resolveMode();
		try {
			if (mode === AuthContextMode.Session) {
				await this.session.logout();
			} else if (mode === AuthContextMode.Basic) {
				await this.basic.logout({ zonePrefix: "/basic" });
			} else {
				await (await this.resolveTokenSetClient(mode)).logout();
			}
		} finally {
			this.clearMode();
		}
	}

	getBackendOidcClient(): BackendOidcModeClient {
		return tokenSetBackendModeClient;
	}

	async getFrontendOidcClient(): Promise<FrontendOidcModeClient> {
		return await getTokenSetFrontendModeClient();
	}

	async resolveDashboardAccess(): Promise<DashboardAccess> {
		const mode = this.resolveMode();
		if (mode === AuthContextMode.Session) {
			return { kind: "cookie", mode, basePath: "" };
		}
		if (mode === AuthContextMode.Basic) {
			return { kind: "cookie", mode, basePath: "/basic" };
		}
		return {
			kind: "token-set",
			mode,
			clientKey: resolveTokenSetClientKey(mode) ?? mode,
			client: await this.resolveTokenSetClient(mode),
		};
	}

	private async resolveTokenSetClient(
		mode: AuthContextMode,
	): Promise<BaseOidcModeClient> {
		const clientKey = resolveTokenSetClientKey(mode);
		if (!clientKey) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: "webui.auth.token_set_mode.invalid",
				message: `Auth mode ${mode} is not backed by a token-set client.`,
				source: "webui",
			});
		}
		const view = await this.registry.initialize(clientKey);
		return view.client;
	}

	private async resumeBackendCallbackIfPresent(
		client: BaseOidcModeClient,
	): Promise<void> {
		const router = this.environment.router;
		if (!router) {
			await client.start();
			return;
		}
		const fragment = await takeCompatFragmentFromRouter(router);
		if (!fragment) {
			await client.start();
			return;
		}
		if (
			typeof (client as { handleCallback?: unknown }).handleCallback ===
			"function"
		) {
			await (
				client as {
					handleCallback(parameters: Record<string, string>): Promise<unknown>;
				}
			).handleCallback(fragment.parameters);
			return;
		}
		await client.start();
	}

	private parseMode(raw: string | null): AuthContextMode | null {
		return raw === AuthContextMode.Session ||
			raw === AuthContextMode.TokenSetBackend ||
			raw === AuthContextMode.TokenSetFrontend ||
			raw === AuthContextMode.Basic
			? raw
			: null;
	}

	private notifyModeChanged(): void {
		if (typeof window !== "undefined") {
			window.dispatchEvent(new Event(AUTH_CONTEXT_CHANGE_EVENT));
		}
	}
}

export function provideAuthService(): readonly SecuritydeptProvider[] {
	return [
		...provideTokenSetClientRegistry({
			clients: [
				{
					meta: {
						clientKey: TOKEN_SET_BACKEND_MODE_CLIENT_KEY,
					},
					clientFactory: () => tokenSetBackendModeClient,
				},
				{
					meta: {
						clientKey: TOKEN_SET_FRONTEND_MODE_CLIENT_KEY,
						callbackPath: TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH,
					},
					clientFactory: getTokenSetFrontendModeClient,
				},
			],
		}),
		{
			provide: AuthService,
			useFactory: (injector: SecuritydeptInjector) => new AuthService(injector),
			deps: [INJECTOR_TOKEN],
		},
		{
			provide: AUTH_SERVICE,
			useExisting: AuthService,
		},
	];
}
