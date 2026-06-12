import { HttpClient, HttpResponse } from "@angular/common/http";
import {
	createEnvironmentInjector,
	type EnvironmentInjector,
	Injector,
	runInInjectionContext,
} from "@angular/core";
import {
	type ActivatedRouteSnapshot,
	Router,
	type RouterStateSnapshot,
} from "@angular/router";
import {
	createEventSubject,
	createSignal,
	ResourceStatus,
	readSecuritydeptRouteMetadata,
	resourceFromSnapshots,
	type SecuritydeptProvider,
	writeSecuritydeptRouteMetadata,
} from "@securitydept/client";
import {
	createEnvironmentForNativeWeb,
	type NativeWebEnvironment,
} from "@securitydept/client/web";
import { provideEnvironment } from "@securitydept/client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientReadyRecordView,
	TokenSetClientRegistryAuthRequirement,
} from "@securitydept/token-set-context-client/registry";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { provideTokenSetRequirementPlannerHost } from "../auth-coordination/planner-host";
import {
	createTokenSetCanActivate,
	secureTokenSetRoute,
	secureTokenSetRouteRoot,
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
	options: { providers?: readonly SecuritydeptProvider[] } = {},
): NativeWebEnvironment {
	const location = {
		href: "https://app.example.com/current",
		hash: "",
		pathname: "/current",
		search: "",
	};

	return createEnvironmentForNativeWeb({
		...options,
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
): TokenSetClientReadyRecordView<BaseOidcModeClient> {
	const meta = {
		clientKey,
		urlPatterns: [],
		callbackUrl: "/auth/token-set/callback",
		requirementKind: "frontend_oidc",
		providerFamily: "authentik",
		initialization: TokenSetClientInitializationMode.Immediate,
	};
	return {
		id: clientKey,
		entry: {
			clientFactory: () => client,
			meta,
		},
		meta,
		status: ResourceStatus.Resolved,
		client,
	};
}

function createRouterProvider() {
	return {
		provide: Router,
		useValue: {
			url: "/current",
			navigateByUrl: vi.fn(async () => true),
			parseUrl: vi.fn((url: string) => ({ url })),
			serializeUrl: (tree: unknown) => String(tree),
			getCurrentNavigation: () => ({
				finalUrl: { toString: () => "/workspace/wiki?from=guard" },
			}),
		},
	};
}

function createHttpClientProvider() {
	return {
		provide: HttpClient,
		useValue: {
			request: vi.fn(() => of(new HttpResponse({ status: 200 }))),
		},
	};
}

describe("provideTokenSetRequirementPlannerHost + createTokenSetCanActivate", () => {
	it("passes Angular injector access through the planner environment", async () => {
		const handler = vi.fn((_requirement, context, _clients) => {
			const router = context.environment.injector.get(Injector).get(Router);
			return router.serializeUrl(router.getCurrentNavigation()?.finalUrl);
		});
		const isAuthenticatedSnapshot = createSignal({
			status: ResourceStatus.Resolved,
			value: false,
		} as const);
		const isAuthenticated = resourceFromSnapshots(() =>
			isAuthenticatedSnapshot.get(),
		);
		const authSnapshot = createSignal({
			status: ResourceStatus.Resolved,
			value: null,
		} as const);
		const authResource = resourceFromSnapshots(() => authSnapshot.get());
		const authorizationSnapshot = createSignal({
			status: ResourceStatus.Resolved,
			value: undefined as string | undefined,
		} as const);
		const authorizationHeaderValue = resourceFromSnapshots(() =>
			authorizationSnapshot.get(),
		);
		const client = {
			state: createSignal(null),
			authSnapshot,
			authResource,
			isAuthenticated,
			authorizationHeaderValue,
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
			clientRecordFor: vi.fn(async () => readyRecord),
		} as unknown as TokenSetClientRegistryService;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetClientRegistryService, useValue: registry },
				createRouterProvider(),
				createHttpClientProvider(),
				provideEnvironment({
					createBaseEnvironment: createAngularPageEnvironment,
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

	it("starts OIDC redirect login for unauthenticated clients by default", async () => {
		const loginWithRedirect = vi.fn().mockResolvedValue(undefined);
		const client = {
			isAuthenticated: { whenValue: vi.fn(async () => false) },
			loginWithRedirect,
			dispose: vi.fn(),
		} as unknown as BaseOidcModeClient;
		const record = createReadyRecord("frontend", client);
		const registry = {
			clientRecordGenForQuery: vi.fn(function* () {
				yield createSignal(record);
			}),
			clientRecordFor: vi.fn(async () => record),
		} as unknown as TokenSetClientRegistryService;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetClientRegistryService, useValue: registry },
				createRouterProvider(),
				createHttpClientProvider(),
				provideEnvironment({
					createBaseEnvironment: createAngularPageEnvironment,
				}),
				provideTokenSetRequirementPlannerHost(),
			],
			Injector.NULL as never,
		);

		try {
			const guard = createTokenSetCanActivate();
			const routeMetadata = writeSecuritydeptRouteMetadata(undefined, {
				requirements: [
					{
						id: "frontend",
						attributes: { query: { clientKey: "frontend" } },
					},
				],
			});
			const route = {
				pathFromRoot: [{ data: routeMetadata }],
				data: routeMetadata,
			} as unknown as ActivatedRouteSnapshot;
			const pendingResult = runInInjectionContext(injector, () =>
				guard(route, {
					url: "/workspace/wiki?from=guard",
				} as RouterStateSnapshot),
			);
			const settled = vi.fn();
			Promise.resolve(pendingResult).then(settled, settled);

			await flushMicrotasks();
			expect(loginWithRedirect).toHaveBeenCalledWith({
				postAuthRedirectUri: "/workspace/wiki?from=guard",
			});
			expect(settled).not.toHaveBeenCalled();
		} finally {
			injector.destroy();
		}
	});

	it("secure route helpers write query-based registry requirements", () => {
		const frontendRequirement = TokenSetClientRegistryAuthRequirement.create({
			id: "frontend",
			label: "Frontend",
			query: { requirementKind: "frontend_oidc" },
		});
		const rootRequirement = TokenSetClientRegistryAuthRequirement.create({
			query: { clientKey: "frontend" },
		});
		const child = secureTokenSetRoute("child", {
			requirements: [frontendRequirement],
		});
		const root = secureTokenSetRouteRoot("root", {
			requirements: [rootRequirement],
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
