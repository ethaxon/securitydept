import {
	createEnvironmentInjector,
	type EnvironmentInjector,
	Injector,
	inject,
	runInInjectionContext,
} from "@angular/core";
import {
	type ActivatedRouteSnapshot,
	Router,
	type RouterStateSnapshot,
} from "@angular/router";
import {
	createEventSubject,
	createReplaySignal,
	createSignal,
	readSecuritydeptRouteMetadata,
	type SecuritydeptProvider,
	writeSecuritydeptRouteMetadata,
} from "@securitydept/client";
import { type NativeWebEnvironment } from "@securitydept/client/web";
import { ENVIRONMENT, provideEnvironment } from "@securitydept/client-angular";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	ClientInitializationMode,
	type ClientReadyRecordView,
	ClientRegistryAuthRequirement,
	ClientRegistryEntryStatus,
} from "@securitydept/token-set-context-client/registry";
import { describe, expect, it, vi } from "vitest";
import { createEnvironmentForNativeWebTest } from "../../../../client/src/test";
import {
	createTokenSetOidcLoginRedirectHandler,
	provideTokenSetRequirementPlannerHost,
} from "../auth-coordination/planner-host";
import {
	createTokenSetCanActivate,
	secureRoute,
	secureRouteRoot,
} from "../auth-coordination/secure-routes";
import { TokenSetClientRegistryService } from "../client-registry.service";

function createTransport() {
	return {
		execute: vi.fn(async () => ({
			status: 200,
			headers: {},
			body: null,
		})),
	};
}

function createTime() {
	return {
		now: () => Date.now(),
		setTimeout: (callback: () => void, delayMs: number) =>
			globalThis.setTimeout(callback, delayMs),
		clearTimeout: (handle: unknown) =>
			globalThis.clearTimeout(
				handle as ReturnType<typeof globalThis.setTimeout>,
			),
	};
}

function createAngularPageEnvironment(
	providers: readonly SecuritydeptProvider[] = [],
): NativeWebEnvironment {
	const location = {
		href: "https://app.example.com/current",
		hash: "",
		pathname: "/current",
		search: "",
	};

	return createEnvironmentForNativeWebTest({
		providers,
		transport: createTransport(),
		time: createTime(),
		routerForNativeWebCreateOptions: {
			location,
			history: {
				pushState(_data: unknown, _unused: string, url?: string | URL | null) {
					if (url) {
						location.href = new URL(url, location.href).toString();
					}
				},
				replaceState(
					_data: unknown,
					_unused: string,
					url?: string | URL | null,
				) {
					if (url) {
						location.href = new URL(url, location.href).toString();
					}
				},
			},
		},
	});
}

async function flushMicrotasks() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function createReadyRecord(
	clientKey: string,
	client: BaseOidcModeClient,
): ClientReadyRecordView<BaseOidcModeClient> {
	const meta = {
		clientKey,
		urlPatterns: [],
		callbackPath: "/auth/token-set/callback",
		requirementKind: "frontend_oidc",
		providerFamily: "authentik",
		initialization: ClientInitializationMode.Immediate,
	};
	return {
		id: clientKey,
		entry: {
			clientFactory: () => client,
			meta,
		},
		meta,
		status: ClientRegistryEntryStatus.Ready,
		client,
	};
}

async function* createClientGenerator(
	...records: ClientReadyRecordView<BaseOidcModeClient>[]
): AsyncGenerator<ClientReadyRecordView<BaseOidcModeClient>, void, unknown> {
	yield* records;
}

function createRequirement(clientKey: string): ClientRegistryAuthRequirement {
	return {
		id: clientKey,
		attributes: {
			query: { clientKey },
		},
	};
}

function createRouterProvider() {
	return {
		provide: Router,
		useValue: {
			url: "/current",
			parseUrl: vi.fn((url: string) => ({ url })),
			serializeUrl: (tree: unknown) => String(tree),
			getCurrentNavigation: () => ({
				finalUrl: { toString: () => "/workspace/wiki?from=guard" },
			}),
		},
	};
}

describe("provideTokenSetRequirementPlannerHost + createTokenSetCanActivate", () => {
	it("passes Angular injector access through the planner environment", async () => {
		const handler = vi.fn((_requirement, context, _clients) => {
			const router = context.environment.injector.get(Injector).get(Router);
			return router.serializeUrl(router.getCurrentNavigation()?.finalUrl);
		});
		const isAuthenticated = createReplaySignal<boolean>();
		isAuthenticated.setValue(false);
		const authDetermined = createReplaySignal<true>();
		authDetermined.setValue(true);
		const authSnapshot = createReplaySignal<null>();
		authSnapshot.setValue(null);
		const authorizationHeaderValue = createReplaySignal<string | undefined>();
		authorizationHeaderValue.setValue(undefined);
		const lastAuthError = createSignal<unknown | undefined>(undefined);
		const client = {
			state: createSignal(null),
			authDetermined,
			authSnapshot,
			isAuthenticated,
			authorizationHeaderValue,
			lastAuthError,
			authOperations: {
				restorePending: createSignal(false),
				refreshPending: createSignal(false),
				clearPending: createSignal(false),
				loginPending: createSignal(false),
			},
			authEvents: createEventSubject(),
			addWorkflowSource: vi.fn(() => ({ unsubscribe: vi.fn() })),
			removeWorkflowSource: vi.fn(() => false),
			start: vi.fn(async () => undefined),
			dispose: vi.fn(),
			restorePersistedState: vi.fn(async () => null),
			handleCallback: vi.fn(),
			loginWithRedirect: vi.fn(),
		} as unknown as BaseOidcModeClient;
		const readyRecord = createReadyRecord("frontend", client);
		const registry = {
			clientRecordGenForQuery: vi.fn(function* () {
				yield createSignal(readyRecord);
			}),
			initialize: vi.fn(async () => readyRecord),
		} as unknown as TokenSetClientRegistryService;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetClientRegistryService, useValue: registry },
				createRouterProvider(),
				provideEnvironment({
					environment: (ngProviders) =>
						createAngularPageEnvironment(ngProviders),
				}),
				provideTokenSetRequirementPlannerHost({
					onClientUnauthenticated: handler,
				}),
			],
			Injector.NULL as unknown as EnvironmentInjector,
		);

		const guard = createTokenSetCanActivate();
		const routeMetadata = writeSecuritydeptRouteMetadata(undefined, {
			requirements: [
				{
					id: "frontend",
					attributes: { query: { requirementKind: "frontend_oidc" } },
				},
			],
		});
		const route = {
			pathFromRoot: [
				{
					data: routeMetadata,
				},
			],
			data: routeMetadata,
		} as unknown as ActivatedRouteSnapshot;
		const state = {
			url: "/workspace/wiki?from=guard",
		} as RouterStateSnapshot;

		const result = await runInInjectionContext(injector, () =>
			guard(route, state),
		);

		expect(result).toEqual({ url: "/workspace/wiki?from=guard" });
		expect(registry.clientRecordGenForQuery).toHaveBeenCalledWith({
			requirementKind: "frontend_oidc",
		});
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({ id: "frontend" }),
			expect.objectContaining({
				planContext: {
					routeState: {
						url: "/workspace/wiki?from=guard",
					},
				},
				requirements: expect.any(Array),
				resolutionList: expect.any(Array),
			}),
			expect.objectContaining({ next: expect.any(Function) }),
		);
		injector.destroy();
	});

	it("OIDC redirect handlers resolve the canonical foundation page environment provider", async () => {
		const loginWithRedirect = vi.fn().mockResolvedValue(undefined);
		const client = {
			isAuthenticated: { whenValue: vi.fn(async () => false) },
			loginWithRedirect,
			dispose: vi.fn(),
		} as unknown as BaseOidcModeClient;
		const record = createReadyRecord("frontend", client);
		const injector = createEnvironmentInjector(
			[
				createRouterProvider(),
				provideEnvironment({
					environment: (ngProviders) =>
						createAngularPageEnvironment(ngProviders),
				}),
			],
			Injector.NULL as never,
		);

		try {
			const environment = runInInjectionContext(injector, () =>
				inject(ENVIRONMENT),
			);
			const pendingResult = createTokenSetOidcLoginRedirectHandler({
				clientKey: "frontend",
			})(
				createRequirement("frontend"),
				{ environment, requirements: [], resolutionList: [] },
				createClientGenerator(record),
			);
			const settled = vi.fn();
			Promise.resolve(pendingResult).then(settled, settled);

			await flushMicrotasks();
			expect(loginWithRedirect).toHaveBeenCalledWith({
				postAuthRedirectUri: "https://app.example.com/current",
			});
			expect(settled).not.toHaveBeenCalled();
		} finally {
			injector.destroy();
		}
	});

	it("OIDC redirect handlers also drive backend web clients through the shared redirect-login contract", async () => {
		let environment: NativeWebEnvironment | undefined;
		let backendClient: BackendOidcModeClient | undefined;
		let record: ClientReadyRecordView<BaseOidcModeClient> | undefined;
		let loginWithRedirect: ReturnType<typeof vi.spyOn> | undefined;
		async function* backendRecordGenerator() {
			if (!record) {
				throw new Error("Backend record was not initialized.");
			}
			yield record;
		}
		const injector = createEnvironmentInjector(
			[
				createRouterProvider(),
				provideEnvironment({
					environment: (ngProviders) => {
						environment = createAngularPageEnvironment(ngProviders);
						backendClient = new BackendOidcModeClient(
							{ baseUrl: "https://auth.example.com" },
							environment,
						);
						loginWithRedirect = vi.spyOn(backendClient, "loginWithRedirect");
						record = createReadyRecord("backend", backendClient);
						return environment;
					},
				}),
			],
			Injector.NULL as never,
		);

		try {
			const resolvedEnvironment = runInInjectionContext(injector, () =>
				inject(ENVIRONMENT),
			);
			const pendingResult = createTokenSetOidcLoginRedirectHandler({
				clientKey: "backend",
			})(
				createRequirement("backend"),
				{
					environment: resolvedEnvironment,
					requirements: [],
					resolutionList: [],
				},
				backendRecordGenerator(),
			);
			const settled = vi.fn();
			Promise.resolve(pendingResult).then(settled, settled);

			await flushMicrotasks();
			expect(loginWithRedirect).toHaveBeenCalledWith({
				postAuthRedirectUri: "https://app.example.com/current",
			});
			expect(environment?.router.currentUrl()?.toString()).toBe(
				"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fcurrent",
			);
			expect(settled).not.toHaveBeenCalled();
		} finally {
			injector.destroy();
			backendClient?.dispose();
		}
	});

	it("secure route helpers write query-based registry requirements", () => {
		const frontendRequirement = ClientRegistryAuthRequirement.create({
			id: "frontend",
			label: "Frontend",
			query: { requirementKind: "frontend_oidc" },
		});
		const rootRequirement = ClientRegistryAuthRequirement.create({
			query: { clientKey: "frontend" },
		});
		const child = secureRoute("child", {
			requirements: [frontendRequirement],
		});
		const root = secureRouteRoot("root", {
			requirements: [rootRequirement],
			onClientUnauthenticated: createTokenSetOidcLoginRedirectHandler({
				clientKey: "frontend",
			}),
		});

		expect(readSecuritydeptRouteMetadata(child.data)?.requirements).toEqual([
			expect.objectContaining({
				id: "frontend",
				label: "Frontend",
				attributes: { query: { requirementKind: "frontend_oidc" } },
			}),
		]);
		expect(readSecuritydeptRouteMetadata(root.data)?.requirements).toEqual([
			expect.objectContaining({
				attributes: { query: { clientKey: "frontend" } },
			}),
		]);
		expect(root.providers).toBeDefined();
	});
});
