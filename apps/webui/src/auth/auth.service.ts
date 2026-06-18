import {
	BASIC_AUTH_CONTEXT_CLIENT,
	type BasicAuthContextClient,
} from "@securitydept/basic-auth-context-client";
import {
	type AuthRequirement,
	type BaseTransportTrait,
	ClientError,
	ClientErrorKind,
	createComputed,
	type DisposableTrait,
	ENVIRONMENT_TOKEN,
	type EventStreamTrait,
	type FoundationEnvironment,
	flattenResourceSnapshot,
	INJECTOR_TOKEN,
	REQUIREMENT_PLANNER_HOST,
	type RequirementBehaviourWithRouteContext,
	RequirementPlannerHost,
	type ResourceSnapshot,
	ResourceStatus,
	type ResourceTrait,
	resourceFromSnapshots,
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	type SecuritydeptInjector,
	type SecuritydeptProvider,
	SYMBOL_DISPOSE,
	UserRecovery,
} from "@securitydept/client";
import { RxStateSignal } from "@securitydept/client/rx";
import {
	SESSION_CONTEXT_CLIENT,
	type SessionContextClient,
} from "@securitydept/session-context-client";
import { type BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { type FrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	type TokenSetClientRegistry,
} from "@securitydept/token-set-context-client/registry";
import { filter, from, take, takeUntil } from "rxjs";
import {
	TOKEN_SET_BACKEND_MODE_CONFIG,
	TOKEN_SET_FRONTEND_MODE_CONFIG,
} from "@/auth/token-set/config";
import { projectDashboardUser } from "@/dashboard/principal";
import { type AuthModeStore, createAuthModeStore } from "./mode-store";
import {
	AuthContextMode,
	type AuthLoginOptions,
	type DashboardAccess,
	type WebuiAuthUser,
	WebuiAuthUserKind,
} from "./model";

const SESSION_POST_AUTH_REDIRECT_PARAM = "post_auth_redirect_uri";

interface DashboardAuthRequirement extends AuthRequirement {
	readonly kind: "dashboard";
}

function createLoginPath(postAuthRedirectUri?: string): string {
	if (!postAuthRedirectUri) {
		return "/login";
	}
	const search = new URLSearchParams({
		[SESSION_POST_AUTH_REDIRECT_PARAM]: postAuthRedirectUri,
	});
	return `/login?${search.toString()}`;
}

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

export class AuthService implements DisposableTrait {
	private readonly session: SessionContextClient;
	private readonly basic: BasicAuthContextClient;
	private readonly registry: TokenSetClientRegistry;
	private readonly modeStore: AuthModeStore;
	private readonly _destroyed = RxStateSignal.fromInitialValue(false);
	private readonly destroyed$ = from(this._destroyed).pipe(
		filter((value): value is true => value),
		take(1),
	);
	private readonly tokenSetBackendModeClientResource: ResourceTrait<BaseOidcModeClient>;
	private readonly tokenSetFrontendModeClientResource: ResourceTrait<BaseOidcModeClient>;
	readonly authUser: ResourceTrait<WebuiAuthUser>;
	readonly mode: ResourceTrait<AuthContextMode | null>;
	readonly modeErrors: EventStreamTrait<ClientError>;
	readonly environment: FoundationEnvironment;

	get transport(): BaseTransportTrait {
		return this.environment.transport;
	}

	constructor(injector: SecuritydeptInjector) {
		this.session = injector.get(SESSION_CONTEXT_CLIENT);
		this.basic = injector.get(BASIC_AUTH_CONTEXT_CLIENT);
		this.registry = injector.get(TOKEN_SET_CLIENT_REGISTRY);
		this.environment = injector.get(ENVIRONMENT_TOKEN);
		this.modeStore = createAuthModeStore({
			persistentStorage: this.environment.persistentStorage,
		});
		this.mode = this.modeStore.mode;
		this.modeErrors = this.modeStore.errors;
		this.tokenSetBackendModeClientResource = this.registry.clientResourceFor(
			TOKEN_SET_BACKEND_MODE_CONFIG.clientKey,
			{ initialize: false },
		);
		this.tokenSetFrontendModeClientResource = this.registry.clientResourceFor(
			TOKEN_SET_FRONTEND_MODE_CONFIG.clientKey,
			{ initialize: false },
		);
		from(this.mode)
			.pipe(takeUntil(this.destroyed$))
			.subscribe((snapshot) => {
				if (snapshot.status !== ResourceStatus.Resolved) {
					return;
				}
				if (snapshot.value === AuthContextMode.TokenSetBackend) {
					this.registry.clientResourceFor(
						TOKEN_SET_BACKEND_MODE_CONFIG.clientKey,
					);
				} else if (snapshot.value === AuthContextMode.TokenSetFrontend) {
					this.registry.clientResourceFor(
						TOKEN_SET_FRONTEND_MODE_CONFIG.clientKey,
					);
				}
			});

		const authUserSnapshot = createComputed<ResourceSnapshot<WebuiAuthUser>>(
			() => {
				const modeSnapshot = this.mode.snapshot.get();
				if (modeSnapshot.status !== ResourceStatus.Resolved) {
					return mapAuthUserSnapshot(modeSnapshot, () => null);
				}
				const mode = modeSnapshot.value;
				if (mode === null) {
					return { status: ResourceStatus.Resolved, value: null };
				}
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
				const type =
					mode === AuthContextMode.TokenSetBackend
						? WebuiAuthUserKind.TokenSetBackendOidcMode
						: WebuiAuthUserKind.TokenSetFrontendOidcMode;
				const contextLabel =
					mode === AuthContextMode.TokenSetBackend
						? "Token Set Backend Mode"
						: "Token Set Frontend Mode";
				return mapAuthUserSnapshot(
					flattenResourceSnapshot(
						clientSnapshot,
						(client) => client.authSnapshot,
					),
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
		injector.get(SecuritydeptDestroyRef, null)?.onDestroy(() => this.dispose());
	}

	setMode(mode: AuthContextMode): void {
		this.modeStore.set(mode);
	}

	clearMode(): void {
		this.modeStore.clear();
	}

	async ensureAuthenticatedForRoute(_url: string): Promise<boolean> {
		const mode = await this.mode.whenValue();
		if (mode === null) {
			return false;
		}
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
		const mode = await this.mode.whenValue();
		try {
			if (mode === null) {
				return;
			}
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
		const mode = await this.mode.whenValue();
		if (mode === null) {
			throw new ClientError({
				kind: ClientErrorKind.Unauthenticated,
				code: "webui.auth_mode.not_selected",
				message: "An authentication mode must be selected before API access",
				source: "webui.auth_service",
				recovery: UserRecovery.Reauthenticate,
			});
		}
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
		this._destroyed.set(true);
		this.authUser.dispose();
		this.modeStore.dispose();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}

export function provideAuthService(): readonly SecuritydeptProvider[] {
	return [
		{
			provide: AUTH_SERVICE,
			useFactory: (injector: SecuritydeptInjector) => new AuthService(injector),
			deps: [INJECTOR_TOKEN],
		},
		{
			provide: REQUIREMENT_PLANNER_HOST,
			useFactory: (
				authService: AuthService,
				environment: FoundationEnvironment,
			) =>
				RequirementPlannerHost.fromBehaviour<
					Partial<
						RequirementBehaviourWithRouteContext<DashboardAuthRequirement>
					>
				>(
					{
						checkAuthenticated: (requirement, context) =>
							requirement.kind === "dashboard" &&
							authService.ensureAuthenticatedForRoute(
								context.planContext.routeState.url,
							),
						onUnauthenticated: (_requirement, context) =>
							createLoginPath(context.planContext.routeState.url),
					},
					{ environment },
				),
			deps: [AUTH_SERVICE, ENVIRONMENT_TOKEN],
		},
	];
}
