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
	createReplaySignal,
	createSignal,
	writeSecuritydeptRouteMetadata,
} from "@securitydept/client";
import { provideEnvironment } from "@securitydept/client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	ClientInitializationMode,
	type ClientReadyRecordView,
	ClientRegistryEntryStatus,
} from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetCanActivate,
	createTokenSetOidcLoginRedirectHandler,
	provideTokenSetRequirementPlannerHost,
	TokenSetClientRegistryService,
} from "@securitydept/token-set-context-client-angular";
import { describe, expect, it, vi } from "vitest";

const TEST_AUTH_ACTION = new InjectionToken<() => void>("TEST_AUTH_ACTION");
const NULL_ENVIRONMENT_INJECTOR = null as unknown as EnvironmentInjector;

function createMockClient(authenticated: boolean): BaseOidcModeClient {
	const authDetermined = createReplaySignal<true>();
	authDetermined.setValue(true);
	const authSnapshot = createReplaySignal<null>();
	authSnapshot.setValue(null);
	const isAuthenticated = createReplaySignal<boolean>();
	isAuthenticated.setValue(authenticated);
	const authorizationHeaderValue = createReplaySignal<string | undefined>();
	authorizationHeaderValue.setValue(
		authenticated ? "Bearer confluence" : undefined,
	);
	return {
		id: "confluence",
		authDetermined,
		authSnapshot,
		isAuthenticated,
		authorizationHeaderValue,
		lastAuthError: createSignal<unknown | undefined>(undefined),
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
): ClientReadyRecordView<BaseOidcModeClient> {
	const meta = {
		clientKey: "confluence",
		urlPatterns: [],
		callbackPath: "/auth/callback",
		requirementKind: "frontend_oidc",
		providerFamily: undefined,
		initialization: ClientInitializationMode.Lazy,
	};
	return {
		id: "confluence",
		entry: { clientFactory: () => client, meta },
		meta,
		status: ClientRegistryEntryStatus.Ready,
		client,
	};
}

function createRegistryMock(record: ClientReadyRecordView<BaseOidcModeClient>) {
	return {
		clientRecordGenForQuery: vi.fn(function* () {
			yield createSignal(record);
		}),
		initialize: vi.fn(async () => record),
	} as unknown as TokenSetClientRegistryService;
}

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
	it("passes Angular injector access through the planner environment", async () => {
		let actionCalls = 0;
		let routeUrl: string | undefined;
		const registry = createRegistryMock(
			createReadyRecord(createMockClient(false)),
		);
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetClientRegistryService, useValue: registry },
				{ provide: Router, useValue: createMockRouter("/confluence") },
				provideEnvironment({
					environment: (providers) =>
						createFoundationEnvironment({ providers }),
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
				{ provide: TokenSetClientRegistryService, useValue: registry },
				{ provide: Router, useValue: createMockRouter("/confluence") },
				provideEnvironment({
					environment: (providers) =>
						createFoundationEnvironment({
							providers,
							router: {
								currentUrl: () => new URL("https://app.example.com/current"),
								baseURI: () => new URL("https://app.example.com/"),
								navigate: vi.fn(async () => true),
							},
						}),
				}),
				provideTokenSetRequirementPlannerHost({
					onClientUnauthenticated: createTokenSetOidcLoginRedirectHandler({
						clientKey: "confluence",
					}),
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
			postAuthRedirectUri: "https://app.example.com/current",
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
