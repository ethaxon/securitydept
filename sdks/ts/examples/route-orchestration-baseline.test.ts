// Route requirement orchestrator — focused evidence test
//
// Proves the headless matched-route-chain integration baseline:
//   1. Matched route chain — parent requirement inheritance
//   2. Matched route chain — child requirement append
//   3. Sequential resolution with callbacks
//   4. Chooser decision tracking
//   5. Route chain transition — shared prefix preservation
//   6. Route chain transition — diverging decision discard
//   7. Route deactivation / reset
//   8. onPendingRequirement callback fires on activation and after resolution
//
// Canonical import: @securitydept/client/auth-coordination
// (moved from @securitydept/token-set-context-client/orchestration in iteration 102)

import {
	createRouteRequirementOrchestrator,
	ResolutionStatus,
} from "@securitydept/client/auth-coordination";
import { describe, expect, it, vi } from "vitest";

describe("route requirement orchestrator (matched-route-chain)", () => {
	it("inherits parent requirements in matched route chain", () => {
		const orchestrator = createRouteRequirementOrchestrator();

		orchestrator.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [{ id: "session", kind: "session" }],
			},
			{
				routeId: "/app/dashboard",
				requirements: [{ id: "api-token", kind: "backend_oidc" }],
			},
		]);

		const snap = orchestrator.snapshot();
		// Leaf route is the active route.
		expect(snap.activeRouteId).toBe("/app/dashboard");
		// Both parent + child requirements are merged.
		expect(snap.plan?.total).toBe(2);
		expect(snap.pendingRequirement?.id).toBe("session");
		// matchedRoutes reflect the chain.
		expect(snap.matchedRoutes).toHaveLength(2);
	});

	it("child appends requirements on top of inherited parent", () => {
		const orchestrator = createRouteRequirementOrchestrator();

		orchestrator.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [{ id: "session", kind: "session" }],
			},
			{
				routeId: "/app/admin",
				requirements: [{ id: "admin-oidc", kind: "frontend_oidc" }],
			},
		]);

		// Resolve parent's requirement.
		orchestrator.resolve({
			requirementId: "session",
			status: ResolutionStatus.Fulfilled,
		});

		// Child's requirement is now pending.
		const snap = orchestrator.snapshot();
		expect(snap.pendingRequirement?.id).toBe("admin-oidc");
		expect(snap.settled).toBe(false);
	});

	it("resolves all requirements and settles with onSettled callback", () => {
		const onSettled = vi.fn();
		const orchestrator = createRouteRequirementOrchestrator({ onSettled });

		orchestrator.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [{ id: "session", kind: "session" }],
			},
			{
				routeId: "/app/dashboard",
				requirements: [{ id: "api-token", kind: "backend_oidc" }],
			},
		]);

		orchestrator.resolve({
			requirementId: "session",
			status: ResolutionStatus.Fulfilled,
		});
		expect(onSettled).not.toHaveBeenCalled();

		orchestrator.resolve({
			requirementId: "api-token",
			status: ResolutionStatus.Fulfilled,
		});

		const snap = orchestrator.snapshot();
		expect(snap.settled).toBe(true);
		expect(snap.pendingRequirement).toBeNull();
		expect(onSettled).toHaveBeenCalledWith("/app/dashboard", expect.any(Array));
	});

	it("tracks chooser decisions", () => {
		const orchestrator = createRouteRequirementOrchestrator();

		orchestrator.activateMatchedRoutes([
			{
				routeId: "/settings",
				requirements: [{ id: "oidc", kind: "frontend_oidc" }],
			},
		]);

		orchestrator.applyChooserDecision({
			requirementId: "oidc",
			providerId: "google",
			metadata: { hint: "work-email" },
		});

		expect(orchestrator.decisions).toHaveLength(1);
		expect(orchestrator.decisions[0].providerId).toBe("google");
	});

	it("fires onPendingRequirement on activation and after each resolution", () => {
		const onPending = vi.fn();
		const orchestrator = createRouteRequirementOrchestrator({
			onPendingRequirement: onPending,
		});

		orchestrator.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [{ id: "first", kind: "session" }],
			},
			{
				routeId: "/app/page",
				requirements: [{ id: "second", kind: "backend_oidc" }],
			},
		]);

		// First pending fires on activation.
		expect(onPending).toHaveBeenCalledTimes(1);
		expect(onPending).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "first" }),
		);

		// Resolve first → second pending fires.
		orchestrator.resolve({
			requirementId: "first",
			status: ResolutionStatus.Fulfilled,
		});
		expect(onPending).toHaveBeenCalledTimes(2);
		expect(onPending).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "second" }),
		);
	});

	it("preserves shared-prefix resolutions on route chain transition", () => {
		const orchestrator = createRouteRequirementOrchestrator();

		// First: /app → /app/dashboard
		orchestrator.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [{ id: "session", kind: "session" }],
			},
			{
				routeId: "/app/dashboard",
				requirements: [{ id: "dash-token", kind: "backend_oidc" }],
			},
		]);

		// Resolve the shared parent requirement.
		orchestrator.resolve({
			requirementId: "session",
			status: ResolutionStatus.Fulfilled,
		});

		// Record a chooser decision for the shared session req.
		orchestrator.applyChooserDecision({
			requirementId: "session",
			providerId: "default",
		});

		// Transition: /app → /app/settings (parent stays, child changes).
		orchestrator.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [{ id: "session", kind: "session" }],
			},
			{
				routeId: "/app/settings",
				requirements: [{ id: "settings-oidc", kind: "frontend_oidc" }],
			},
		]);

		const snap = orchestrator.snapshot();
		// New leaf route.
		expect(snap.activeRouteId).toBe("/app/settings");
		// Shared "session" should be already resolved (preserved).
		expect(snap.plan?.resolved).toBe(1);
		// New child's requirement is pending.
		expect(snap.pendingRequirement?.id).toBe("settings-oidc");
		// Shared-prefix chooser decision should be preserved.
		expect(orchestrator.decisions).toHaveLength(1);
		expect(orchestrator.decisions[0].requirementId).toBe("session");
	});

	it("discards diverging decisions on route chain transition", () => {
		const orchestrator = createRouteRequirementOrchestrator();

		orchestrator.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [{ id: "session", kind: "session" }],
			},
			{
				routeId: "/app/dashboard",
				requirements: [{ id: "dash-token", kind: "backend_oidc" }],
			},
		]);

		orchestrator.resolve({
			requirementId: "session",
			status: ResolutionStatus.Fulfilled,
		});
		orchestrator.resolve({
			requirementId: "dash-token",
			status: ResolutionStatus.Fulfilled,
		});

		// Decision on the child route's requirement.
		orchestrator.applyChooserDecision({
			requirementId: "dash-token",
			providerId: "azure",
		});

		// Transition to a different child route.
		orchestrator.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [{ id: "session", kind: "session" }],
			},
			{
				routeId: "/app/profile",
				requirements: [{ id: "profile-req", kind: "custom" }],
			},
		]);

		// The dash-token decision should be discarded (diverging).
		expect(orchestrator.decisions).toHaveLength(0);
	});

	it("resets state on deactivateRoute", () => {
		const orchestrator = createRouteRequirementOrchestrator();

		orchestrator.activateMatchedRoutes([
			{
				routeId: "/app",
				requirements: [{ id: "s", kind: "session" }],
			},
		]);

		orchestrator.deactivateRoute();

		const snap = orchestrator.snapshot();
		expect(snap.activeRouteId).toBeNull();
		expect(snap.plan).toBeNull();
		expect(snap.settled).toBe(false);
		expect(snap.matchedRoutes).toHaveLength(0);
	});
});
