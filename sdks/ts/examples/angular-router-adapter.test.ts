// Angular Router adapter example test
//
// Proves the integration between Angular's ActivatedRouteSnapshot and the SDK's
// RouteTreeSegment[] contract via projectAngularRouteSegments, plus the
// RouteCompositionRequirementPlanner pipeline that a canActivate guard drives.

import {
	createEnvironmentInjector,
	runInInjectionContext,
} from "@angular/core";
import {
	type ActivatedRouteSnapshot,
	Router,
	type RouterStateSnapshot,
} from "@angular/router";
import {
	type AuthRequirement,
	PipelineOutcome,
	RequirementPlannerHost,
	RouteCompositionRequirementPlanner,
	writeSecuritydeptRouteMetadata,
} from "@securitydept/client";
import {
	createAngularCanActivate,
	projectAngularRouteSegments,
} from "@securitydept/client-angular";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Test helper — builds a mock ActivatedRouteSnapshot chain
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Angular Router adapter (projectAngularRouteSegments)", () => {
	it("projects a leaf route's pathFromRoot into RouteTreeSegment[]", () => {
		const leaf = buildRouteChain([
			{
				/* root, no routeConfig */
			},
			{
				path: "dashboard",
				data: writeSecuritydeptRouteMetadata(undefined, {
					requirements: [{ id: "session", label: "Session" }],
				}),
			},
			{
				path: "admin",
				data: writeSecuritydeptRouteMetadata(undefined, {
					requirements: [{ id: "admin-token", label: "Admin" }],
				}),
			},
		]);

		const chain = projectAngularRouteSegments(leaf);

		expect(chain).toEqual([
			{ routeId: "__root__", requirements: [] },
			{
				routeId: "dashboard",
				requirements: [{ id: "session", label: "Session" }],
			},
			{
				routeId: "admin",
				requirements: [{ id: "admin-token", label: "Admin" }],
			},
		]);
	});

	it("handles empty-path routes as __index__", () => {
		const leaf = buildRouteChain([{}, { path: "" }, { path: "settings" }]);

		const chain = projectAngularRouteSegments(leaf);

		expect(chain[0]?.routeId).toBe("__root__");
		expect(chain[1]?.routeId).toBe("__index__");
		expect(chain[2]?.routeId).toBe("settings");
	});

	it("produces empty requirements for routes without auth data", () => {
		const leaf = buildRouteChain([
			{},
			{ path: "public", data: { title: "Public Page" } },
		]);

		const chain = projectAngularRouteSegments(leaf);

		expect(chain[1]?.requirements).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Pipeline integration — what a canActivate guard runs
// ---------------------------------------------------------------------------

describe("Angular Router adapter — planner pipeline over projected segments", () => {
	function hostWith(
		authenticatedIds: readonly string[],
	): RequirementPlannerHost {
		const authed = new Set(authenticatedIds);
		return RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: (requirement: AuthRequirement) =>
				authed.has(requirement.id),
			onUnauthenticated: () => false,
		});
	}

	it("blocks when a projected requirement is unmet", async () => {
		const leaf = buildRouteChain([
			{},
			{
				path: "secure",
				data: writeSecuritydeptRouteMetadata(undefined, {
					requirements: [{ id: "session" }],
				}),
			},
		]);
		const planner = RouteCompositionRequirementPlanner.fromRootRoute(
			hostWith([]),
			projectAngularRouteSegments(leaf),
		);

		const result = await planner.runUntilSettled();

		expect(result.outcome).toBe(PipelineOutcome.Blocked);
	});

	it("settles when the route declares no requirements", async () => {
		const leaf = buildRouteChain([{}, { path: "public" }]);
		const planner = RouteCompositionRequirementPlanner.fromRootRoute(
			hostWith([]),
			projectAngularRouteSegments(leaf),
		);

		const result = await planner.runUntilSettled();

		expect(result.outcome).toBe(PipelineOutcome.Settled);
	});

	it("settles once all inherited requirements are authenticated", async () => {
		const leaf = buildRouteChain([
			{},
			{
				path: "app",
				data: writeSecuritydeptRouteMetadata(undefined, {
					requirements: [{ id: "session" }],
				}),
			},
			{
				path: "admin",
				data: writeSecuritydeptRouteMetadata(undefined, {
					requirements: [{ id: "admin-token" }],
				}),
			},
		]);
		const planner = RouteCompositionRequirementPlanner.fromRootRoute(
			hostWith(["session", "admin-token"]),
			projectAngularRouteSegments(leaf),
		);

		const result = await planner.runUntilSettled();

		expect(result.outcome).toBe(PipelineOutcome.Settled);
	});
});

describe("createAngularCanActivate — guard behaviour option", () => {
	const routerState = {} as RouterStateSnapshot;

	function invokeGuard(
		leaf: ActivatedRouteSnapshot,
		options: Parameters<typeof createAngularCanActivate>[0],
	): Promise<boolean> {
		const injector = createEnvironmentInjector([
			{
				provide: Router,
				useValue: { parseUrl: (url: string) => url },
			},
		]);
		const guard = createAngularCanActivate(options);
		return runInInjectionContext(injector, () =>
			Promise.resolve(guard(leaf, routerState)),
		) as Promise<boolean>;
	}

	it("applies behaviour.checkAuthenticated at guard scope", async () => {
		const leaf = buildRouteChain([
			{},
			{
				path: "secure",
				data: writeSecuritydeptRouteMetadata(undefined, {
					requirements: [{ id: "session" }],
				}),
			},
		]);

		await expect(
			invokeGuard(leaf, {
				behaviour: { checkAuthenticated: () => false },
			}),
		).resolves.toBe(false);

		await expect(
			invokeGuard(leaf, {
				behaviour: {
					checkAuthenticated: (requirement: AuthRequirement) =>
						requirement.id === "session",
				},
			}),
		).resolves.toBe(true);
	});

	it("prefers plannerHost over behaviour", async () => {
		const leaf = buildRouteChain([
			{},
			{
				path: "secure",
				data: writeSecuritydeptRouteMetadata(undefined, {
					requirements: [{ id: "session" }],
				}),
			},
		]);

		const host = RequirementPlannerHost.fromBehaviour({
			checkAuthenticated: () => true,
		});

		await expect(
			invokeGuard(leaf, {
				plannerHost: host,
				behaviour: { checkAuthenticated: () => false },
			}),
		).resolves.toBe(true);
	});
});
