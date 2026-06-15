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
	createEventSubject,
	createFoundationEnvironment,
	createSignal,
	ResourceStatus,
	resourceFromSnapshots,
	UriReferenceString,
	writeSecuritydeptRouteMetadata,
} from "@securitydept/client";
import { provideEnvironment } from "@securitydept/client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientReadyRecordView,
	type TokenSetClientRegistry,
} from "@securitydept/token-set-context-client/registry";
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
	const authSnapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: null,
	} as const);
	const authResource = resourceFromSnapshots(() => authSnapshot.get());
	const isAuthenticated = resourceFromSnapshots(() => ({
		status: ResourceStatus.Resolved,
		value: authenticated,
	}));
	const authorizationHeaderValue = resourceFromSnapshots(() => ({
		status: ResourceStatus.Resolved,
		value: authenticated ? "Bearer confluence" : undefined,
	}));
	return {
		id: "confluence",
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
		start: vi.fn(async () => undefined),
		dispose: vi.fn(),
		loginWithRedirect: vi.fn(async () => undefined),
		loginWithPopup: vi.fn(async () => ({
			snapshot: { tokens: { accessToken: "popup" }, metadata: {} },
		})),
	} as unknown as BaseOidcModeClient;
}

function createReadyRecord(
	client: BaseOidcModeClient,
): TokenSetClientReadyRecordView<BaseOidcModeClient> {
	const meta = {
		clientKey: "confluence",
		urlPatterns: [],
		callbackUrl: "/auth/callback",
		requirementKind: "frontend_oidc",
		providerFamily: undefined,
		initialization: TokenSetClientInitializationMode.Lazy,
	};
	return {
		id: "confluence",
		entry: { clientFactory: () => client, meta },
		meta,
		status: ResourceStatus.Resolved,
		client,
	};
}

function createRegistryMock(
	record: TokenSetClientReadyRecordView<BaseOidcModeClient>,
) {
	return {
		clientRecordGenForQuery: vi.fn(function* () {
			yield createSignal(record);
		}),
		clientRecordFor: vi.fn(async () => record),
	} as unknown as TokenSetClientRegistry<BaseOidcModeClient>;
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
		const registry = createRegistryMock(
			createReadyRecord(createMockClient(false)),
		);
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
		const registry = createRegistryMock(createReadyRecord(client));
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
