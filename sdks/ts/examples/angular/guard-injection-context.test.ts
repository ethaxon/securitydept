import { HttpClient, HttpResponse } from "@angular/common/http";
import {
	createEnvironmentInjector,
	type EnvironmentInjector,
	InjectionToken,
	Injector,
	runInInjectionContext,
} from "@angular/core";
import {
	type ActivatedRouteSnapshot,
	Router,
	type RouterStateSnapshot,
} from "@angular/router";
import {
	createFoundationEnvironment,
	ResourceStatus,
	UriReferenceString,
	writeSecuritydeptRouteMetadata,
} from "@securitydept/client";
import { provideEnvironment } from "@securitydept/client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import { type TokenSetClientRegistry } from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetClientForTest,
	createTokenSetClientRegistryEntryForTest,
	createTokenSetClientRegistryForTest,
} from "@securitydept/token-set-context-client/test";
import {
	createTokenSetCanActivate,
	provideTokenSetRequirementPlannerHost,
	TOKEN_SET_CLIENT_REGISTRY,
} from "@securitydept/token-set-context-client-angular";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

const TEST_AUTH_ACTION = new InjectionToken<() => void>("TEST_AUTH_ACTION");
const NULL_ENVIRONMENT_INJECTOR = null as unknown as EnvironmentInjector;

function createMockClient(authenticated: boolean): BaseOidcModeClient {
	return createTokenSetClientForTest({
		id: "confluence",
		authSnapshot: {
			status: ResourceStatus.Resolved,
			value: authenticated
				? { tokens: { accessToken: "confluence" }, metadata: {} }
				: null,
		},
	});
}

function createRegistry(
	client: BaseOidcModeClient,
): TokenSetClientRegistry<BaseOidcModeClient> {
	return createTokenSetClientRegistryForTest<BaseOidcModeClient>({
		entries: [
			createTokenSetClientRegistryEntryForTest({
				clientKey: "confluence",
				client,
				callbackUrl: "/auth/callback",
				requirementKind: "frontend_oidc",
			}),
		],
	});
}

function createMockRouter(attemptedUrl: string) {
	return {
		url: "/current",
		navigateByUrl: vi.fn(async () => true),
		parseUrl: (value: string) => ({ redirectedTo: value }),
		serializeUrl: (tree: unknown) => String(tree),
		getCurrentNavigation: () => ({
			finalUrl: { toString: () => attemptedUrl },
		}),
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

describe("Angular token-set route guard injection context", () => {
	it("passes Angular injector access through the planner environment", async () => {
		let actionCalls = 0;
		let routeUrl: string | undefined;
		const registry = createRegistry(createMockClient(false));
		const injector = createEnvironmentInjector(
			[
				{ provide: TOKEN_SET_CLIENT_REGISTRY, useValue: registry },
				{ provide: Router, useValue: createMockRouter("/confluence") },
				createHttpClientProvider(),
				provideEnvironment({
					createBaseEnvironment: createFoundationEnvironment,
				}),
				provideTokenSetRequirementPlannerHost({
					onClientUnauthenticated: (_requirement, context) => {
						context.environment.injector.get(Injector).get(TEST_AUTH_ACTION)();
						routeUrl = context.planContext.routeState.url;
						return false;
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
		const guard = createTokenSetCanActivate();

		const result = await runInInjectionContext(injector, () =>
			guard(createRouteSnapshot(), {
				url: "/confluence",
			} as RouterStateSnapshot),
		);

		expect(result).toBe(false);
		expect(actionCalls).toBe(1);
		expect(routeUrl).toBe("/confluence");
		injector.destroy();
	});

	it("starts OIDC login redirects from the registry-backed guard", async () => {
		const client = createMockClient(false);
		const loginWithRedirect = vi.spyOn(client, "loginWithRedirect");
		const registry = createRegistry(client);
		const injector = createEnvironmentInjector(
			[
				{ provide: TOKEN_SET_CLIENT_REGISTRY, useValue: registry },
				{ provide: Router, useValue: createMockRouter("/confluence") },
				createHttpClientProvider(),
				provideEnvironment({
					createBaseEnvironment: createFoundationEnvironment,
					router: {
						currentUrl: () =>
							UriReferenceString.parse("https://app.example.com/current"),
						navigate: vi.fn(async () => undefined),
					},
				}),
				provideTokenSetRequirementPlannerHost(),
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
					attributes: { query: { requirementKind: "frontend_oidc" } },
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

async function flushMicrotasks() {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}
