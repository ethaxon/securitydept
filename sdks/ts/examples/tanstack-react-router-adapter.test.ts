import {
	createRouteRequirementOrchestrator,
	ResolutionStatus,
} from "@securitydept/client/auth-coordination";
import {
	createTanStackRouteActivator,
	DEFAULT_REQUIREMENTS_KEY,
	projectTanStackRouteMatches,
	type TanStackRouteMatch,
} from "@securitydept/client-react/tanstack-router";
import { describe, expect, it, vi } from "vitest";

describe("TanStack React Router Adapter", () => {
	describe("projectTanStackRouteMatches", () => {
		it("projects matches with auth requirements from staticData", () => {
			const matches: TanStackRouteMatch[] = [
				{ routeId: "__root__", staticData: {} },
				{
					routeId: "/dashboard",
					staticData: {
						authRequirements: [{ id: "session", kind: "session" }],
					},
				},
				{
					routeId: "/dashboard/admin",
					staticData: {
						authRequirements: [{ id: "admin-token", kind: "backend_oidc" }],
					},
				},
			];

			const chain = projectTanStackRouteMatches(matches);

			expect(chain).toEqual([
				{ routeId: "__root__", requirements: [] },
				{
					routeId: "/dashboard",
					requirements: [{ id: "session", kind: "session" }],
				},
				{
					routeId: "/dashboard/admin",
					requirements: [{ id: "admin-token", kind: "backend_oidc" }],
				},
			]);
		});

		it("uses custom requirementsKey", () => {
			const matches: TanStackRouteMatch[] = [
				{
					routeId: "/settings",
					staticData: { myAuthReqs: [{ id: "s", kind: "custom" }] },
				},
			];

			const chain = projectTanStackRouteMatches(matches, {
				requirementsKey: "myAuthReqs",
			});

			expect(chain).toEqual([
				{ routeId: "/settings", requirements: [{ id: "s", kind: "custom" }] },
			]);
		});

		it("produces empty requirements for matches without staticData", () => {
			const matches: TanStackRouteMatch[] = [
				{ routeId: "__root__" },
				{ routeId: "/public", staticData: {} },
			];

			const chain = projectTanStackRouteMatches(matches);

			expect(chain).toEqual([
				{ routeId: "__root__", requirements: [] },
				{ routeId: "/public", requirements: [] },
			]);
		});

		it("handles non-array requirementsKey value gracefully", () => {
			const matches: TanStackRouteMatch[] = [
				{
					routeId: "/broken",
					staticData: { [DEFAULT_REQUIREMENTS_KEY]: "not-an-array" },
				},
			];

			const chain = projectTanStackRouteMatches(matches);
			expect(chain[0].requirements).toEqual([]);
		});
	});

	describe("createTanStackRouteActivator", () => {
		it("projects and activates matches on orchestrator", () => {
			const orchestrator = createRouteRequirementOrchestrator();
			const activator = createTanStackRouteActivator(orchestrator);

			const matches: TanStackRouteMatch[] = [
				{ routeId: "__root__", staticData: {} },
				{
					routeId: "/dashboard",
					staticData: {
						authRequirements: [{ id: "session", kind: "session" }],
					},
				},
			];

			activator.activate(matches);

			const snap = orchestrator.snapshot();
			expect(snap.activeRouteId).toBe("/dashboard");
			expect(snap.settled).toBe(false);
			expect(snap.pendingRequirement).toEqual({
				id: "session",
				kind: "session",
			});
		});

		it("deactivates the current route", () => {
			const orchestrator = createRouteRequirementOrchestrator();
			const activator = createTanStackRouteActivator(orchestrator);

			activator.activate([
				{
					routeId: "/secure",
					staticData: {
						authRequirements: [{ id: "s", kind: "session" }],
					},
				},
			]);

			expect(orchestrator.snapshot().activeRouteId).toBe("/secure");

			activator.deactivate();
			expect(orchestrator.snapshot().activeRouteId).toBeNull();
		});

		it("integrates with full orchestration lifecycle: project → activate → resolve → settled", () => {
			const onSettled = vi.fn();
			const orchestrator = createRouteRequirementOrchestrator({ onSettled });
			const activator = createTanStackRouteActivator(orchestrator);

			// Simulate matched route chain with parent + child requirements
			const matches: TanStackRouteMatch[] = [
				{
					routeId: "/app",
					staticData: {
						authRequirements: [{ id: "session", kind: "session" }],
					},
				},
				{
					routeId: "/app/data",
					staticData: {
						authRequirements: [{ id: "api-token", kind: "backend_oidc" }],
					},
				},
			];

			activator.activate(matches);

			// Resolve first requirement
			orchestrator.resolve({
				requirementId: "session",
				status: ResolutionStatus.Fulfilled,
			});

			// Should advance to next
			expect(orchestrator.snapshot().pendingRequirement?.id).toBe("api-token");

			// Resolve second
			orchestrator.resolve({
				requirementId: "api-token",
				status: ResolutionStatus.Fulfilled,
			});

			// Settled
			expect(orchestrator.snapshot().settled).toBe(true);
			expect(onSettled).toHaveBeenCalledOnce();
		});

		it("route transition preserves shared prefix resolutions", () => {
			const orchestrator = createRouteRequirementOrchestrator();
			const activator = createTanStackRouteActivator(orchestrator);

			// Initial route: /app → /app/dashboard
			activator.activate([
				{
					routeId: "/app",
					staticData: {
						authRequirements: [{ id: "session", kind: "session" }],
					},
				},
				{
					routeId: "/app/dashboard",
					staticData: {
						authRequirements: [{ id: "dash-access", kind: "backend_oidc" }],
					},
				},
			]);

			// Resolve both
			orchestrator.resolve({
				requirementId: "session",
				status: ResolutionStatus.Fulfilled,
			});
			orchestrator.resolve({
				requirementId: "dash-access",
				status: ResolutionStatus.Fulfilled,
			});
			expect(orchestrator.snapshot().settled).toBe(true);

			// Navigate to /app/settings (same parent, different child)
			activator.activate([
				{
					routeId: "/app",
					staticData: {
						authRequirements: [{ id: "session", kind: "session" }],
					},
				},
				{
					routeId: "/app/settings",
					staticData: {
						authRequirements: [{ id: "settings-access", kind: "backend_oidc" }],
					},
				},
			]);

			// Session should still be resolved (shared prefix), only settings-access pending
			const snap = orchestrator.snapshot();
			expect(snap.pendingRequirement?.id).toBe("settings-access");
			// The plan should show session as already resolved
			const plan = snap.plan;
			expect(plan).toBeDefined();
			expect(plan?.resolutions).toHaveLength(1);
			expect(plan?.resolutions[0].requirementId).toBe("session");
		});
	});
});
