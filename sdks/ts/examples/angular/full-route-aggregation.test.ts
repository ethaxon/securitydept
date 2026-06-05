// Angular full-route aggregation — evidence test for the current registry model.

import { HttpClient, HttpResponse } from "@angular/common/http";
import {
	createEnvironmentInjector,
	type EnvironmentInjector,
	type EnvironmentProviders,
	type Provider,
	runInInjectionContext,
} from "@angular/core";
import {
	type ActivatedRouteSnapshot,
	type CanActivateChildFn,
	type Route,
	Router,
	type RouterStateSnapshot,
} from "@angular/router";
import {
	createEventSubject,
	createFoundationEnvironment,
	createSignal,
	RequirementsComposition,
	ResourceStatus,
	readSecuritydeptRouteMetadata,
	resourceFromSnapshots,
} from "@securitydept/client";
import { provideEnvironment } from "@securitydept/client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientReadyRecordView,
	TokenSetClientRegistryAuthRequirement,
	TokenSetClientRegistryEntryStatus,
} from "@securitydept/token-set-context-client/registry";
import {
	provideTokenSetRequirementPlannerHost,
	secureTokenSetRoute,
	secureTokenSetRouteRoot,
	TokenSetClientRegistryService,
} from "@securitydept/token-set-context-client-angular";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

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
		value: authenticated ? "Bearer live" : undefined,
	}));
	return {
		id: authenticated ? "ready" : "login",
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

function createRouterProvider() {
	return {
		provide: Router,
		useValue: {
			url: "/current",
			navigateByUrl: vi.fn(async () => true),
			parseUrl: (url: string) => ({ url }),
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

function createReadyRecord(
	clientKey: string,
	requirementKind: string,
	client: BaseOidcModeClient,
): TokenSetClientReadyRecordView<BaseOidcModeClient> {
	const meta = {
		clientKey,
		urlPatterns: [],
		callbackPath: undefined,
		requirementKind,
		providerFamily: undefined,
		initialization: TokenSetClientInitializationMode.Lazy,
	};
	return {
		id: clientKey,
		entry: { clientFactory: () => client, meta },
		meta,
		status: TokenSetClientRegistryEntryStatus.Ready,
		client,
	};
}

function createRegistryMock(
	records: readonly TokenSetClientReadyRecordView<BaseOidcModeClient>[],
) {
	return {
		clientRecordGenForQuery: vi.fn(function* (query: {
			requirementKind?: string;
		}) {
			for (const record of records) {
				if (
					query.requirementKind === undefined ||
					record.meta.requirementKind === query.requirementKind
				) {
					yield createSignal(record);
				}
			}
		}),
		initialize: vi.fn(async (clientKey: string) => {
			const record = records.find((item) => item.meta.clientKey === clientKey);
			if (!record) {
				throw new Error(`Missing test record: ${clientKey}`);
			}
			return record;
		}),
	} as unknown as TokenSetClientRegistryService;
}

function buildRouteChain(routes: Route[]): ActivatedRouteSnapshot {
	const snapshots = routes.map(
		(route) =>
			({
				routeConfig: { path: route.path, data: route.data },
				data: route.data ?? {},
				children: [],
				firstChild: null,
				pathFromRoot: [],
			}) as unknown as ActivatedRouteSnapshot,
	);
	for (let i = 0; i < snapshots.length; i++) {
		(
			snapshots[i] as unknown as { pathFromRoot: ActivatedRouteSnapshot[] }
		).pathFromRoot = snapshots.slice(0, i + 1);
	}
	const leaf = snapshots.at(-1);
	if (!leaf) {
		throw new Error("Expected at least one route.");
	}
	return leaf;
}

async function invokeGuard(
	guard: (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => unknown,
	route: ActivatedRouteSnapshot,
	providers: Array<Provider | EnvironmentProviders>,
) {
	const parent = createEnvironmentInjector(
		[],
		null as unknown as EnvironmentInjector,
	);
	const injector = createEnvironmentInjector(providers, parent);
	try {
		return await runInInjectionContext(injector, async () => {
			return await Promise.resolve(
				guard(route, { url: "/finance/reports" } as RouterStateSnapshot),
			);
		});
	} finally {
		injector.destroy();
		parent.destroy();
	}
}

describe("Angular full-route aggregation", () => {
	it("writes query-based token-set requirements into route metadata", () => {
		const requirement = TokenSetClientRegistryAuthRequirement.create({
			id: "finance",
			query: { requirementKind: "finance_oidc" },
		});
		const route = secureTokenSetRoute("finance", {
			requirements: [requirement],
			composition: RequirementsComposition.Merge,
		});

		expect(readSecuritydeptRouteMetadata(route.data)?.requirements).toEqual([
			requirement,
		]);
	});

	it("secureTokenSetRouteRoot wires guards and preserves route options", () => {
		const existingCanActivate = vi.fn(() => true);
		const route = secureTokenSetRouteRoot(
			"app",
			{
				requirements: [
					TokenSetClientRegistryAuthRequirement.create({
						id: "root",
						query: { requirementKind: "root_oidc" },
					}),
				],
			},
			{
				canActivate: [existingCanActivate],
				data: { title: "Application" },
			},
		);

		expect(route.data?.title).toBe("Application");
		expect(route.canActivate).toHaveLength(2);
		expect(route.canActivate?.[0]).toBe(existingCanActivate);
		expect(route.canActivateChild).toHaveLength(1);
		expect(
			readSecuritydeptRouteMetadata(route.data)?.requirements,
		).toHaveLength(1);
	});

	it("blocks when an inherited registry-backed route requirement is unauthenticated", async () => {
		const rootRequirement = TokenSetClientRegistryAuthRequirement.create({
			id: "root",
			query: { requirementKind: "root_oidc" },
		});
		const childRequirement = TokenSetClientRegistryAuthRequirement.create({
			id: "finance",
			query: { requirementKind: "finance_oidc" },
		});
		const root = secureTokenSetRouteRoot("app", {
			requirements: [rootRequirement],
		});
		const child = secureTokenSetRoute("finance", {
			requirements: [childRequirement],
		});
		const route = buildRouteChain([root, child]);
		const unauthenticated = createMockClient(false);
		const registry = createRegistryMock([
			createReadyRecord("root", "root_oidc", createMockClient(true)),
			createReadyRecord("finance", "finance_oidc", unauthenticated),
		]);
		const guard = root.canActivateChild?.[0] as CanActivateChildFn;

		await expect(
			invokeGuard(guard, route, [
				{ provide: TokenSetClientRegistryService, useValue: registry },
				createRouterProvider(),
				createHttpClientProvider(),
				provideEnvironment({
					createBaseEnvironment: createFoundationEnvironment,
				}),
				provideTokenSetRequirementPlannerHost({
					onClientUnauthenticated: () => false,
				}),
			]),
		).resolves.toBe(false);
		expect(registry.clientRecordGenForQuery).toHaveBeenCalledWith({
			requirementKind: "finance_oidc",
		});
	});

	it("settles when all inherited registry-backed requirements are authenticated", async () => {
		const root = secureTokenSetRouteRoot("app", {
			requirements: [
				TokenSetClientRegistryAuthRequirement.create({
					id: "root",
					query: { requirementKind: "root_oidc" },
				}),
			],
		});
		const child = secureTokenSetRoute("finance", {
			requirements: [
				TokenSetClientRegistryAuthRequirement.create({
					id: "finance",
					query: { requirementKind: "finance_oidc" },
				}),
			],
		});
		const registry = createRegistryMock([
			createReadyRecord("root", "root_oidc", createMockClient(true)),
			createReadyRecord("finance", "finance_oidc", createMockClient(true)),
		]);
		const guard = root.canActivateChild?.[0] as CanActivateChildFn;

		await expect(
			invokeGuard(guard, buildRouteChain([root, child]), [
				{ provide: TokenSetClientRegistryService, useValue: registry },
				createRouterProvider(),
				createHttpClientProvider(),
				provideEnvironment({
					createBaseEnvironment: createFoundationEnvironment,
				}),
				provideTokenSetRequirementPlannerHost(),
			]),
		).resolves.toBe(true);
	});
});
