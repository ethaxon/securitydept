import {
	createEnvironmentInjector,
	Injector,
	runInInjectionContext,
} from "@angular/core";
import {
	type ActivatedRouteSnapshot,
	Router,
	type RouterStateSnapshot,
} from "@angular/router";
import {
	type AuthGuardClientOption,
	createEventSubject,
	createInMemoryRecordStore,
	createReplaySignal,
	createRootSpan,
	createSignal,
	createTracing,
} from "@securitydept/client";
import { type NativeWebEnvironment } from "@securitydept/client/web";
import { provideNativeWebEnvironment } from "@securitydept/client-angular";
import {
	createBackendOidcModeWebClient,
	createBackendOidcModeWebClientEnvironment,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import {
	type CreateTokenSetRouteAggregationGuardOptions,
	createTokenSetOidcLoginRedirectHandler,
	createTokenSetRouteAggregationGuard,
	type TokenSetAngularClient,
	TokenSetAuthRegistry,
	type TokenSetRouteUnauthenticatedContext,
} from "@securitydept/token-set-context-client-angular";
import { describe, expect, it, vi } from "vitest";
import { createEnvironmentForNativeWebTest } from "../../../../client/src/test";

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

function createAngularPageEnvironment(): NativeWebEnvironment {
	const location = {
		href: "https://app.example.com/current",
		hash: "",
		pathname: "/current",
		search: "",
	};

	return createEnvironmentForNativeWebTest({
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
			evaluate: vi.fn(async (candidates: AuthGuardClientOption[]) => {
				const unauthenticated = candidates.filter(
					(candidate) => !candidate.checkAuthenticated(),
				);
				return {
					allAuthenticated: unauthenticated.length === 0,
					pendingCandidate: unauthenticated[0] ?? null,
					unauthenticatedCandidates: unauthenticated,
				};
			}),
		} as NonNullable<CreateTokenSetRouteAggregationGuardOptions["plannerHost"]>;
		const isAuthenticated = createReplaySignal<boolean>();
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
		} as unknown as TokenSetAngularClient;
		const registry = {
			clientKeyListForRequirement: vi.fn(() => ["frontend"]),
			whenReady: vi.fn(async () => client),
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
		const environment = createAngularPageEnvironment();
		const registry = {
			whenReady: vi.fn(async () => ({ loginWithRedirect })),
		} as unknown as Pick<TokenSetAuthRegistry, "whenReady">;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				provideNativeWebEnvironment({ environment }),
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
			expect(loginWithRedirect).toHaveBeenCalledWith({
				environment: environment.router,
				postAuthRedirectUri: "/workspace/wiki?from=guard",
			});
			expect(settled).not.toHaveBeenCalled();
		} finally {
			injector.destroy();
		}
	});

	it("OIDC redirect handlers resolve a stable DI environment without reading ambient window", async () => {
		const loginWithRedirect = vi.fn().mockResolvedValue(undefined);
		const environment = createAngularPageEnvironment();
		const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		let windowRead = false;
		const registry = {
			whenReady: vi.fn(async () => ({ loginWithRedirect })),
		} as unknown as Pick<TokenSetAuthRegistry, "whenReady">;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				provideNativeWebEnvironment({ environment }),
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
			expect(loginWithRedirect).toHaveBeenCalledWith({
				environment: environment.router,
				postAuthRedirectUri: "/workspace/wiki?from=guard",
			});
			expect(loginWithRedirect).toHaveBeenNthCalledWith(2, {
				environment: environment.router,
				postAuthRedirectUri: "/workspace/wiki?from=guard",
			});
			expect(loginWithRedirect.mock.calls[0]?.[0].environment).toBe(
				environment.router,
			);
			expect(loginWithRedirect.mock.calls[1]?.[0].environment).toBe(
				environment.router,
			);
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
		const environment = createAngularPageEnvironment();
		const backendClient = createBackendOidcModeWebClient({
			environment: createBackendOidcModeWebClientEnvironment({
				persistentStorage: createInMemoryRecordStore(),
				sessionStorage: createInMemoryRecordStore(),
				span: createRootSpan(),
				tracing: createTracing(),
			}),
			baseUrl: "https://auth.example.com",
		});
		const loginWithRedirect = vi.spyOn(backendClient, "loginWithRedirect");
		const registry = {
			whenReady: vi.fn(async () => backendClient),
		} as unknown as Pick<TokenSetAuthRegistry, "whenReady">;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				provideNativeWebEnvironment({ environment }),
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
			expect(loginWithRedirect).toHaveBeenCalledWith({
				environment: environment.router,
				postAuthRedirectUri: "/workspace/wiki?from=guard",
			});
			expect(environment.router.currentUrl()?.toString()).toBe(
				"https://auth.example.com/auth/oidc/login?post_auth_redirect_uri=%2Fworkspace%2Fwiki%3Ffrom%3Dguard",
			);
			expect(settled).not.toHaveBeenCalled();
		} finally {
			injector.destroy();
			backendClient.dispose();
		}
	});

	it("OIDC redirect handlers fail fast when the registered client lacks shared redirect-login capability", async () => {
		const environment = createAngularPageEnvironment();
		const registry = {
			whenReady: vi.fn(async () => ({})),
		} as unknown as Pick<TokenSetAuthRegistry, "whenReady">;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				provideNativeWebEnvironment({ environment }),
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
});
