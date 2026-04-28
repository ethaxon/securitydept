// Angular full-route aggregation guard — evidence test
//
// Proves the canonical Angular Router auth pattern (Iteration 106):
//   1. Requirements declared in route data (withRouteRequirements)
//   2. Guard walks pathFromRoot once (extractFullRouteRequirements)
//   3. All requirements aggregated from parent + child route segments
//   4. Complete candidate set handed to PlannerHost in a single evaluate() call
//   5. Chooser / planner makes one decision (no per-segment guard coordination)
//
// This test validates:
//   - Single-route, single-requirement scenario
//   - Single-route, multi-requirement scenario
//   - Parent + child route requirement accumulation
//   - Leaf guard sees the complete aggregated set (full-route aggregation)
//   - Planner makes exactly one decision for the full set
//   - createTokenSetRouteAggregationGuard API shape

import {
	createEnvironmentInjector,
	type EnvironmentInjector,
	runInInjectionContext,
} from "@angular/core";
import {
	type ActivatedRouteSnapshot,
	type CanActivateChildFn,
	type Route,
	Router,
	type RouterStateSnapshot,
} from "@angular/router";
import { createSubject, type ReadableSignalTrait } from "@securitydept/client";
import {
	type AuthGuardClientOption,
	createPlannerHost,
	RequirementsClientSetComposition,
} from "@securitydept/client/auth-coordination";
import {
	AUTH_PLANNER_HOST,
	DEFAULT_ROUTE_REQUIREMENTS_KEY,
	extractFullRouteRequirements,
	ROUTE_REQUIREMENTS_COMPOSITION_DATA_KEY,
	ROUTE_REQUIREMENTS_DATA_KEY,
	withRouteRequirements,
} from "@securitydept/client-angular";
import {
	EnsureAuthForResourceStatus,
	TokenSetAuthFlowSource,
} from "@securitydept/token-set-context-client/orchestration";
import {
	type CreateTokenSetRouteAggregationGuardOptions,
	createTokenSetRouteAggregationGuard,
	type OidcCallbackClient,
	type OidcModeClient,
	secureRoute,
	secureRouteRoot,
	TOKEN_SET_ROUTE_PLANNER_HOST_KEY_DATA_KEY,
	TokenSetAuthRegistry,
	type UnauthenticatedEntry,
} from "@securitydept/token-set-context-client-angular";
import { firstValueFrom, isObservable } from "rxjs";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test helpers (minimal stubs — no DI needed)
// ---------------------------------------------------------------------------

function createTestSignal<T>(initial: T): {
	signal: ReadableSignalTrait<T>;
	set(value: T): void;
} {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		signal: {
			get: () => value,
			subscribe(listener: () => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		set(newValue: T) {
			value = newValue;
			for (const l of listeners) l();
		},
	};
}

function createMockClient(
	authenticated: boolean,
): OidcModeClient & OidcCallbackClient {
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
	const { signal } = createTestSignal(snap);
	return {
		state: signal,
		authEvents: createSubject(),
		dispose: vi.fn(),
		restorePersistedState: vi.fn().mockResolvedValue(null),
		authorizationHeader: vi.fn(() => (snap ? "Bearer tok" : null)),
		ensureAuthForResource: vi.fn().mockResolvedValue(
			snap
				? {
						status: EnsureAuthForResourceStatus.Authenticated,
						snapshot: snap,
						freshness: "fresh",
					}
				: {
						status: EnsureAuthForResourceStatus.Unauthenticated,
						snapshot: null,
						authorizationHeader: null,
						reason: "no_snapshot",
					},
		),
		ensureFreshAuthState: vi.fn().mockResolvedValue(snap),
		ensureAuthorizationHeader: vi
			.fn()
			.mockResolvedValue(snap ? "Bearer tok" : null),
		handleCallback: vi.fn().mockResolvedValue({ snapshot: snap }),
	};
}

function createRouteFreshnessMockClient(options: {
	initialExpiresAt: number;
	refreshMaterial?: string;
	refreshResult: "fresh" | "unauthenticated";
}): OidcModeClient & OidcCallbackClient {
	const initial = {
		tokens: {
			accessToken: "expired-token",
			idToken: "id",
			accessTokenExpiresAt: new Date(options.initialExpiresAt).toISOString(),
			refreshMaterial: options.refreshMaterial,
		},
		metadata: { source: { kind: "oidc_authorization_code" as const } },
	};
	const refreshed = {
		tokens: {
			accessToken: "fresh-token",
			idToken: "id",
			accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
			refreshMaterial: options.refreshMaterial,
		},
		metadata: { source: { kind: "oidc_authorization_code" as const } },
	};
	const { signal, set } = createTestSignal<typeof initial | null>(initial);

	return {
		state: signal,
		authEvents: createSubject(),
		dispose: vi.fn(),
		restorePersistedState: vi.fn().mockResolvedValue(initial),
		authorizationHeader: vi.fn(() => null),
		ensureAuthForResource: vi.fn().mockImplementation(async () => {
			if (options.refreshResult === "fresh") {
				set(refreshed);
				return {
					status: EnsureAuthForResourceStatus.Authenticated,
					snapshot: refreshed,
					freshness: "fresh",
				};
			}
			set(null);
			return {
				status: EnsureAuthForResourceStatus.Unauthenticated,
				snapshot: null,
				authorizationHeader: null,
				reason: "refresh_failed",
			};
		}),
		ensureFreshAuthState: vi.fn().mockImplementation(async () => {
			if (options.refreshResult === "fresh") {
				set(refreshed);
				return refreshed;
			}
			set(null);
			return null;
		}),
		ensureAuthorizationHeader: vi.fn().mockResolvedValue(null),
		handleCallback: vi.fn().mockResolvedValue({ snapshot: initial }),
	};
}

function createMockRouter() {
	return {
		parseUrl(url: string) {
			return {
				toString() {
					return url;
				},
			};
		},
	};
}

/**
 * Build a minimal ActivatedRouteSnapshot chain from declarative segments.
 * Each segment can declare `path` and `data`.
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

	// Wire up pathFromRoot on each snapshot.
	for (let i = 0; i < snapshots.length; i++) {
		(
			snapshots[i] as unknown as { pathFromRoot: ActivatedRouteSnapshot[] }
		).pathFromRoot = snapshots.slice(0, i + 1);
	}

	const leaf = snapshots[snapshots.length - 1];
	if (!leaf) throw new Error("buildRouteChain: segments must not be empty");
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
	providers: Array<{ provide: unknown; useValue: unknown }>,
) {
	const parent = createEnvironmentInjector(
		[],
		null as unknown as EnvironmentInjector,
	);
	const injector = createEnvironmentInjector(providers, parent);
	try {
		return await runInInjectionContext(injector, async () => {
			const outcome = guard(route, { url: "/target" } as RouterStateSnapshot);
			if (isObservable(outcome)) {
				return await firstValueFrom(outcome);
			}
			return await Promise.resolve(outcome);
		});
	} finally {
		injector.destroy();
		parent.destroy();
	}
}

// ---------------------------------------------------------------------------
// 1. withRouteRequirements helper
// ---------------------------------------------------------------------------

describe("Angular full-route aggregation — withRouteRequirements helper", () => {
	it("produces an object with the requirements key", () => {
		const data = withRouteRequirements([{ id: "session", kind: "session" }]);
		expect(data[ROUTE_REQUIREMENTS_DATA_KEY]).toEqual([
			{ id: "session", kind: "session" },
		]);
	});

	it("merges extra data properties alongside the requirements key", () => {
		const data = withRouteRequirements(
			[{ id: "oidc", kind: "frontend_oidc" }],
			{ title: "Protected Page" },
		);
		expect(data.title).toBe("Protected Page");
		expect(data[ROUTE_REQUIREMENTS_DATA_KEY]).toHaveLength(1);
	});

	it("produces empty array for zero requirements", () => {
		const data = withRouteRequirements([]);
		expect(data[ROUTE_REQUIREMENTS_DATA_KEY]).toEqual([]);
	});

	it("defaults composition to merge", () => {
		const data = withRouteRequirements([{ id: "session", kind: "session" }]);
		expect(data[ROUTE_REQUIREMENTS_COMPOSITION_DATA_KEY]).toBe(
			RequirementsClientSetComposition.Merge,
		);
	});

	it("stores explicit replace composition", () => {
		const data = withRouteRequirements([], {
			composition: RequirementsClientSetComposition.Replace,
		});
		expect(data[ROUTE_REQUIREMENTS_COMPOSITION_DATA_KEY]).toBe(
			RequirementsClientSetComposition.Replace,
		);
	});

	it("ROUTE_REQUIREMENTS_DATA_KEY and DEFAULT_ROUTE_REQUIREMENTS_KEY are the same sentinel", () => {
		// Both names refer to the same constant — ensures AuthRouteAdapter
		// and the aggregation helpers share the same default key.
		expect(ROUTE_REQUIREMENTS_DATA_KEY).toBe(DEFAULT_ROUTE_REQUIREMENTS_KEY);
	});
});

// ---------------------------------------------------------------------------
// 2. extractFullRouteRequirements — full-route aggregation extraction
// ---------------------------------------------------------------------------

describe("Angular full-route aggregation — extractFullRouteRequirements", () => {
	it("returns empty array when no segment has authRequirements", () => {
		const leaf = buildRouteChain([{}, { path: "public" }]);
		expect(extractFullRouteRequirements(leaf)).toEqual([]);
	});

	it("extracts requirements from a single route segment", () => {
		const leaf = buildRouteChain([
			{},
			{
				path: "dashboard",
				data: withRouteRequirements([{ id: "session", kind: "session" }]),
			},
		]);
		const reqs = extractFullRouteRequirements(leaf);
		expect(reqs).toHaveLength(1);
		expect(reqs[0]?.id).toBe("session");
	});

	it("accumulates requirements from parent + child segments — full-route aggregation", () => {
		// This is the core scenario: parent declares session, child declares OIDC.
		// The leaf guard must see BOTH requirements without per-level DI scope.
		const leaf = buildRouteChain([
			{}, // root — no requirements
			{
				path: "app",
				data: withRouteRequirements([{ id: "session", kind: "session" }]),
			},
			{
				path: "confluence",
				// Child adds OIDC on top of parent's session requirement.
				data: withRouteRequirements([
					{ id: "confluence-oidc", kind: "frontend_oidc" },
				]),
			},
		]);

		const reqs = extractFullRouteRequirements(leaf);

		// Guard sees the FULL aggregated set: session (from parent) + OIDC (from child)
		expect(reqs).toHaveLength(2);
		expect(reqs[0]?.id).toBe("session"); // parent's requirement comes first
		expect(reqs[1]?.id).toBe("confluence-oidc"); // child's requirement appended
	});

	it("handles multi-level requirement accumulation (3 levels)", () => {
		const leaf = buildRouteChain([
			{}, // root
			{
				path: "app",
				data: withRouteRequirements([{ id: "session", kind: "session" }]),
			},
			{
				path: "admin",
				data: withRouteRequirements([
					{ id: "admin-oidc", kind: "backend_oidc" },
				]),
			},
			{
				path: "settings",
				data: withRouteRequirements([
					{ id: "settings-perm", kind: "frontend_oidc" },
				]),
			},
		]);

		const reqs = extractFullRouteRequirements(leaf);

		// Leaf guard sees all 3 requirements from the entire path chain
		expect(reqs).toHaveLength(3);
		expect(reqs.map((r) => r.id)).toEqual([
			"session",
			"admin-oidc",
			"settings-perm",
		]);
	});

	it("replace composition discards parent requirements", () => {
		const leaf = buildRouteChain([
			{},
			{
				path: "dashboard",
				data: withRouteRequirements(
					[
						{ id: "oidc-a", kind: "frontend_oidc" },
						{ id: "oidc-b", kind: "frontend_oidc" },
					],
					{ composition: RequirementsClientSetComposition.Merge },
				),
			},
			{
				path: "public-zone",
				data: withRouteRequirements([], {
					composition: RequirementsClientSetComposition.Replace,
				}),
			},
		]);

		expect(extractFullRouteRequirements(leaf)).toEqual([]);
	});

	it("supports custom requirementsKey", () => {
		const leaf = buildRouteChain([
			{},
			{
				path: "secure",
				data: { myAuthReqs: [{ id: "custom", kind: "custom" }] },
			},
		]);

		const reqs = extractFullRouteRequirements(leaf, "myAuthReqs");
		expect(reqs).toHaveLength(1);
		expect(reqs[0]?.id).toBe("custom");
	});
});

// ---------------------------------------------------------------------------
// 3. Full planner evaluation with aggregated requirements
//    Proves: leaf guard sees full set, planner makes exactly one decision
// ---------------------------------------------------------------------------

describe("Angular full-route aggregation — planner evaluates complete aggregated set", () => {
	it("planner sees full parent + child requirement set and picks the first unmet", async () => {
		// Scenario:
		//   Parent route requires "session" (met — client is authenticated)
		//   Child  route requires "frontend_oidc" (unmet — client is NOT authenticated)
		//
		// Guard must aggregate both, hand full set to planner, and planner must
		// select "frontend_oidc" (the first unmet requirement in declaration order).

		const registry = new TokenSetAuthRegistry();

		// "session" client — authenticated
		registry.register({
			key: "session",
			clientFactory: () => createMockClient(true),
			requirementKind: "session",
		});

		// "confluence" client — NOT authenticated
		registry.register({
			key: "confluence",
			clientFactory: () => createMockClient(false),
			requirementKind: "frontend_oidc",
		});

		// Build a leaf route that aggregates parent + child requirements
		const leaf = buildRouteChain([
			{}, // root
			{
				path: "app",
				data: withRouteRequirements([{ id: "session", kind: "session" }]),
			},
			{
				path: "confluence",
				data: withRouteRequirements([
					{ id: "confluence-oidc", kind: "frontend_oidc" },
				]),
			},
		]);

		// Extract full-route requirements — proves the guard sees both
		const allReqs = extractFullRouteRequirements(leaf);
		expect(allReqs).toHaveLength(2);
		expect(allReqs[0]?.id).toBe("session");
		expect(allReqs[1]?.id).toBe("confluence-oidc");

		// Build candidates the same way the guard does (map kind → registry clients)
		const { createPlannerHost: createPlannerHostFn } = await import(
			"@securitydept/client/auth-coordination"
		);
		const plannerHost = createPlannerHostFn();

		const candidates = allReqs.flatMap((req) => {
			const keys = registry.clientKeyListForRequirement(req.kind);
			if (keys.length === 0) return [];
			return [
				{
					requirementId: req.id,
					requirementKind: req.kind,
					checkAuthenticated: () =>
						keys.every((k) => registry.require(k).isAuthenticated()),
					onUnauthenticated: () => false as boolean,
				},
			];
		});

		// One single planner evaluation for the complete aggregated set
		const result = await plannerHost.evaluate(candidates);

		// Session is authenticated — planner advances past it.
		// Confluence OIDC is NOT authenticated — planner selects it.
		expect(result.allAuthenticated).toBe(false);
		expect(result.pendingCandidate?.requirementId).toBe("confluence-oidc");
	});

	it("planner returns allAuthenticated when all aggregated requirements are met", async () => {
		const registry = new TokenSetAuthRegistry();

		// Both clients authenticated
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

		const leaf = buildRouteChain([
			{},
			{
				path: "app",
				data: withRouteRequirements([{ id: "session", kind: "session" }]),
			},
			{
				path: "confluence",
				data: withRouteRequirements([
					{ id: "confluence-oidc", kind: "frontend_oidc" },
				]),
			},
		]);

		const allReqs = extractFullRouteRequirements(leaf);
		const plannerHost = createPlannerHost();

		const candidates = allReqs.flatMap((req) => {
			const keys = registry.clientKeyListForRequirement(req.kind);
			if (keys.length === 0) return [];
			return [
				{
					requirementId: req.id,
					requirementKind: req.kind,
					checkAuthenticated: () =>
						keys.every((k) => registry.require(k).isAuthenticated()),
					onUnauthenticated: () => false as boolean,
				},
			];
		});

		const result = await plannerHost.evaluate(candidates);

		// All requirements met — planner returns allAuthenticated: true
		expect(result.allAuthenticated).toBe(true);
		expect(result.pendingCandidate).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 4. createTokenSetRouteAggregationGuard API shape
// ---------------------------------------------------------------------------

describe("Angular full-route aggregation — createTokenSetRouteAggregationGuard API", () => {
	it("is a function that returns a CanActivateFn (function)", () => {
		expect(typeof createTokenSetRouteAggregationGuard).toBe("function");
		const guard = createTokenSetRouteAggregationGuard();
		expect(typeof guard).toBe("function");
	});

	it("accepts requirementHandlers per kind", () => {
		const guard = createTokenSetRouteAggregationGuard({
			requirementHandlers: {
				frontend_oidc: (_failing: ReadonlyArray<UnauthenticatedEntry>, _req) =>
					false,
				backend_oidc: (_failing: ReadonlyArray<UnauthenticatedEntry>, _req) =>
					"/admin/login",
			},
		});
		expect(typeof guard).toBe("function");
	});

	it("accepts defaultOnUnauthenticated fallback", () => {
		const guard = createTokenSetRouteAggregationGuard({
			defaultOnUnauthenticated: (
				_failing: ReadonlyArray<UnauthenticatedEntry>,
				_req,
			) => "/login",
		});
		expect(typeof guard).toBe("function");
	});

	it("accepts custom requirementsKey", () => {
		const guard = createTokenSetRouteAggregationGuard({
			requirementsKey: "myAuthReqs",
		});
		expect(typeof guard).toBe("function");
	});

	it("accepts inline plannerHost", () => {
		const host = createPlannerHost();
		const guard = createTokenSetRouteAggregationGuard({ plannerHost: host });
		expect(typeof guard).toBe("function");
	});

	it("CreateTokenSetRouteAggregationGuardOptions type is importable", () => {
		const opts: CreateTokenSetRouteAggregationGuardOptions = {
			requirementHandlers: {
				session: () => false,
			},
			defaultOnUnauthenticated: () => true,
			requirementsKey: "authRequirements",
		};
		expect(opts).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// 5. secureRouteRoot / secureRoute — canonical route builder contract
// ---------------------------------------------------------------------------

describe("Angular full-route aggregation — secureRouteRoot / secureRoute", () => {
	it("secureRoute stores serializable plannerHostKey in route data", () => {
		const route = secureRoute(
			"finance",
			{
				requirements: [{ id: "finance-oidc", kind: "frontend_oidc" }],
				plannerHostKey: "finance-planner",
			},
			{ title: "Finance" } as Route,
		);

		expect(route.data?.[TOKEN_SET_ROUTE_PLANNER_HOST_KEY_DATA_KEY]).toBe(
			"finance-planner",
		);
		expect(route.data?.[ROUTE_REQUIREMENTS_DATA_KEY]).toEqual([
			{ id: "finance-oidc", kind: "frontend_oidc" },
		]);
	});

	it("secureRouteRoot attaches both canActivate and canActivateChild", () => {
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
	});

	it("canActivateChild respects replace composition and avoids carrying parent requirements into public child routes", async () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "dashboard-a",
			clientFactory: () => createMockClient(false),
			requirementKind: "frontend_oidc",
		});
		registry.register({
			key: "dashboard-b",
			clientFactory: () => createMockClient(false),
			requirementKind: "frontend_oidc",
		});

		const root = secureRouteRoot(
			"dashboard",
			{
				requirements: [
					{ id: "oidc-a", kind: "frontend_oidc" },
					{ id: "oidc-b", kind: "frontend_oidc" },
				],
				requirementPolicies: {
					"oidc-a": {
						selector: { clientKey: "dashboard-a" },
						onUnauthenticated: () => "/login/a",
					},
					"oidc-b": {
						selector: { clientKey: "dashboard-b" },
						onUnauthenticated: () => "/login/b",
					},
				},
			},
			{
				children: [
					secureRoute(
						"public-zone",
						{
							requirements: [],
							composition: RequirementsClientSetComposition.Replace,
						},
						{},
					),
				],
			},
		);

		const childGuard = root.canActivateChild?.[0] as
			| CanActivateChildFn
			| undefined;
		if (!childGuard) {
			throw new Error("secureRouteRoot did not provide canActivateChild");
		}

		const publicLeaf = buildRouteChainFromRoutes([
			root,
			root.children?.[0] as Route,
		]);
		const result = await invokeGuard(childGuard, publicLeaf, [
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: AUTH_PLANNER_HOST, useValue: createPlannerHost() },
			{ provide: Router, useValue: createMockRouter() },
		]);

		expect(result).toBe(true);
	});

	it("canActivateChild re-checks sibling navigation and blocks escape into protected child routes", async () => {
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
					secureRoute(
						"public-zone",
						{
							requirements: [],
							composition: RequirementsClientSetComposition.Replace,
						},
						{},
					),
					secureRoute(
						"finance",
						{
							requirements: [{ id: "finance-oidc", kind: "frontend_oidc" }],
						},
						{},
					),
				],
			},
		);

		const childGuard = root.canActivateChild?.[0] as
			| CanActivateChildFn
			| undefined;
		if (!childGuard) {
			throw new Error("secureRouteRoot did not provide canActivateChild");
		}

		const publicLeaf = buildRouteChainFromRoutes([
			root,
			root.children?.[0] as Route,
		]);
		const financeLeaf = buildRouteChainFromRoutes([
			root,
			root.children?.[1] as Route,
		]);
		const providers = [
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: AUTH_PLANNER_HOST, useValue: createPlannerHost() },
			{ provide: Router, useValue: createMockRouter() },
		];

		expect(await invokeGuard(childGuard, publicLeaf, providers)).toBe(true);

		const protectedResult = await invokeGuard(
			childGuard,
			financeLeaf,
			providers,
		);
		expect(String(protectedResult)).toBe("/login/a");
	});

	it("plannerHost selection is resolved by serializable route metadata, not inline child callbacks", async () => {
		const registry = new TokenSetAuthRegistry();

		registry.register({
			key: "finance",
			clientFactory: () => createMockClient(true),
			requirementKind: "frontend_oidc",
		});

		const defaultEvaluate = vi
			.fn<
				(candidates: readonly AuthGuardClientOption[]) => Promise<{
					allAuthenticated: boolean;
					unauthenticatedCandidates: readonly AuthGuardClientOption[];
					pendingCandidate: AuthGuardClientOption | null;
				}>
			>()
			.mockResolvedValue({
				allAuthenticated: true,
				unauthenticatedCandidates: [],
				pendingCandidate: null,
			});
		const financeEvaluate = vi
			.fn<
				(candidates: readonly AuthGuardClientOption[]) => Promise<{
					allAuthenticated: boolean;
					unauthenticatedCandidates: readonly AuthGuardClientOption[];
					pendingCandidate: AuthGuardClientOption | null;
				}>
			>()
			.mockResolvedValue({
				allAuthenticated: true,
				unauthenticatedCandidates: [],
				pendingCandidate: null,
			});

		const root = secureRouteRoot(
			"dashboard",
			{
				plannerHosts: {
					default: { evaluate: defaultEvaluate },
					finance: { evaluate: financeEvaluate },
				},
				defaultPlannerHostKey: "default",
				requirementPolicies: {
					"finance-oidc": {
						selector: { clientKey: "finance" },
						onUnauthenticated: () => false,
					},
				},
			},
			{
				children: [
					secureRoute(
						"finance",
						{
							plannerHostKey: "finance",
							requirements: [{ id: "finance-oidc", kind: "frontend_oidc" }],
						},
						{},
					),
				],
			},
		);

		const childGuard = root.canActivateChild?.[0] as
			| CanActivateChildFn
			| undefined;
		if (!childGuard) {
			throw new Error("secureRouteRoot did not provide canActivateChild");
		}

		const financeLeaf = buildRouteChainFromRoutes([
			root,
			root.children?.[0] as Route,
		]);
		const result = await invokeGuard(childGuard, financeLeaf, [
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: Router, useValue: createMockRouter() },
		]);

		expect(result).toBe(true);
		expect(financeEvaluate).toHaveBeenCalledTimes(1);
		expect(defaultEvaluate).not.toHaveBeenCalled();
	});

	it("canActivateChild refreshes expired token material before allowing protected route entry", async () => {
		const registry = new TokenSetAuthRegistry();
		const client = createRouteFreshnessMockClient({
			initialExpiresAt: Date.now() - 1_000,
			refreshMaterial: "refresh-token",
			refreshResult: "fresh",
		});
		const onUnauthenticated = vi.fn(() => "/login/confluence");

		registry.register({
			key: "confluence",
			clientFactory: () => client,
			requirementKind: "frontend_oidc",
			autoRestore: false,
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
			{ children: [secureRoute("confluence", { requirements: [] }, {})] },
		);
		const childGuard = root.canActivateChild?.[0] as CanActivateChildFn;
		const leaf = buildRouteChainFromRoutes([root, root.children?.[0] as Route]);

		const result = await invokeGuard(childGuard, leaf, [
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: AUTH_PLANNER_HOST, useValue: createPlannerHost() },
			{ provide: Router, useValue: createMockRouter() },
		]);

		expect(result).toBe(true);
		expect(client.ensureAuthForResource).toHaveBeenCalledWith(
			expect.objectContaining({
				clientKey: "confluence",
				forceRefreshWhenDue: true,
				requirement: { id: "confluence-oidc", kind: "frontend_oidc" },
				source: TokenSetAuthFlowSource.RouteGuard,
				url: "/target",
			}),
		);
		expect(onUnauthenticated).not.toHaveBeenCalled();
	});

	it("canActivateChild runs unauthenticated handler when refresh material cannot recover the route", async () => {
		const registry = new TokenSetAuthRegistry();
		const client = createRouteFreshnessMockClient({
			initialExpiresAt: Date.now() - 1_000,
			refreshMaterial: "refresh-token",
			refreshResult: "unauthenticated",
		});
		const onUnauthenticated = vi.fn(() => "/login/confluence");

		registry.register({
			key: "confluence",
			clientFactory: () => client,
			requirementKind: "frontend_oidc",
			autoRestore: false,
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
			{ children: [secureRoute("confluence", { requirements: [] }, {})] },
		);
		const childGuard = root.canActivateChild?.[0] as CanActivateChildFn;
		const leaf = buildRouteChainFromRoutes([root, root.children?.[0] as Route]);

		const result = await invokeGuard(childGuard, leaf, [
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: AUTH_PLANNER_HOST, useValue: createPlannerHost() },
			{ provide: Router, useValue: createMockRouter() },
		]);

		expect(String(result)).toBe("/login/confluence");
		expect(client.ensureAuthForResource).toHaveBeenCalledWith(
			expect.objectContaining({
				clientKey: "confluence",
				forceRefreshWhenDue: true,
				requirement: { id: "confluence-oidc", kind: "frontend_oidc" },
				source: TokenSetAuthFlowSource.RouteGuard,
				url: "/target",
			}),
		);
		expect(onUnauthenticated).toHaveBeenCalledTimes(1);
	});

	it("canActivateChild does not admit expired access tokens without refresh recovery", async () => {
		const registry = new TokenSetAuthRegistry();
		const client = createRouteFreshnessMockClient({
			initialExpiresAt: Date.now() - 1_000,
			refreshResult: "unauthenticated",
		});
		const onUnauthenticated = vi.fn(() => false);

		registry.register({
			key: "confluence",
			clientFactory: () => client,
			requirementKind: "frontend_oidc",
			autoRestore: false,
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
			{ children: [secureRoute("confluence", { requirements: [] }, {})] },
		);
		const childGuard = root.canActivateChild?.[0] as CanActivateChildFn;
		const leaf = buildRouteChainFromRoutes([root, root.children?.[0] as Route]);

		const result = await invokeGuard(childGuard, leaf, [
			{ provide: TokenSetAuthRegistry, useValue: registry },
			{ provide: AUTH_PLANNER_HOST, useValue: createPlannerHost() },
			{ provide: Router, useValue: createMockRouter() },
		]);

		expect(result).toBe(false);
		expect(client.ensureAuthForResource).toHaveBeenCalledWith(
			expect.objectContaining({
				clientKey: "confluence",
				forceRefreshWhenDue: true,
				requirement: { id: "confluence-oidc", kind: "frontend_oidc" },
				source: TokenSetAuthFlowSource.RouteGuard,
				url: "/target",
			}),
		);
		expect(onUnauthenticated).toHaveBeenCalledTimes(1);
	});
});
