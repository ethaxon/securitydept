import {
	ResolutionStatus,
	RouteRequirementPlannerSession,
} from "@securitydept/client";
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
		it("projects and activates matches on session", () => {
			const session = RouteRequirementPlannerSession.fromRouteRoot();
			const activator = createTanStackRouteActivator(session);

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

			expect(session.activeRouteId).toBe("/dashboard");
			expect(session.settled).toBe(false);
			expect(session.pendingRequirement).toEqual({
				id: "session",
				kind: "session",
			});
		});

		it("deactivates the current route", () => {
			const session = RouteRequirementPlannerSession.fromRouteRoot();
			const activator = createTanStackRouteActivator(session);

			activator.activate([
				{
					routeId: "/secure",
					staticData: {
						authRequirements: [{ id: "s", kind: "session" }],
					},
				},
			]);

			expect(session.activeRouteId).toBe("/secure");

			activator.deactivate();
			expect(session.activeRouteId).toBeNull();
		});

		it("integrates with full lifecycle: project → activate → resolve → settled", () => {
			const onSettled = vi.fn();
			const session = RouteRequirementPlannerSession.fromRouteRoot();
			session.onSettled.subscribe({ next: onSettled });
			const activator = createTanStackRouteActivator(session);

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

			session.resolve({
				requirementId: "session",
				status: ResolutionStatus.Fulfilled,
			});

			expect(session.pendingRequirement?.id).toBe("api-token");

			session.resolve({
				requirementId: "api-token",
				status: ResolutionStatus.Fulfilled,
			});

			expect(session.settled).toBe(true);
			expect(onSettled).toHaveBeenCalledOnce();
		});

		it("route transition preserves shared prefix resolutions", () => {
			const session = RouteRequirementPlannerSession.fromRouteRoot();
			const activator = createTanStackRouteActivator(session);

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

			session.resolve({
				requirementId: "session",
				status: ResolutionStatus.Fulfilled,
			});
			session.resolve({
				requirementId: "dash-access",
				status: ResolutionStatus.Fulfilled,
			});
			expect(session.settled).toBe(true);

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

			expect(session.pendingRequirement?.id).toBe("settings-access");
			expect(session.resolutions).toHaveLength(1);
			expect(session.resolutions[0].requirementId).toBe("session");
		});
	});
});
