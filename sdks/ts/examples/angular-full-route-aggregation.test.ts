// Angular full-route aggregation — evidence test
//
// Proves the canonical Angular Router auth pattern on the rewritten pipeline:
//   1. Requirements declared in route data (secureRoute / secureRouteRoot)
//   2. projectAngularRouteSegments walks pathFromRoot into RouteTreeSegment[]
//   3. RouteCompositionRequirementPlanner folds parent + child composition
//   4. The token-set RequirementPlannerHost maps requirements to registry
//      clients and drives a single settle/redirect decision
//   5. secureRouteRoot wires canActivate + canActivateChild to that pipeline

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
	type ReadableReplaySignalTrait,
	RequirementPlannerHost,
	RequirementsComposition,
	RouteCompositionRequirementPlanner,
	SECURITYDEPT_ROUTE_METADATA_KEY,
	type SecuritydeptRouteMetadata,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import { projectAngularRouteSegments } from "@securitydept/client-angular";
import { type AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import {
	provideTokenSetRequirementPlannerHost,
	secureRoute,
	secureRouteRoot,
	type TokenSetAngularClient,
	TokenSetAuthRegistry,
} from "@securitydept/token-set-context-client-angular";
import { describe, expect, it, vi } from "vitest";
import { createTestTokenSetReactiveFields } from "./test-token-set-client";

// ---------------------------------------------------------------------------
// Test helpers (minimal stubs — no DI needed)
// ---------------------------------------------------------------------------

interface ExampleCallbackClient {
	handleCallback(currentUrl: string): Promise<{
		snapshot: AuthSnapshot | null;
		postAuthRedirectUri?: string;
	}>;
}

type ExampleClient = TokenSetAngularClient & ExampleCallbackClient;

function readReplayBoolean(
	signal: ReadableReplaySignalTrait<boolean>,
): boolean {
	const slot = signal.get();
	return slot.kind === "value" ? slot.value : false;
}

function createMockClient(authenticated: boolean): ExampleClient {
	const snap = authenticated
		? {
				tokens: {
					accessToken: "tok",
					idToken: "id",
					accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
				},
				metadata: { source: { kind: "oidc_authorization_code" as const } },
			}
		: null;
	const reactive = createTestTokenSetReactiveFields(snap);
	return {
		...reactive.fields,
		authEvents: createEventSubject(),
		addWorkflowSource: vi.fn(() => ({ unsubscribe: vi.fn() })),
		removeWorkflowSource: vi.fn(() => false),
		start: vi.fn(async () => undefined),
		dispose: vi.fn(),
		[SYMBOL_DISPOSE]: vi.fn(),
		restorePersistedState: vi.fn().mockResolvedValue(null),
		loginWithRedirect: vi.fn(async () => undefined),
		loginWithPopup: vi.fn(async () => ({ snapshot: snap! })),
		handleCallback: vi.fn().mockResolvedValue({ snapshot: snap }),
	};
}

function createMockRouter() {
	return {
		url: "/current",
		parseUrl(url: string) {
			return { toString: () => url };
		},
		serializeUrl(tree: unknown) {
			return String(tree);
		},
		getCurrentNavigation() {
			return null;
		},
	};
}

/**
 * Build a minimal ActivatedRouteSnapshot chain from declarative segments.
 */
function buildRouteChain(
	segments: Array<{
		path?: string;
		data?: Record<string, unknown>;
	}>,
): ActivatedRouteSnapshot {
	const snapshots: ActivatedRouteSnapshot[] = [];

	for (const seg of segments) {
		const snapshot = {
			routeConfig:
				seg.path !== undefined ? { path: seg.path, data: seg.data } : null,
			data: seg.data ?? {},
			children: [] as ActivatedRouteSnapshot[],
			firstChild: null as ActivatedRouteSnapshot | null,
			pathFromRoot: [] as ActivatedRouteSnapshot[],
		} as unknown as ActivatedRouteSnapshot;
		snapshots.push(snapshot);
	}

	for (let i = 0; i < snapshots.length; i++) {
		(
			snapshots[i] as unknown as { pathFromRoot: ActivatedRouteSnapshot[] }
		).pathFromRoot = snapshots.slice(0, i + 1);
	}

	const leaf = snapshots[snapshots.length - 1];
	if (!leaf) {
		throw new Error("buildRouteChain: segments must not be empty");
	}
	return leaf;
}

function buildRouteChainFromRoutes(routes: Route[]): ActivatedRouteSnapshot {
	return buildRouteChain(
		routes.map((route) => ({
			path: route.path,
			data: route.data,
		})),
	);
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
			const outcome = guard(route, { url: "/target" } as RouterStateSnapshot);
			return await Promise.resolve(outcome);
		});
	} finally {
		injector.destroy();
		parent.destroy();
	}
}

// ---------------------------------------------------------------------------
// 1. secureRoute metadata declaration
// ---------------------------------------------------------------------------

describe("Angular full-route aggregation — secureRoute metadata", () => {
	it("writes normalized requirements into route data (kind → attributes.requirementKind)", () => {
		const route = secureRoute("dashboard", {
			requirements: [{ id: "session", kind: "session" }],
		});
		const metadata = route.data?.[
			SECURITYDEPT_ROUTE_METADATA_KEY
		] as SecuritydeptRouteMetadata;
		const requirements = metadata?.requirements as Array<{
			id: string;
			attributes?: Record<string, unknown>;
		}>;
		expect(requirements).toHaveLength(1);
		expect(requirements[0]?.id).toBe("session");
		expect(requirements[0]?.attributes?.requirementKind).toBe("session");
	});

	it("stores explicit composition", () => {
		const route = secureRoute("public", {
			requirements: [],
			composition: RequirementsComposition.Replace,
		});
		const metadata = route.data?.[
			SECURITYDEPT_ROUTE_METADATA_KEY
		] as SecuritydeptRouteMetadata;
		expect(metadata?.composition).toBe(RequirementsComposition.Replace);
	});

	it("merges extra route data", () => {
		const route = secureRoute(
			"finance",
			{ requirements: [{ id: "finance-oidc", kind: "frontend_oidc" }] },
			{ data: { title: "Finance" } },
		);
		expect(route.data?.title).toBe("Finance");
		expect(
			(
				route.data?.[
					SECURITYDEPT_ROUTE_METADATA_KEY
				] as SecuritydeptRouteMetadata
			)?.requirements,
		).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// 2. projectAngularRouteSegments — full-route aggregation via the planner
// ---------------------------------------------------------------------------

function foldEffectiveIds(leaf: ActivatedRouteSnapshot): string[] {
	const planner = RouteCompositionRequirementPlanner.fromRootRoute(
		RequirementPlannerHost.fromBehaviour({}),
		projectAngularRouteSegments(leaf),
	);
	return planner.effectiveRequirements.map((requirement) => requirement.id);
}

describe("Angular full-route aggregation — composition folding", () => {
	it("returns empty when no segment declares requirements", () => {
		const leaf = buildRouteChain([{}, { path: "public" }]);
		expect(foldEffectiveIds(leaf)).toEqual([]);
	});

	it("accumulates requirements from parent + child segments", () => {
		const leaf = buildRouteChainFromRoutes([
			secureRoute("app", {
				requirements: [{ id: "session", kind: "session" }],
			}),
			secureRoute("confluence", {
				requirements: [{ id: "confluence-oidc", kind: "frontend_oidc" }],
			}),
		]);
		expect(foldEffectiveIds(leaf)).toEqual(["session", "confluence-oidc"]);
	});

	it("handles multi-level accumulation (3 levels)", () => {
		const leaf = buildRouteChainFromRoutes([
			secureRoute("app", {
				requirements: [{ id: "session", kind: "session" }],
			}),
			secureRoute("admin", {
				requirements: [{ id: "admin-oidc", kind: "backend_oidc" }],
			}),
			secureRoute("settings", {
				requirements: [{ id: "settings-perm", kind: "frontend_oidc" }],
			}),
		]);
		expect(foldEffectiveIds(leaf)).toEqual([
			"session",
			"admin-oidc",
			"settings-perm",
		]);
	});

	it("replace composition discards inherited requirements", () => {
		const leaf = buildRouteChainFromRoutes([
			secureRoute("dashboard", {
				requirements: [
					{ id: "oidc-a", kind: "frontend_oidc" },
					{ id: "oidc-b", kind: "frontend_oidc" },
				],
			}),
			secureRoute("public-zone", {
				requirements: [],
				composition: RequirementsComposition.Replace,
			}),
		]);
		expect(foldEffectiveIds(leaf)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 3. Full pipeline — planner drives a single settle/redirect decision
// ---------------------------------------------------------------------------

describe("Angular full-route aggregation — pipeline decision over aggregated set", () => {
	it("redirects on the first unmet requirement in declaration order", async () => {
		const registry = new TokenSetAuthRegistry();
		registry.register({
			key: "session",
			clientFactory: () => createMockClient(true),
			requirementKind: "session",
		});
		registry.register({
			key: "confluence",
			clientFactory: () => createMockClient(false),
			requirementKind: "frontend_oidc",
		});

		const root = secureRouteRoot(
			"app",
			{
				requirements: [{ id: "session", kind: "session" }],
				requirementHandlers: {
					frontend_oidc: () => "/login/confluence",
				},
			},
			{
				children: [
					secureRoute("confluence", {
						requirements: [{ id: "confluence-oidc", kind: "frontend_oidc" }],
					}),
				],
			},
		);
		const childGuard = root.canActivateChild?.[0] as CanActivateChildFn;
		const leaf = buildRouteChainFromRoutes([root, root.children?.[0] as Route]);

		const result = await invokeGuard(childGuard, leaf, [
			...(root.providers ?? []),
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: Router, useValue: createMockRouter() },
		]);

		expect(String(result)).toBe("/login/confluence");
	});

	it("allows navigation when all aggregated requirements are met", async () => {
		const registry = new TokenSetAuthRegistry();
		registry.register({
			key: "session",
			clientFactory: () => createMockClient(true),
			requirementKind: "session",
		});
		registry.register({
			key: "confluence",
			clientFactory: () => createMockClient(true),
			requirementKind: "frontend_oidc",
		});

		const root = secureRouteRoot(
			"app",
			{
				requirements: [{ id: "session", kind: "session" }],
				requirementHandlers: { frontend_oidc: () => "/login/confluence" },
			},
			{
				children: [
					secureRoute("confluence", {
						requirements: [{ id: "confluence-oidc", kind: "frontend_oidc" }],
					}),
				],
			},
		);
		const childGuard = root.canActivateChild?.[0] as CanActivateChildFn;
		const leaf = buildRouteChainFromRoutes([root, root.children?.[0] as Route]);

		const result = await invokeGuard(childGuard, leaf, [
			...(root.providers ?? []),
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: Router, useValue: createMockRouter() },
		]);

		expect(result).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 4. secureRouteRoot / secureRoute — builder contract
// ---------------------------------------------------------------------------

describe("Angular full-route aggregation — secureRouteRoot / secureRoute", () => {
	it("secureRouteRoot attaches both canActivate and canActivateChild plus a host provider", () => {
		const root = secureRouteRoot(
			"dashboard",
			{
				requirements: [{ id: "dashboard-oidc", kind: "frontend_oidc" }],
				requirementPolicies: {
					"dashboard-oidc": {
						selector: { clientKey: "dashboard" },
						onUnauthenticated: () => "/login/dashboard",
					},
				},
			},
			{ children: [] },
		);

		expect(root.canActivate).toHaveLength(1);
		expect(root.canActivateChild).toHaveLength(1);
		expect(root.providers?.length).toBeGreaterThanOrEqual(1);
	});

	it("canActivateChild respects replace composition for public child routes", async () => {
		const registry = new TokenSetAuthRegistry();
		registry.register({
			key: "dashboard-a",
			clientFactory: () => createMockClient(false),
			requirementKind: "frontend_oidc",
		});

		const root = secureRouteRoot(
			"dashboard",
			{
				requirements: [{ id: "oidc-a", kind: "frontend_oidc" }],
				requirementPolicies: {
					"oidc-a": {
						selector: { clientKey: "dashboard-a" },
						onUnauthenticated: () => "/login/a",
					},
				},
			},
			{
				children: [
					secureRoute("public-zone", {
						requirements: [],
						composition: RequirementsComposition.Replace,
					}),
				],
			},
		);
		const childGuard = root.canActivateChild?.[0] as CanActivateChildFn;
		const publicLeaf = buildRouteChainFromRoutes([
			root,
			root.children?.[0] as Route,
		]);

		const result = await invokeGuard(childGuard, publicLeaf, [
			...(root.providers ?? []),
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: Router, useValue: createMockRouter() },
		]);

		expect(result).toBe(true);
	});

	it("canActivateChild blocks escape into protected sibling routes", async () => {
		const registry = new TokenSetAuthRegistry();
		registry.register({
			key: "dashboard-a",
			clientFactory: () => createMockClient(false),
			requirementKind: "frontend_oidc",
		});
		registry.register({
			key: "finance",
			clientFactory: () => createMockClient(false),
			requirementKind: "frontend_oidc",
		});

		const root = secureRouteRoot(
			"dashboard",
			{
				requirements: [{ id: "oidc-a", kind: "frontend_oidc" }],
				requirementPolicies: {
					"oidc-a": {
						selector: { clientKey: "dashboard-a" },
						onUnauthenticated: () => "/login/a",
					},
					"finance-oidc": {
						selector: { clientKey: "finance" },
						onUnauthenticated: () => "/login/finance",
					},
				},
			},
			{
				children: [
					secureRoute("public-zone", {
						requirements: [],
						composition: RequirementsComposition.Replace,
					}),
					secureRoute("finance", {
						requirements: [{ id: "finance-oidc", kind: "frontend_oidc" }],
					}),
				],
			},
		);
		const childGuard = root.canActivateChild?.[0] as CanActivateChildFn;
		const publicLeaf = buildRouteChainFromRoutes([
			root,
			root.children?.[0] as Route,
		]);
		const financeLeaf = buildRouteChainFromRoutes([
			root,
			root.children?.[1] as Route,
		]);
		const providers = [
			...(root.providers ?? []),
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: Router, useValue: createMockRouter() },
		];

		expect(await invokeGuard(childGuard, publicLeaf, providers)).toBe(true);
		expect(String(await invokeGuard(childGuard, financeLeaf, providers))).toBe(
			"/login/a",
		);
	});

	it("canActivateChild admits fresh clients without invoking the handler", async () => {
		const registry = new TokenSetAuthRegistry();
		const client = createMockClient(true);
		const onUnauthenticated = vi.fn(() => "/login/confluence");
		registry.register({
			key: "confluence",
			clientFactory: () => client,
			requirementKind: "frontend_oidc",
		});

		const root = secureRouteRoot(
			"workspace",
			{
				requirements: [{ id: "confluence-oidc", kind: "frontend_oidc" }],
				requirementPolicies: {
					"confluence-oidc": {
						selector: { clientKey: "confluence" },
						onUnauthenticated,
					},
				},
			},
			{ children: [secureRoute("confluence", { requirements: [] })] },
		);
		const childGuard = root.canActivateChild?.[0] as CanActivateChildFn;
		const leaf = buildRouteChainFromRoutes([root, root.children?.[0] as Route]);

		const result = await invokeGuard(childGuard, leaf, [
			...(root.providers ?? []),
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: Router, useValue: createMockRouter() },
		]);

		expect(result).toBe(true);
		expect(readReplayBoolean(client.isAuthenticated)).toBe(true);
		expect(onUnauthenticated).not.toHaveBeenCalled();
	});

	it("canActivateChild runs the handler when the client is unauthenticated", async () => {
		const registry = new TokenSetAuthRegistry();
		const client = createMockClient(false);
		const onUnauthenticated = vi.fn(() => "/login/confluence");
		registry.register({
			key: "confluence",
			clientFactory: () => client,
			requirementKind: "frontend_oidc",
		});

		const root = secureRouteRoot(
			"workspace",
			{
				requirements: [{ id: "confluence-oidc", kind: "frontend_oidc" }],
				requirementPolicies: {
					"confluence-oidc": {
						selector: { clientKey: "confluence" },
						onUnauthenticated,
					},
				},
			},
			{ children: [secureRoute("confluence", { requirements: [] })] },
		);
		const childGuard = root.canActivateChild?.[0] as CanActivateChildFn;
		const leaf = buildRouteChainFromRoutes([root, root.children?.[0] as Route]);

		const result = await invokeGuard(childGuard, leaf, [
			...(root.providers ?? []),
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: Router, useValue: createMockRouter() },
		]);

		expect(String(result)).toBe("/login/confluence");
		expect(onUnauthenticated).toHaveBeenCalledTimes(1);
	});

	it("blocks (returns false) when the handler denies navigation", async () => {
		const registry = new TokenSetAuthRegistry();
		const onUnauthenticated = vi.fn(() => false);
		registry.register({
			key: "confluence",
			clientFactory: () => createMockClient(false),
			requirementKind: "frontend_oidc",
		});

		const root = secureRouteRoot(
			"workspace",
			{
				requirements: [{ id: "confluence-oidc", kind: "frontend_oidc" }],
				requirementPolicies: {
					"confluence-oidc": {
						selector: { clientKey: "confluence" },
						onUnauthenticated,
					},
				},
			},
			{ children: [secureRoute("confluence", { requirements: [] })] },
		);
		const childGuard = root.canActivateChild?.[0] as CanActivateChildFn;
		const leaf = buildRouteChainFromRoutes([root, root.children?.[0] as Route]);

		const result = await invokeGuard(childGuard, leaf, [
			...(root.providers ?? []),
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: Router, useValue: createMockRouter() },
		]);

		expect(result).toBe(false);
		expect(onUnauthenticated).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// 5. provideTokenSetRequirementPlannerHost API shape
// ---------------------------------------------------------------------------

describe("Angular full-route aggregation — provideTokenSetRequirementPlannerHost", () => {
	it("returns EnvironmentProviders", () => {
		const providers = provideTokenSetRequirementPlannerHost({
			requirementHandlers: { frontend_oidc: () => "/login" },
			defaultOnUnauthenticated: () => false,
		});
		expect(providers).toBeDefined();
	});
});
