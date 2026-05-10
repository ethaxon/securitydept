import {
	createEnvironmentInjector,
	InjectionToken,
	Injector,
	inject,
	runInInjectionContext,
} from "@angular/core";
import {
	type ActivatedRouteSnapshot,
	Router,
	type RouterStateSnapshot,
} from "@angular/router";
import { createInMemoryRecordStore } from "@securitydept/client";
import {
	ClientEnvironmentService,
	createBrowserPageClientEnvironment,
	createWebClientEnvironment,
	deriveClientEnvironment,
	type PageClientEnvironment,
	type WebClientEnvironment,
} from "@securitydept/client/web";
import { providePageClientEnvironment } from "@securitydept/client-angular";
import {
	createBackendOidcModeWebClient,
	createBackendOidcModeWebClientEnvironment,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import {
	EnsureAuthForResourceStatus,
	TokenSetAuthFlowReason,
} from "@securitydept/token-set-context-client/orchestration";
import {
	type CreateTokenSetRouteAggregationGuardOptions,
	createTokenSetOidcLoginRedirectHandler,
	createTokenSetRouteAggregationGuard,
	TokenSetAuthRegistry,
	type TokenSetAuthService,
	type TokenSetRouteUnauthenticatedContext,
} from "@securitydept/token-set-context-client-angular";
import { describe, expect, it, vi } from "vitest";

function createTransport() {
	return {
		execute: vi.fn(async () => ({
			status: 200,
			headers: {},
			body: null,
		})),
	};
}

function createScheduler() {
	return {
		setTimeout() {
			return { cancel() {} };
		},
	};
}

function createAngularPageEnvironmentService() {
	const createClientEnvironment = vi.fn(() =>
		createWebClientEnvironment({
			transport: createTransport(),
			scheduler: createScheduler(),
			clock: { now: () => Date.now() },
		}),
	);
	const createPageEnvironment = vi.fn(
		(webEnvironment: WebClientEnvironment): PageClientEnvironment =>
			createBrowserPageClientEnvironment({
				pageCapability: {
					location: {
						href: "https://app.example.com/current",
						hash: "",
						pathname: "/current",
						search: "",
					},
					history: {
						replaceState() {},
					},
				},
				...deriveClientEnvironment(webEnvironment),
			}),
	);

	return {
		service: new ClientEnvironmentService({
			createClientEnvironment,
			createPageEnvironment,
		}),
		createClientEnvironment,
		createPageEnvironment,
	};
}

async function flushMicrotasks() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createTokenSetRouteAggregationGuard", () => {
	it("passes attemptedUrl from Angular router state into unauthenticated handlers", async () => {
		const handler = vi.fn(
			(
				_failing,
				_requirement,
				context: TokenSetRouteUnauthenticatedContext,
			) => {
				return context.attemptedUrl;
			},
		);
		const plannerHost = {
			evaluate: vi.fn(async (candidates) => ({
				allAuthenticated: false,
				pendingCandidate: candidates[0],
				unauthenticatedCandidates: candidates,
			})),
		} as NonNullable<CreateTokenSetRouteAggregationGuardOptions["plannerHost"]>;
		const service = {
			isAuthenticated: vi.fn(() => false),
			restorePromise: null,
			ensureAuthForResource: vi.fn(async () => ({
				status: EnsureAuthForResourceStatus.Unauthenticated,
				snapshot: null,
				authorizationHeader: null,
				reason: TokenSetAuthFlowReason.NoSnapshot,
			})),
		} as unknown as TokenSetAuthService;
		const registry = {
			clientKeyListForRequirement: vi.fn(() => ["frontend"]),
			whenReady: vi.fn(async () => service),
			metaFor: vi.fn(() => ({
				clientKey: "frontend",
				urlPatterns: [],
				callbackPath: "/auth/token-set/callback",
				requirementKind: "frontend_oidc",
				providerFamily: "authentik",
				priority: "primary",
			})),
		} as unknown as Pick<
			TokenSetAuthRegistry,
			"clientKeyListForRequirement" | "whenReady" | "metaFor"
		>;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				{
					provide: Router,
					useValue: { parseUrl: vi.fn((url: string) => ({ url })) },
				},
			],
			Injector.NULL as never,
		);

		const guard = createTokenSetRouteAggregationGuard({
			plannerHost,
			defaultOnUnauthenticated: handler,
		});
		const route = {
			pathFromRoot: [
				{
					data: {
						authRequirements: [{ id: "frontend", kind: "frontend_oidc" }],
					},
				},
			],
			data: {
				authRequirements: [{ id: "frontend", kind: "frontend_oidc" }],
			},
		} as unknown as ActivatedRouteSnapshot;
		const state = {
			url: "/workspace/wiki?from=guard",
		} as RouterStateSnapshot;

		const result = await runInInjectionContext(injector, () =>
			guard(route, state),
		);

		expect(result).toEqual({ url: "/workspace/wiki?from=guard" });
		expect(handler).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({ id: "frontend", kind: "frontend_oidc" }),
			expect.objectContaining({
				attemptedUrl: "/workspace/wiki?from=guard",
			}),
		);
		injector.destroy();
	});

	it("OIDC redirect handlers resolve the canonical foundation page environment provider", async () => {
		const loginWithRedirect = vi.fn().mockResolvedValue(undefined);
		const { service: environmentService } =
			createAngularPageEnvironmentService();
		const registry = {
			whenReady: vi.fn(async () => ({
				client: { loginWithRedirect },
			})),
		} as unknown as Pick<TokenSetAuthRegistry, "whenReady">;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				providePageClientEnvironment({ environment: environmentService }),
			],
			Injector.NULL as never,
		);

		try {
			const pendingResult = runInInjectionContext(injector, () =>
				createTokenSetOidcLoginRedirectHandler({ clientKey: "frontend" })(
					[] as never,
					{ id: "frontend", kind: "frontend_oidc" },
					{
						route: {} as ActivatedRouteSnapshot,
						state: { url: "/workspace/wiki?from=guard" } as RouterStateSnapshot,
						attemptedUrl: "/workspace/wiki?from=guard",
					},
				),
			);
			const settled = vi.fn();
			Promise.resolve(pendingResult).then(settled, settled);

			await flushMicrotasks();
			const environment = await environmentService.resolvePageEnvironment();
			expect(loginWithRedirect).toHaveBeenCalledWith({
				environment,
				postAuthRedirectUri: "/workspace/wiki?from=guard",
			});
			expect(settled).not.toHaveBeenCalled();
		} finally {
			injector.destroy();
		}
	});

	it("OIDC redirect handlers resolve a stable DI environment without reading ambient window", async () => {
		const loginWithRedirect = vi.fn().mockResolvedValue(undefined);
		const {
			service: environmentService,
			createClientEnvironment,
			createPageEnvironment,
		} = createAngularPageEnvironmentService();
		const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		let windowRead = false;
		const registry = {
			whenReady: vi.fn(async () => ({
				client: { loginWithRedirect },
			})),
		} as unknown as Pick<TokenSetAuthRegistry, "whenReady">;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				providePageClientEnvironment({ environment: environmentService }),
			],
			Injector.NULL as never,
		);

		Object.defineProperty(globalThis, "window", {
			configurable: true,
			get() {
				windowRead = true;
				return {
					location: { href: "https://ambient.example.com" },
				};
			},
		});

		try {
			const handler = createTokenSetOidcLoginRedirectHandler({
				clientKey: "frontend",
			});
			const pendingResult = runInInjectionContext(injector, () =>
				handler(
					[] as never,
					{ id: "frontend", kind: "frontend_oidc" },
					{
						route: {} as ActivatedRouteSnapshot,
						state: { url: "/workspace/wiki?from=guard" } as RouterStateSnapshot,
						attemptedUrl: "/workspace/wiki?from=guard",
					},
				),
			);
			const settled = vi.fn();
			Promise.resolve(pendingResult).then(settled, settled);
			const secondPendingResult = runInInjectionContext(injector, () =>
				handler(
					[] as never,
					{ id: "frontend", kind: "frontend_oidc" },
					{
						route: {} as ActivatedRouteSnapshot,
						state: { url: "/workspace/wiki?from=guard" } as RouterStateSnapshot,
						attemptedUrl: "/workspace/wiki?from=guard",
					},
				),
			);
			Promise.resolve(secondPendingResult).then(settled, settled);

			await flushMicrotasks();
			const environment = await environmentService.resolvePageEnvironment();
			expect(loginWithRedirect).toHaveBeenCalledWith({
				environment,
				postAuthRedirectUri: "/workspace/wiki?from=guard",
			});
			expect(loginWithRedirect).toHaveBeenNthCalledWith(2, {
				environment,
				postAuthRedirectUri: "/workspace/wiki?from=guard",
			});
			expect(loginWithRedirect.mock.calls[0]?.[0].environment).toBe(
				environment,
			);
			expect(loginWithRedirect.mock.calls[1]?.[0].environment).toBe(
				environment,
			);
			expect(createClientEnvironment).toHaveBeenCalledTimes(1);
			expect(createPageEnvironment).toHaveBeenCalledTimes(1);
			expect(windowRead).toBe(false);
			expect(settled).not.toHaveBeenCalled();
		} finally {
			if (originalWindowDescriptor) {
				Object.defineProperty(globalThis, "window", originalWindowDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "window");
			}
			injector.destroy();
		}
	});

	it("OIDC redirect handlers also drive backend web clients through the shared redirect-login contract", async () => {
		const { service: environmentService } =
			createAngularPageEnvironmentService();
		const backendClient = createBackendOidcModeWebClient({
			environment: createBackendOidcModeWebClientEnvironment({
				persistentStore: createInMemoryRecordStore(),
				sessionStore: createInMemoryRecordStore(),
			}),
			baseUrl: "https://auth.example.com",
		});
		const loginWithRedirect = vi.spyOn(backendClient, "loginWithRedirect");
		const registry = {
			whenReady: vi.fn(async () => ({
				client: backendClient,
			})),
		} as unknown as Pick<TokenSetAuthRegistry, "whenReady">;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				providePageClientEnvironment({ environment: environmentService }),
			],
			Injector.NULL as never,
		);

		try {
			const pendingResult = runInInjectionContext(injector, () =>
				createTokenSetOidcLoginRedirectHandler({ clientKey: "backend" })(
					[] as never,
					{ id: "backend", kind: "backend_oidc" },
					{
						route: {} as ActivatedRouteSnapshot,
						state: { url: "/workspace/wiki?from=guard" } as RouterStateSnapshot,
						attemptedUrl: "/workspace/wiki?from=guard",
					},
				),
			);
			const settled = vi.fn();
			Promise.resolve(pendingResult).then(settled, settled);

			await flushMicrotasks();
			const environment = await environmentService.resolvePageEnvironment();
			expect(loginWithRedirect).toHaveBeenCalledWith({
				environment,
				postAuthRedirectUri: "/workspace/wiki?from=guard",
			});
			expect(environment.location.href).toBe(
				"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=%2Fworkspace%2Fwiki%3Ffrom%3Dguard",
			);
			expect(settled).not.toHaveBeenCalled();
		} finally {
			injector.destroy();
			backendClient.dispose();
		}
	});

	it("OIDC redirect handlers fail fast when the registered client lacks shared redirect-login capability", async () => {
		const { service: environmentService } =
			createAngularPageEnvironmentService();
		const registry = {
			whenReady: vi.fn(async () => ({
				client: {},
			})),
		} as unknown as Pick<TokenSetAuthRegistry, "whenReady">;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				providePageClientEnvironment({ environment: environmentService }),
			],
			Injector.NULL as never,
		);

		try {
			await expect(
				runInInjectionContext(injector, () =>
					createTokenSetOidcLoginRedirectHandler({ clientKey: "frontend" })(
						[] as never,
						{ id: "frontend", kind: "frontend_oidc" },
						{
							route: {} as ActivatedRouteSnapshot,
							state: {
								url: "/workspace/wiki?from=guard",
							} as RouterStateSnapshot,
							attemptedUrl: "/workspace/wiki?from=guard",
						},
					),
				),
			).rejects.toThrow(
				/createTokenSetOidcLoginRedirectHandler.*client key "frontend".*OidcRedirectLoginClient\.loginWithRedirect/,
			);
		} finally {
			injector.destroy();
		}
	});

	it("OIDC redirect handlers can resolve the environment through an Angular inject()-based provider without NG0203", async () => {
		const TEST_PAGE_ENVIRONMENT_SERVICE =
			new InjectionToken<ClientEnvironmentService>(
				"TEST_PAGE_ENVIRONMENT_SERVICE",
			);
		const loginWithRedirect = vi.fn().mockResolvedValue(undefined);
		const { service: environmentService } =
			createAngularPageEnvironmentService();
		const registry = {
			whenReady: vi.fn(async () => ({
				client: { loginWithRedirect },
			})),
		} as unknown as Pick<TokenSetAuthRegistry, "whenReady">;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				{
					provide: TEST_PAGE_ENVIRONMENT_SERVICE,
					useValue: environmentService,
				},
				providePageClientEnvironment({
					environment: () =>
						inject(TEST_PAGE_ENVIRONMENT_SERVICE).resolvePageEnvironment(),
				}),
			],
			Injector.NULL as never,
		);

		try {
			const pendingResult = runInInjectionContext(injector, () =>
				createTokenSetOidcLoginRedirectHandler({ clientKey: "frontend" })(
					[] as never,
					{ id: "frontend", kind: "frontend_oidc" },
					{
						route: {} as ActivatedRouteSnapshot,
						state: { url: "/workspace/wiki?from=guard" } as RouterStateSnapshot,
						attemptedUrl: "/workspace/wiki?from=guard",
					},
				),
			);

			await flushMicrotasks();
			const environment = await environmentService.resolvePageEnvironment();
			expect(loginWithRedirect).toHaveBeenCalledWith({
				environment,
				postAuthRedirectUri: "/workspace/wiki?from=guard",
			});
			await expect(
				Promise.race([pendingResult, Promise.resolve("pending")]),
			).resolves.toBe("pending");
		} finally {
			injector.destroy();
		}
	});
});
