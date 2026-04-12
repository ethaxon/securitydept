// Angular Router Adapter example test
//
// Proves the integration between Angular's ActivatedRouteSnapshot and the SDK's
// RouteMatchNode[] contract via the AuthRouteAdapter injectable service.
//
// AuthRouteAdapter uses real @angular/router types (ActivatedRouteSnapshot)
// and is wired as an Angular Injectable, but can be instantiated directly in
// headless unit tests since it has no constructor dependencies.

import type { ActivatedRouteSnapshot } from "@angular/router";
import {
	createRouteRequirementOrchestrator,
	ResolutionStatus,
} from "@securitydept/client/auth-coordination";
import { AuthRouteAdapter } from "@securitydept/client-angular";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test helper — builds a mock ActivatedRouteSnapshot chain
// ---------------------------------------------------------------------------

function buildRouteChain(
	segments: Array<{
		path?: string;
		data?: Record<string, unknown>;
	}>,
): ActivatedRouteSnapshot {
	// We use a cast to ActivatedRouteSnapshot because in a headless test we
	// construct plain objects with the minimal required shape.
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

	// Wire up children / firstChild.
	for (let i = 0; i < snapshots.length - 1; i++) {
		const current = snapshots[i] as unknown as {
			children: ActivatedRouteSnapshot[];
			firstChild: ActivatedRouteSnapshot | null;
		};
		const next = snapshots[i + 1] as ActivatedRouteSnapshot;
		current.children = [next];
		current.firstChild = next;
	}

	const leaf = snapshots[snapshots.length - 1];
	if (!leaf) throw new Error("buildRouteChain: segments must not be empty");
	return leaf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Angular Router Adapter (AuthRouteAdapter)", () => {
	// Instantiate directly — no DI needed in headless tests.
	const adapter = new AuthRouteAdapter();

	describe("projectRouteMatch", () => {
		it("projects a leaf route's pathFromRoot into RouteMatchNode[]", () => {
			const leaf = buildRouteChain([
				{
					/* root, no routeConfig */
				},
				{
					path: "dashboard",
					data: {
						authRequirements: [{ id: "session", kind: "session" }],
					},
				},
				{
					path: "admin",
					data: {
						authRequirements: [{ id: "admin-token", kind: "backend_oidc" }],
					},
				},
			]);

			const chain = adapter.projectRouteMatch(leaf);

			expect(chain).toEqual([
				{ routeId: "__root__", requirements: [] },
				{
					routeId: "dashboard",
					requirements: [{ id: "session", kind: "session" }],
				},
				{
					routeId: "admin",
					requirements: [{ id: "admin-token", kind: "backend_oidc" }],
				},
			]);
		});

		it("handles empty-path routes as __index__", () => {
			const leaf = buildRouteChain([{}, { path: "" }, { path: "settings" }]);

			const chain = adapter.projectRouteMatch(leaf);

			expect(chain[0]?.routeId).toBe("__root__");
			expect(chain[1]?.routeId).toBe("__index__");
			expect(chain[2]?.routeId).toBe("settings");
		});

		it("uses custom requirementsKey", () => {
			const leaf = buildRouteChain([
				{},
				{
					path: "secure",
					data: { myReqs: [{ id: "s", kind: "custom" }] },
				},
			]);

			const chain = adapter.projectRouteMatch(leaf, {
				requirementsKey: "myReqs",
			});

			expect(chain[1]?.requirements).toEqual([{ id: "s", kind: "custom" }]);
		});

		it("produces empty requirements for routes without auth data", () => {
			const leaf = buildRouteChain([
				{},
				{ path: "public", data: { title: "Public Page" } },
			]);

			const chain = adapter.projectRouteMatch(leaf);

			expect(chain[1]?.requirements).toEqual([]);
		});
	});

	describe("projectRouteSegments", () => {
		it("projects an explicit segment array", () => {
			const segments = [
				{
					routeConfig: null,
					data: {},
				} as unknown as ActivatedRouteSnapshot,
				{
					routeConfig: { path: "app" },
					data: {
						authRequirements: [{ id: "s", kind: "session" }],
					},
				} as unknown as ActivatedRouteSnapshot,
			];

			const chain = adapter.projectRouteSegments(segments);

			expect(chain).toEqual([
				{ routeId: "__root__", requirements: [] },
				{ routeId: "app", requirements: [{ id: "s", kind: "session" }] },
			]);
		});
	});

	describe("check", () => {
		it("activates routes and returns canActivate = false when requirements are pending", () => {
			const orchestrator = createRouteRequirementOrchestrator();

			const leaf = buildRouteChain([
				{},
				{
					path: "secure",
					data: {
						authRequirements: [{ id: "session", kind: "session" }],
					},
				},
			]);

			const result = adapter.check(leaf, orchestrator);

			expect(result.canActivate).toBe(false);
			expect(result.pendingRequirement).toEqual({
				id: "session",
				kind: "session",
			});
		});

		it("returns canActivate = true when route has no requirements", () => {
			const orchestrator = createRouteRequirementOrchestrator();

			const leaf = buildRouteChain([{}, { path: "public" }]);

			const result = adapter.check(leaf, orchestrator);

			expect(result.canActivate).toBe(true);
			expect(result.pendingRequirement).toBeNull();
		});

		it("returns canActivate = true after all requirements are resolved", () => {
			const orchestrator = createRouteRequirementOrchestrator();

			const leaf = buildRouteChain([
				{},
				{
					path: "secure",
					data: {
						authRequirements: [{ id: "session", kind: "session" }],
					},
				},
			]);

			// First check: pending
			adapter.check(leaf, orchestrator);

			// Resolve the requirement
			orchestrator.resolve({
				requirementId: "session",
				status: ResolutionStatus.Fulfilled,
			});

			// Second check: should be settled now
			const result = adapter.check(leaf, orchestrator);
			expect(result.canActivate).toBe(true);
		});

		it("integrates with parent-child requirement inheritance", () => {
			const onPending = vi.fn();
			const orchestrator = createRouteRequirementOrchestrator({
				onPendingRequirement: onPending,
			});

			const leaf = buildRouteChain([
				{},
				{
					path: "app",
					data: {
						authRequirements: [{ id: "session", kind: "session" }],
					},
				},
				{
					path: "admin",
					data: {
						authRequirements: [{ id: "admin-token", kind: "backend_oidc" }],
					},
				},
			]);

			// First check
			const result1 = adapter.check(leaf, orchestrator);
			expect(result1.canActivate).toBe(false);
			expect(result1.pendingRequirement?.id).toBe("session");
			expect(onPending).toHaveBeenCalledWith(
				expect.objectContaining({ id: "session" }),
			);

			// Resolve session
			orchestrator.resolve({
				requirementId: "session",
				status: ResolutionStatus.Fulfilled,
			});

			// Re-check: admin-token now pending
			const result2 = adapter.check(leaf, orchestrator);
			expect(result2.canActivate).toBe(false);
			expect(result2.pendingRequirement?.id).toBe("admin-token");

			// Resolve admin-token
			orchestrator.resolve({
				requirementId: "admin-token",
				status: ResolutionStatus.Fulfilled,
			});

			// Re-check: all settled
			const result3 = adapter.check(leaf, orchestrator);
			expect(result3.canActivate).toBe(true);
		});
	});
});
