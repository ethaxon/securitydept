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
	createReplaySignal,
	createSignal,
	writeSecuritydeptRouteMetadata,
} from "@securitydept/client";
import { type NativeWebEnvironment } from "@securitydept/client/web";
import { provideEnvironment } from "@securitydept/client-angular";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	createTokenSetCanActivate,
	createTokenSetOidcLoginRedirectHandler,
	provideTokenSetRequirementPlannerHost,
	type TokenSetAngularClient,
	TokenSetAuthRegistry,
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

describe("provideTokenSetRequirementPlannerHost + createTokenSetCanActivate", () => {
	it("passes the attempted navigation URL into unauthenticated handlers", async () => {
		const handler = vi.fn((_failing, _requirement, context) => {
			return context.attemptedUrl;
		});
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
			clientRecordGenForQuery: vi.fn(function* () {
				yield createSignal({
					meta: {
						clientKey: "frontend",
						urlPatterns: [],
						callbackPath: "/auth/token-set/callback",
						requirementKind: "frontend_oidc",
						providerFamily: "authentik",
						initialization: "immediate",
					},
				});
			}),
			initialize: vi.fn(async () => client),
			clientRecordOptionFor: vi.fn(),
		} as unknown as TokenSetAuthRegistry;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				{
					provide: Router,
					useValue: {
						url: "/current",
						parseUrl: vi.fn((url: string) => ({ url })),
						serializeUrl: (tree: unknown) => String(tree),
						getCurrentNavigation: () => ({
							finalUrl: { toString: () => "/workspace/wiki?from=guard" },
						}),
					},
				},
				provideTokenSetRequirementPlannerHost({
					defaultOnUnauthenticated: handler,
				}),
			],
			Injector.NULL as unknown as EnvironmentInjector,
		);

		const guard = createTokenSetCanActivate();
		const routeMetadata = writeSecuritydeptRouteMetadata(undefined, {
			requirements: [
				{
					id: "frontend",
					attributes: { requirementKind: "frontend_oidc" },
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
		expect(handler).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({ id: "frontend" }),
			expect.objectContaining({ attemptedUrl: "/workspace/wiki?from=guard" }),
		);
		injector.destroy();
	});

	it("OIDC redirect handlers resolve the canonical foundation page environment provider", async () => {
		const loginWithRedirect = vi.fn().mockResolvedValue(undefined);
		const environment = createAngularPageEnvironment();
		const registry = {
			initialize: vi.fn(async () => ({ loginWithRedirect })),
		} as unknown as Pick<TokenSetAuthRegistry, "initialize">;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				provideEnvironment({ environment }),
			],
			Injector.NULL as never,
		);

		try {
			const pendingResult = runInInjectionContext(injector, () =>
				createTokenSetOidcLoginRedirectHandler({ clientKey: "frontend" })(
					[] as never,
					{ id: "frontend", attributes: { requirementKind: "frontend_oidc" } },
					{ attemptedUrl: "/workspace/wiki?from=guard" },
				),
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

	it("OIDC redirect handlers also drive backend web clients through the shared redirect-login contract", async () => {
		const environment = createAngularPageEnvironment();
		const backendClient = new BackendOidcModeClient(
			{ baseUrl: "https://auth.example.com" },
			environment,
		);
		const loginWithRedirect = vi.spyOn(backendClient, "loginWithRedirect");
		const registry = {
			initialize: vi.fn(async () => backendClient),
		} as unknown as Pick<TokenSetAuthRegistry, "initialize">;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				provideEnvironment({ environment }),
			],
			Injector.NULL as never,
		);

		try {
			const pendingResult = runInInjectionContext(injector, () =>
				createTokenSetOidcLoginRedirectHandler({ clientKey: "backend" })(
					[] as never,
					{ id: "backend", attributes: { requirementKind: "backend_oidc" } },
					{ attemptedUrl: "/workspace/wiki?from=guard" },
				),
			);
			const settled = vi.fn();
			Promise.resolve(pendingResult).then(settled, settled);

			await flushMicrotasks();
			expect(loginWithRedirect).toHaveBeenCalledWith({
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
			initialize: vi.fn(async () => ({})),
		} as unknown as Pick<TokenSetAuthRegistry, "initialize">;
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				provideEnvironment({ environment }),
			],
			Injector.NULL as never,
		);

		try {
			await expect(
				runInInjectionContext(injector, () =>
					createTokenSetOidcLoginRedirectHandler({ clientKey: "frontend" })(
						[] as never,
						{
							id: "frontend",
							attributes: { requirementKind: "frontend_oidc" },
						},
						{ attemptedUrl: "/workspace/wiki?from=guard" },
					),
				),
			).rejects.toThrow(
				/createTokenSetOidcLoginRedirectHandler.*client key "frontend".*loginWithRedirect/,
			);
		} finally {
			injector.destroy();
		}
	});
});
