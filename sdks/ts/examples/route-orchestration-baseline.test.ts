// Route requirement planner session — focused evidence test
//
// Proves the headless matched-route-chain integration baseline:
//   1. Matched route chain — parent requirement inheritance
//   2. Matched route chain — child requirement append
//   3. Sequential resolution with callbacks
//   4. Chooser decision tracking
//   5. Route chain transition — shared prefix preservation
//   6. Route chain transition — diverging decision discard
//   7. Route deactivation / reset
//   8. onPendingRequirement stream fires on activation and after resolution
//
// Canonical import: @securitydept/client
// (consolidated from @securitydept/token-set-context-client/orchestration)

import {
	createAuthRequirement,
	ResolutionStatus,
	RouteRequirementPlannerSession,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";

describe("route requirement planner session (matched-route-chain)", () => {
	it("inherits parent requirements in matched route chain", () => {
		const session = RouteRequirementPlannerSession.fromRouteRoot();

		session.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [createAuthRequirement({ id: "session" })],
			},
			{
				routeId: "/app/dashboard",
				requirements: [createAuthRequirement({ id: "api-token" })],
			},
		]);

		expect(session.activeRouteId).toBe("/app/dashboard");
		expect(session.total).toBe(2);
		expect(session.pendingRequirement?.id).toBe("session");
		expect(session.matchedRoutes).toHaveLength(2);
	});

	it("child appends requirements on top of inherited parent", () => {
		const session = RouteRequirementPlannerSession.fromRouteRoot();

		session.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [createAuthRequirement({ id: "session" })],
			},
			{
				routeId: "/app/admin",
				requirements: [createAuthRequirement({ id: "admin-oidc" })],
			},
		]);

		session.resolve({
			requirementId: "session",
			status: ResolutionStatus.Fulfilled,
		});

		expect(session.pendingRequirement?.id).toBe("admin-oidc");
		expect(session.settled).toBe(false);
	});

	it("resolves all requirements and settles with onSettled stream", () => {
		const onSettled = vi.fn();
		const session = RouteRequirementPlannerSession.fromRouteRoot();
		session.onSettled.subscribe({ next: onSettled });

		session.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [createAuthRequirement({ id: "session" })],
			},
			{
				routeId: "/app/dashboard",
				requirements: [createAuthRequirement({ id: "api-token" })],
			},
		]);

		session.resolve({
			requirementId: "session",
			status: ResolutionStatus.Fulfilled,
		});
		expect(onSettled).not.toHaveBeenCalled();

		session.resolve({
			requirementId: "api-token",
			status: ResolutionStatus.Fulfilled,
		});

		expect(session.settled).toBe(true);
		expect(session.pendingRequirement).toBeNull();
		expect(onSettled).toHaveBeenCalledWith({
			routeId: "/app/dashboard",
			resolutions: expect.any(Array),
		});
	});

	it("tracks chooser decisions", () => {
		const session = RouteRequirementPlannerSession.fromRouteRoot();

		session.activateMatchedRoutes([
			{
				routeId: "/settings",
				requirements: [createAuthRequirement({ id: "oidc" })],
			},
		]);

		session.applyChooserDecision({
			requirementId: "oidc",
			providerId: "google",
			metadata: { hint: "work-email" },
		});

		expect(session.decisions).toHaveLength(1);
		expect(session.decisions[0].providerId).toBe("google");
	});

	it("fires onPendingRequirement on activation and after each resolution", () => {
		const onPending = vi.fn();
		const session = RouteRequirementPlannerSession.fromRouteRoot();
		session.onPendingRequirement.subscribe({ next: onPending });

		session.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [createAuthRequirement({ id: "first" })],
			},
			{
				routeId: "/app/page",
				requirements: [createAuthRequirement({ id: "second" })],
			},
		]);

		expect(onPending).toHaveBeenCalledTimes(1);
		expect(onPending).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "first" }),
		);

		session.resolve({
			requirementId: "first",
			status: ResolutionStatus.Fulfilled,
		});
		expect(onPending).toHaveBeenCalledTimes(2);
		expect(onPending).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "second" }),
		);
	});

	it("preserves shared-prefix resolutions on route chain transition", () => {
		const session = RouteRequirementPlannerSession.fromRouteRoot();

		session.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [createAuthRequirement({ id: "session" })],
			},
			{
				routeId: "/app/dashboard",
				requirements: [createAuthRequirement({ id: "dash-token" })],
			},
		]);

		session.resolve({
			requirementId: "session",
			status: ResolutionStatus.Fulfilled,
		});

		session.applyChooserDecision({
			requirementId: "session",
			providerId: "default",
		});

		session.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [createAuthRequirement({ id: "session" })],
			},
			{
				routeId: "/app/settings",
				requirements: [createAuthRequirement({ id: "settings-oidc" })],
			},
		]);

		expect(session.activeRouteId).toBe("/app/settings");
		expect(session.resolved).toBe(1);
		expect(session.pendingRequirement?.id).toBe("settings-oidc");
		expect(session.decisions).toHaveLength(1);
		expect(session.decisions[0].requirementId).toBe("session");
	});

	it("discards diverging decisions on route chain transition", () => {
		const session = RouteRequirementPlannerSession.fromRouteRoot();

		session.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [createAuthRequirement({ id: "session" })],
			},
			{
				routeId: "/app/dashboard",
				requirements: [createAuthRequirement({ id: "dash-token" })],
			},
		]);

		session.resolve({
			requirementId: "session",
			status: ResolutionStatus.Fulfilled,
		});
		session.resolve({
			requirementId: "dash-token",
			status: ResolutionStatus.Fulfilled,
		});

		session.applyChooserDecision({
			requirementId: "dash-token",
			providerId: "azure",
		});

		session.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [createAuthRequirement({ id: "session" })],
			},
			{
				routeId: "/app/profile",
				requirements: [createAuthRequirement({ id: "profile-req" })],
			},
		]);

		expect(session.decisions).toHaveLength(0);
	});

	it("resets state on deactivateRoute", () => {
		const session = RouteRequirementPlannerSession.fromRouteRoot();

		session.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [createAuthRequirement({ id: "s" })],
			},
		]);

		session.deactivateRoute();

		expect(session.activeRouteId).toBeNull();
		expect(session.planActive).toBe(false);
		expect(session.settled).toBe(false);
		expect(session.matchedRoutes).toHaveLength(0);
	});
});
