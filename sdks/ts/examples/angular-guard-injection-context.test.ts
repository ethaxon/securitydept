import {
	createEnvironmentInjector,
	type EnvironmentInjector,
	InjectionToken,
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
	createRootSpan,
	createSignal,
	createTracing,
	SYMBOL_DISPOSE,
	writeSecuritydeptRouteMetadata,
} from "@securitydept/client";
import {
	createEnvironmentForNativeWeb,
	type NativeWebEnvironment,
} from "@securitydept/client/web";
import { provideEnvironment } from "@securitydept/client-angular";
import {
	createTokenSetCanActivate,
	createTokenSetOidcLoginRedirectHandler,
	provideTokenSetRequirementPlannerHost,
	TokenSetAuthRegistry,
} from "@securitydept/token-set-context-client-angular";
import { describe, expect, it, vi } from "vitest";
import { createTestTokenSetReactiveFields } from "./test-token-set-client";

const TEST_AUTH_ACTION = new InjectionToken<() => void>("TEST_AUTH_ACTION");
const NULL_ENVIRONMENT_INJECTOR = null as unknown as EnvironmentInjector;

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
	return createEnvironmentForNativeWeb({
		transport: createTransport(),
		time: createTime(),
		span: createRootSpan(),
		tracing: createTracing(),
		routerForNativeWebCreateOptions: {
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
	});
}

/**
 * Mock Angular Router that exposes the attempted navigation via
 * getCurrentNavigation(), matching how the guard resolves attemptedUrl.
 */
function createMockRouter(attemptedUrl: string) {
	return {
		url: "/current",
		parseUrl: (value: string) => ({ redirectedTo: value }),
		serializeUrl: (tree: unknown) => String(tree),
		getCurrentNavigation: () => ({
			finalUrl: { toString: () => attemptedUrl },
		}),
	};
}

describe("Angular token-set route guard injection context", () => {
	it("runs unauthenticated handlers in the captured injector after async planner work", async () => {
		let actionCalls = 0;
		let attemptedUrl: string | undefined;
		const reactive = createTestTokenSetReactiveFields(null);
		const client = {
			state: createSignal(null),
			...reactive.fields,
			authEvents: createEventSubject(),
			addWorkflowSource: vi.fn(() => ({ unsubscribe: vi.fn() })),
			removeWorkflowSource: vi.fn(() => false),
			start: vi.fn(async () => undefined),
			dispose: vi.fn(),
			[SYMBOL_DISPOSE]: vi.fn(),
			restorePersistedState: vi.fn(async () => null),
			handleCallback: vi.fn(),
			loginWithRedirect: vi.fn(),
		};
		const registry = {
			clientRecordGenForQuery: function* () {
				yield createSignal({
					meta: {
						clientKey: "confluence",
						requirementKind: "frontend_oidc",
					},
				});
			},
			initialize: async () => client,
		};
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				{ provide: Router, useValue: createMockRouter("/confluence") },
				provideTokenSetRequirementPlannerHost({
					requirementHandlers: {
						frontend_oidc: (_failing, _requirement, context) => {
							inject(TEST_AUTH_ACTION)();
							attemptedUrl = context.attemptedUrl;
							return false;
						},
					},
				}),
				{
					provide: TEST_AUTH_ACTION,
					useValue: () => {
						actionCalls += 1;
					},
				},
			],
			NULL_ENVIRONMENT_INJECTOR,
		);
		const route = createRouteSnapshot();
		const guard = createTokenSetCanActivate();

		const result = await runInInjectionContext(injector, () =>
			guard(route, { url: "/confluence" } as RouterStateSnapshot),
		);

		expect(result).toBe(false);
		expect(actionCalls).toBe(1);
		expect(attemptedUrl).toBe("/confluence");

		injector.destroy();
	});

	it("uses the attempted navigation URL for OIDC login redirects", async () => {
		const loginWithRedirect = vi.fn().mockResolvedValue(undefined);
		const environment = createAngularPageEnvironment();
		const reactive = createTestTokenSetReactiveFields(null);
		const client = {
			state: createSignal(null),
			...reactive.fields,
			authEvents: createEventSubject(),
			addWorkflowSource: vi.fn(() => ({ unsubscribe: vi.fn() })),
			removeWorkflowSource: vi.fn(() => false),
			start: vi.fn(async () => undefined),
			dispose: vi.fn(),
			[SYMBOL_DISPOSE]: vi.fn(),
			restorePersistedState: vi.fn(async () => null),
			handleCallback: vi.fn(),
			loginWithRedirect,
		};
		const registry = {
			clientRecordGenForQuery: function* () {
				yield createSignal({
					meta: {
						clientKey: "confluence",
						requirementKind: "frontend_oidc",
					},
				});
			},
			initialize: async () => client,
		};
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				provideEnvironment({ environment }),
				{
					provide: Router,
					useValue: createMockRouter("/confluence/spaces/abc?tab=pages"),
				},
				provideTokenSetRequirementPlannerHost({
					requirementHandlers: {
						frontend_oidc: createTokenSetOidcLoginRedirectHandler({
							clientKey: "confluence",
						}),
					},
				}),
			],
			NULL_ENVIRONMENT_INJECTOR,
		);

		const guard = createTokenSetCanActivate();

		const guardResult = runInInjectionContext(injector, () =>
			guard(createRouteSnapshot(), {
				url: "/confluence/spaces/abc?tab=pages",
			} as RouterStateSnapshot),
		);
		const settled = vi.fn();
		Promise.resolve(guardResult).then(settled, settled);

		await flushMicrotasks();
		expect(loginWithRedirect).toHaveBeenCalledWith({
			postAuthRedirectUri: "/confluence/spaces/abc?tab=pages",
		});
		expect(settled).not.toHaveBeenCalled();

		injector.destroy();
	});
});

function createRouteSnapshot(): ActivatedRouteSnapshot {
	const route = {
		data: writeSecuritydeptRouteMetadata(undefined, {
			requirements: [
				{
					id: "confluence-oidc",
					label: "Confluence OIDC",
					attributes: { requirementKind: "frontend_oidc" },
				},
			],
		}),
		routeConfig: { data: {} },
	} as unknown as ActivatedRouteSnapshot & {
		pathFromRoot: ActivatedRouteSnapshot[];
	};
	route.pathFromRoot = [route];
	return route;
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}
