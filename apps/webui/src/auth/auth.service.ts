import {
	BASIC_AUTH_CONTEXT_CLIENT,
	type BasicAuthContextService,
} from "@securitydept/basic-auth-context-client-react";
import {
	type BaseTransportTrait,
	createComputed,
	createSignal,
	type DisposableTrait,
	ENVIRONMENT_TOKEN,
	type FoundationEnvironment,
	INJECTOR_TOKEN,
	type ReadableSignalTrait,
	type ResourceSnapshot,
	ResourceStatus,
	type ResourceTrait,
	resourceFromSnapshots,
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	type SecuritydeptInjector,
	type SecuritydeptProvider,
	SYMBOL_DISPOSE,
	type WritableSignalTrait,
} from "@securitydept/client";
import {
	SESSION_CONTEXT_CLIENT,
	type SessionContextService,
} from "@securitydept/session-context-client-react";
import { type BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { type FrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	provideTokenSetClientRegistry,
	TOKEN_SET_CLIENT_REGISTRY,
	type TokenSetClientRegistryService,
} from "@securitydept/token-set-context-client-react";
import {
	TOKEN_SET_BACKEND_MODE_CONFIG,
	TOKEN_SET_FRONTEND_MODE_CONFIG,
} from "@/auth/token-set/config";
import { createWebuiTokenSetClientEntries } from "@/auth/token-set/providers";
import {
	provideTokenSetTracing,
	TokenSetTracingService,
} from "@/auth/token-set/tracing";
import { projectDashboardUser } from "@/dashboard/principal";
import { type AuthModeStore } from "./mode-store";
import {
	AuthContextMode,
	type AuthLoginOptions,
	type DashboardAccess,
	type WebuiAuthUser,
	WebuiAuthUserKind,
} from "./model";

function mapAuthUserSnapshot<T>(
	snapshot: ResourceSnapshot<T>,
	mapValue: (value: T) => WebuiAuthUser,
): ResourceSnapshot<WebuiAuthUser> {
	switch (snapshot.status) {
		case ResourceStatus.Idle:
		case ResourceStatus.Loading:
		case ResourceStatus.LoadingError:
			return snapshot;
		case ResourceStatus.Reloading:
		case ResourceStatus.Resolved:
			return {
				status: snapshot.status,
				value: mapValue(snapshot.value),
			};
		case ResourceStatus.Error:
			return {
				status: ResourceStatus.Error,
				value: mapValue(snapshot.value),
				error: snapshot.error,
			};
	}
}

export const AUTH_SERVICE = new SecuritydeptInjectionToken<AuthService>(
	"AUTH_SERVICE",
);
export const AUTH_MODE_STORE = new SecuritydeptInjectionToken<AuthModeStore>(
	"AUTH_MODE_STORE",
);

export class AuthService implements DisposableTrait {
	private readonly session: SessionContextService;
	private readonly basic: BasicAuthContextService;
	private readonly registry: TokenSetClientRegistryService;
	private readonly modeStore: AuthModeStore;
	private readonly modeSignal: WritableSignalTrait<AuthContextMode>;
	private readonly unsubscribeModeStore: () => void;
	private readonly tokenSetBackendModeClientResource: ResourceTrait<BaseOidcModeClient>;
	private readonly tokenSetFrontendModeClientResource: ResourceTrait<BaseOidcModeClient>;
	readonly authUser: ResourceTrait<WebuiAuthUser>;
	readonly mode: ReadableSignalTrait<AuthContextMode>;
	readonly environment: FoundationEnvironment;

	get transport(): BaseTransportTrait {
		return this.environment.transport;
	}

	constructor(injector: SecuritydeptInjector) {
		this.session = injector.get(
			SESSION_CONTEXT_CLIENT,
		) as SessionContextService;
		this.basic = injector.get(
			BASIC_AUTH_CONTEXT_CLIENT,
		) as BasicAuthContextService;
		this.registry = injector.get(TOKEN_SET_CLIENT_REGISTRY);
		this.modeStore = injector.get(AUTH_MODE_STORE);
		const initialMode = this.resolveMode();
		this.modeSignal = createSignal(initialMode);
		this.mode = this.modeSignal;
		this.environment = injector.get(ENVIRONMENT_TOKEN);
		this.tokenSetBackendModeClientResource = this.registry.clientResourceFor(
			TOKEN_SET_BACKEND_MODE_CONFIG.clientKey,
			{ initialize: false },
		);
		this.tokenSetFrontendModeClientResource = this.registry.clientResourceFor(
			TOKEN_SET_FRONTEND_MODE_CONFIG.clientKey,
			{ initialize: false },
		);
		if (initialMode === AuthContextMode.TokenSetBackend) {
			this.registry.clientResourceFor(TOKEN_SET_BACKEND_MODE_CONFIG.clientKey);
		} else if (initialMode === AuthContextMode.TokenSetFrontend) {
			this.registry.clientResourceFor(TOKEN_SET_FRONTEND_MODE_CONFIG.clientKey);
		}
		this.unsubscribeModeStore = this.modeStore.subscribe(() => {
			const mode = this.getMode() ?? AuthContextMode.Session;
			if (mode === AuthContextMode.TokenSetBackend) {
				this.registry.clientResourceFor(
					TOKEN_SET_BACKEND_MODE_CONFIG.clientKey,
				);
			} else if (mode === AuthContextMode.TokenSetFrontend) {
				this.registry.clientResourceFor(
					TOKEN_SET_FRONTEND_MODE_CONFIG.clientKey,
				);
			}
			this.modeSignal.set(mode);
		});

		const authUserSnapshot = createComputed<ResourceSnapshot<WebuiAuthUser>>(
			() => {
				const mode = this.modeSignal.get();
				if (mode === AuthContextMode.Session) {
					return mapAuthUserSnapshot(
						this.session.sessionResource.snapshot.get(),
						(session) =>
							session
								? {
										type: WebuiAuthUserKind.Session,
										userInfo: projectDashboardUser({
											principal: session.principal,
											contextLabel: "Session",
										}),
									}
								: null,
					);
				}
				if (mode === AuthContextMode.Basic) {
					return mapAuthUserSnapshot(
						this.basic.boundaryResource.snapshot.get(),
						(snapshot) =>
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
					);
				}

				const clientSnapshot =
					mode === AuthContextMode.TokenSetBackend
						? this.tokenSetBackendModeClientResource.snapshot.get()
						: this.tokenSetFrontendModeClientResource.snapshot.get();
				if (
					clientSnapshot.status === ResourceStatus.Idle ||
					clientSnapshot.status === ResourceStatus.Loading ||
					clientSnapshot.status === ResourceStatus.LoadingError
				) {
					return clientSnapshot;
				}
				if (clientSnapshot.status === ResourceStatus.Error) {
					return {
						status: ResourceStatus.LoadingError,
						error: clientSnapshot.error,
					};
				}

				const type =
					mode === AuthContextMode.TokenSetBackend
						? WebuiAuthUserKind.TokenSetBackendOidcMode
						: WebuiAuthUserKind.TokenSetFrontendOidcMode;
				const contextLabel =
					mode === AuthContextMode.TokenSetBackend
						? "Token Set Backend Mode"
						: "Token Set Frontend Mode";
				return mapAuthUserSnapshot(
					clientSnapshot.value.authResource.snapshot.get(),
					(snapshot) => {
						const principal = snapshot?.metadata.principal;
						return principal
							? {
									type,
									userInfo: projectDashboardUser({ principal, contextLabel }),
								}
							: null;
					},
				);
			},
		);
		this.authUser = resourceFromSnapshots(() => authUserSnapshot.get());
		injector.get(SecuritydeptDestroyRef).onDestroy(() => this.dispose());
	}

	getMode(): AuthContextMode | null {
		return this.parseMode(this.modeStore.read());
	}

	resolveMode(): AuthContextMode {
		return this.getMode() ?? AuthContextMode.Session;
	}

	setMode(mode: AuthContextMode): void {
		if (mode === AuthContextMode.TokenSetBackend) {
			this.registry.clientResourceFor(TOKEN_SET_BACKEND_MODE_CONFIG.clientKey);
		} else if (mode === AuthContextMode.TokenSetFrontend) {
			this.registry.clientResourceFor(TOKEN_SET_FRONTEND_MODE_CONFIG.clientKey);
		}
		this.modeStore.write(mode);
		this.modeSignal.set(mode);
	}

	clearMode(): void {
		this.modeStore.clear();
		this.modeSignal.set(AuthContextMode.Session);
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
		const client =
			mode === AuthContextMode.TokenSetBackend
				? await this.getBackendOidcClient()
				: await this.getFrontendOidcClient();
		return (await client.isAuthenticated.whenValue()) === true;
	}

	async login(options: AuthLoginOptions): Promise<void> {
		const mode = options.mode;
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
		const client =
			mode === AuthContextMode.TokenSetBackend
				? await this.getBackendOidcClient()
				: await this.getFrontendOidcClient();
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
			} else if (mode === AuthContextMode.TokenSetBackend) {
				await (await this.getBackendOidcClient()).logout();
			} else {
				await (await this.getFrontendOidcClient()).logout();
			}
		} finally {
			this.clearMode();
		}
	}

	async getBackendOidcClient(): Promise<BackendOidcModeClient> {
		const view = await this.registry.clientRecordFor(
			TOKEN_SET_BACKEND_MODE_CONFIG.clientKey,
			{ initialize: true },
		);
		return view.client as BackendOidcModeClient;
	}

	async getFrontendOidcClient(): Promise<FrontendOidcModeClient> {
		const view = await this.registry.clientRecordFor(
			TOKEN_SET_FRONTEND_MODE_CONFIG.clientKey,
			{ initialize: true },
		);
		return view.client as FrontendOidcModeClient;
	}

	async resolveDashboardAccess(): Promise<DashboardAccess> {
		const mode = this.resolveMode();
		if (mode === AuthContextMode.Session) {
			return {
				kind: "cookie",
				mode,
				basePath: "",
				transport: this.transport,
			};
		}
		if (mode === AuthContextMode.Basic) {
			return {
				kind: "cookie",
				mode,
				basePath: "/basic",
				transport: this.transport,
			};
		}
		if (mode === AuthContextMode.TokenSetBackend) {
			return {
				kind: "token-set",
				mode,
				clientKey: TOKEN_SET_BACKEND_MODE_CONFIG.clientKey,
				client: await this.getBackendOidcClient(),
				transport: this.transport,
			};
		}
		return {
			kind: "token-set",
			mode,
			clientKey: TOKEN_SET_FRONTEND_MODE_CONFIG.clientKey,
			client: await this.getFrontendOidcClient(),
			transport: this.transport,
		};
	}

	dispose(): void {
		this.unsubscribeModeStore();
		this.authUser.dispose();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	private parseMode(raw: string | null): AuthContextMode | null {
		return raw === AuthContextMode.Session ||
			raw === AuthContextMode.TokenSetBackend ||
			raw === AuthContextMode.TokenSetFrontend ||
			raw === AuthContextMode.Basic
			? raw
			: null;
	}
}

export interface ProvideAuthServiceOptions {
	readonly authModeStore: AuthModeStore;
}

export function provideAuthService(
	options: ProvideAuthServiceOptions,
): readonly SecuritydeptProvider[] {
	return [
		{
			provide: AUTH_MODE_STORE,
			useValue: options.authModeStore,
		},
		...provideTokenSetTracing(),
		...provideTokenSetClientRegistry({
			createClients: (injector) => {
				injector.get(TokenSetTracingService);
				return createWebuiTokenSetClientEntries({
					environment: injector.get(ENVIRONMENT_TOKEN),
				});
			},
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
