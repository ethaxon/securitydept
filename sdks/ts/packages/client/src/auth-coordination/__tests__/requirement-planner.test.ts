// Requirement planner — focused unit tests
//
// Tests for the headless multi-requirement orchestration planner.
// Migrated to import from the new canonical owner:
//   @securitydept/client/auth-coordination

import { describe, expect, it } from "vitest";
import {
	createRequirementPlanner,
	PlanStatus,
	RequirementPlannerError,
	ResolutionStatus,
} from "../index";

// Well-known kind strings (no longer using RequirementKind constant — kind is string)
const KIND_SESSION = "session";
const KIND_BACKEND_OIDC = "backend_oidc";
const KIND_FRONTEND_OIDC = "frontend_oidc";
const KIND_CUSTOM = "custom";

// ---------------------------------------------------------------------------
// Happy path — single requirement
// ---------------------------------------------------------------------------

describe("single requirement happy path", () => {
	it("starts with pending status and correct nextPending", () => {
		const planner = createRequirementPlanner({
			requirements: [{ id: "session", kind: KIND_SESSION }],
		});

		const snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Pending);
		expect(snap.nextPending).toEqual({
			id: "session",
			kind: KIND_SESSION,
		});
		expect(snap.total).toBe(1);
		expect(snap.resolved).toBe(0);
		expect(snap.resolutions).toHaveLength(0);
	});

	it("settles after resolving the single requirement", () => {
		const planner = createRequirementPlanner({
			requirements: [{ id: "session", kind: KIND_SESSION }],
		});

		planner.resolve({
			requirementId: "session",
			status: ResolutionStatus.Fulfilled,
		});

		const snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Settled);
		expect(snap.nextPending).toBeNull();
		expect(snap.resolved).toBe(1);
		expect(snap.resolutions).toHaveLength(1);
		expect(snap.resolutions[0].requirementId).toBe("session");
		expect(snap.resolutions[0].status).toBe(ResolutionStatus.Fulfilled);
	});
});

// ---------------------------------------------------------------------------
// Multi-requirement sequential progression
// ---------------------------------------------------------------------------

describe("multi-requirement sequential progression", () => {
	it("progresses through requirements in order", () => {
		const planner = createRequirementPlanner({
			requirements: [
				{ id: "session", kind: KIND_SESSION },
				{
					id: "api-token",
					kind: KIND_BACKEND_OIDC,
					label: "API Token",
				},
				{ id: "user-oidc", kind: KIND_FRONTEND_OIDC },
			],
		});

		// Step 0: first pending is "session".
		let snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Pending);
		expect(snap.nextPending?.id).toBe("session");
		expect(snap.total).toBe(3);
		expect(snap.resolved).toBe(0);

		// Step 1: resolve "session".
		planner.resolve({
			requirementId: "session",
			status: ResolutionStatus.Fulfilled,
		});
		snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Pending);
		expect(snap.nextPending?.id).toBe("api-token");
		expect(snap.resolved).toBe(1);

		// Step 2: resolve "api-token".
		planner.resolve({
			requirementId: "api-token",
			status: ResolutionStatus.Fulfilled,
		});
		snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Pending);
		expect(snap.nextPending?.id).toBe("user-oidc");
		expect(snap.resolved).toBe(2);

		// Step 3: resolve "user-oidc".
		planner.resolve({
			requirementId: "user-oidc",
			status: ResolutionStatus.Fulfilled,
		});
		snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Settled);
		expect(snap.nextPending).toBeNull();
		expect(snap.resolved).toBe(3);
		expect(snap.resolutions).toHaveLength(3);
	});

	it("records mixed statuses (fulfilled / skipped / failed)", () => {
		const planner = createRequirementPlanner({
			requirements: [
				{ id: "a", kind: KIND_SESSION },
				{ id: "b", kind: KIND_BACKEND_OIDC },
				{ id: "c", kind: KIND_CUSTOM },
			],
		});

		planner.resolve({
			requirementId: "a",
			status: ResolutionStatus.Fulfilled,
		});
		planner.resolve({
			requirementId: "b",
			status: ResolutionStatus.Skipped,
			reason: "Optional provider",
		});
		planner.resolve({
			requirementId: "c",
			status: ResolutionStatus.Failed,
			reason: "Network error",
		});

		const snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Settled);
		expect(snap.resolutions[0].status).toBe(ResolutionStatus.Fulfilled);
		expect(snap.resolutions[1].status).toBe(ResolutionStatus.Skipped);
		expect(snap.resolutions[1].reason).toBe("Optional provider");
		expect(snap.resolutions[2].status).toBe(ResolutionStatus.Failed);
		expect(snap.resolutions[2].reason).toBe("Network error");
	});
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

describe("reset", () => {
	it("restores the planner to initial state after reset", () => {
		const planner = createRequirementPlanner({
			requirements: [
				{ id: "a", kind: KIND_SESSION },
				{ id: "b", kind: KIND_BACKEND_OIDC },
			],
		});

		planner.resolve({
			requirementId: "a",
			status: ResolutionStatus.Fulfilled,
		});
		expect(planner.snapshot().resolved).toBe(1);

		planner.reset();

		const snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Pending);
		expect(snap.nextPending?.id).toBe("a");
		expect(snap.resolved).toBe(0);
		expect(snap.resolutions).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Snapshot isolation (defensive copy)
// ---------------------------------------------------------------------------

describe("snapshot isolation", () => {
	it("mutating nextPending from snapshot does not affect planner internals", () => {
		const planner = createRequirementPlanner({
			requirements: [
				{ id: "session", kind: KIND_SESSION, attributes: { x: 1 } },
			],
		});

		const snap = planner.snapshot();
		// Mutate the returned snapshot's nextPending.
		(snap.nextPending as { id: string }).id = "mutated";
		(snap.nextPending as { attributes: Record<string, unknown> }).attributes.x =
			999;

		// Planner internals must be unaffected.
		const snap2 = planner.snapshot();
		expect(snap2.nextPending?.id).toBe("session");
		expect(snap2.nextPending?.attributes?.x).toBe(1);
	});

	it("mutating resolutions from snapshot does not affect planner internals", () => {
		const planner = createRequirementPlanner({
			requirements: [
				{ id: "a", kind: KIND_SESSION },
				{ id: "b", kind: KIND_BACKEND_OIDC },
			],
		});

		planner.resolve({
			requirementId: "a",
			status: ResolutionStatus.Fulfilled,
		});

		const snap = planner.snapshot();
		// Mutate the returned resolution.
		(snap.resolutions[0] as { status: string }).status = "corrupted";

		// Planner internals must be unaffected.
		const snap2 = planner.snapshot();
		expect(snap2.resolutions[0].status).toBe(ResolutionStatus.Fulfilled);
	});

	it("mutating input requirements does not affect planner internals", () => {
		const requirements = [{ id: "session", kind: KIND_SESSION }];
		const planner = createRequirementPlanner({ requirements });

		// Mutate the original input array.
		requirements[0].id = "tampered";

		// Planner internals must be unaffected (cloned on construction).
		const snap = planner.snapshot();
		expect(snap.nextPending?.id).toBe("session");
	});
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

describe("failure paths", () => {
	it("throws on zero requirements", () => {
		expect(() => createRequirementPlanner({ requirements: [] })).toThrow(
			RequirementPlannerError,
		);
	});

	it("throws on duplicate requirement IDs", () => {
		expect(() =>
			createRequirementPlanner({
				requirements: [
					{ id: "dup", kind: KIND_SESSION },
					{ id: "dup", kind: KIND_BACKEND_OIDC },
				],
			}),
		).toThrow(RequirementPlannerError);
	});

	it("throws when resolving after all requirements are settled", () => {
		const planner = createRequirementPlanner({
			requirements: [{ id: "only", kind: KIND_SESSION }],
		});

		planner.resolve({
			requirementId: "only",
			status: ResolutionStatus.Fulfilled,
		});

		expect(() =>
			planner.resolve({
				requirementId: "only",
				status: ResolutionStatus.Fulfilled,
			}),
		).toThrow(RequirementPlannerError);
	});

	it("throws when resolving a wrong requirement ID", () => {
		const planner = createRequirementPlanner({
			requirements: [
				{ id: "first", kind: KIND_SESSION },
				{ id: "second", kind: KIND_BACKEND_OIDC },
			],
		});

		// Try to resolve "second" before "first".
		expect(() =>
			planner.resolve({
				requirementId: "second",
				status: ResolutionStatus.Fulfilled,
			}),
		).toThrow(RequirementPlannerError);
	});
});

// ---------------------------------------------------------------------------
// Constant values
// ---------------------------------------------------------------------------

describe("constant values", () => {
	it("ResolutionStatus values are stable", () => {
		expect(ResolutionStatus.Fulfilled).toBe("fulfilled");
		expect(ResolutionStatus.Failed).toBe("failed");
		expect(ResolutionStatus.Skipped).toBe("skipped");
	});

	it("PlanStatus values are stable", () => {
		expect(PlanStatus.Pending).toBe("pending");
		expect(PlanStatus.Settled).toBe("settled");
	});

	it("kind values are opaque strings — no RequirementKind constant in shared primitive", () => {
		// Kind is now a plain string in the shared primitive.
		// Each auth-context defines its own named constants if needed.
		const req = createRequirementPlanner({
			requirements: [{ id: "r", kind: "session" }],
		});
		expect(req.snapshot().nextPending?.kind).toBe("session");
	});
});
