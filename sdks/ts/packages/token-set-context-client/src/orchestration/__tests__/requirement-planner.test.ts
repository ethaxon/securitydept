// Requirement planner — focused unit tests
//
// Tests for the headless multi-requirement orchestration planner.

import { describe, expect, it } from "vitest";
import {
	createRequirementPlanner,
	PlanStatus,
	RequirementKind,
	RequirementPlannerError,
	ResolutionStatus,
} from "../requirement-planner";

// ---------------------------------------------------------------------------
// Happy path — single requirement
// ---------------------------------------------------------------------------

describe("single requirement happy path", () => {
	it("starts with pending status and correct nextPending", () => {
		const planner = createRequirementPlanner({
			requirements: [{ id: "session", kind: RequirementKind.Session }],
		});

		const snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Pending);
		expect(snap.nextPending).toEqual({
			id: "session",
			kind: RequirementKind.Session,
		});
		expect(snap.total).toBe(1);
		expect(snap.resolved).toBe(0);
		expect(snap.resolutions).toHaveLength(0);
	});

	it("settles after resolving the single requirement", () => {
		const planner = createRequirementPlanner({
			requirements: [{ id: "session", kind: RequirementKind.Session }],
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
				{ id: "session", kind: RequirementKind.Session },
				{
					id: "api-token",
					kind: RequirementKind.BackendOidc,
					label: "API Token",
				},
				{ id: "user-oidc", kind: RequirementKind.FrontendOidc },
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
				{ id: "a", kind: RequirementKind.Session },
				{ id: "b", kind: RequirementKind.BackendOidc },
				{ id: "c", kind: RequirementKind.Custom },
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
				{ id: "a", kind: RequirementKind.Session },
				{ id: "b", kind: RequirementKind.BackendOidc },
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
				{ id: "session", kind: RequirementKind.Session, attributes: { x: 1 } },
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
				{ id: "a", kind: RequirementKind.Session },
				{ id: "b", kind: RequirementKind.BackendOidc },
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
		const requirements = [
			{ id: "session", kind: RequirementKind.Session as string },
		];
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
					{ id: "dup", kind: RequirementKind.Session },
					{ id: "dup", kind: RequirementKind.BackendOidc },
				],
			}),
		).toThrow(RequirementPlannerError);
	});

	it("throws when resolving after all requirements are settled", () => {
		const planner = createRequirementPlanner({
			requirements: [{ id: "only", kind: RequirementKind.Session }],
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
				{ id: "first", kind: RequirementKind.Session },
				{ id: "second", kind: RequirementKind.BackendOidc },
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
	it("RequirementKind values are stable", () => {
		expect(RequirementKind.Session).toBe("session");
		expect(RequirementKind.BackendOidc).toBe("backend_oidc");
		expect(RequirementKind.FrontendOidc).toBe("frontend_oidc");
		expect(RequirementKind.Custom).toBe("custom");
	});

	it("ResolutionStatus values are stable", () => {
		expect(ResolutionStatus.Fulfilled).toBe("fulfilled");
		expect(ResolutionStatus.Failed).toBe("failed");
		expect(ResolutionStatus.Skipped).toBe("skipped");
	});

	it("PlanStatus values are stable", () => {
		expect(PlanStatus.Pending).toBe("pending");
		expect(PlanStatus.Settled).toBe("settled");
	});
});
