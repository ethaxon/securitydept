// Multi-requirement orchestration baseline — contract evidence
//
// This file demonstrates that the headless orchestration primitive can drive
// a real multi-requirement flow: session → backend-oidc → custom.

import type {
	PlanStatus as PlanStatusType,
	RequirementKind as RequirementKindType,
	ResolutionStatus as ResolutionStatusType,
} from "@securitydept/token-set-context-client/orchestration";
import {
	createRequirementPlanner,
	PlanStatus,
	RequirementKind,
	RequirementPlannerError,
	ResolutionStatus,
} from "@securitydept/token-set-context-client/orchestration";
import { describe, expect, it } from "vitest";

// Type-level proof: named types are directly importable from the subpath.
// These assignments verify the type forms are usable, not just the value forms.
const _kindProof: RequirementKindType = RequirementKind.Session;
const _statusProof: ResolutionStatusType = ResolutionStatus.Fulfilled;
const _planProof: PlanStatusType = PlanStatus.Pending;
void _kindProof;
void _statusProof;
void _planProof;

// ===========================================================================
// 1. Adopter-facing reference flow: session → backend-oidc → settled
// ===========================================================================

describe("adopter-facing reference flow: session → backend-oidc → settled", () => {
	it("drives a complete two-requirement flow to settled", () => {
		// An adopter would define their requirements:
		const planner = createRequirementPlanner({
			requirements: [
				{
					id: "corp-session",
					kind: RequirementKind.Session,
					label: "Corporate SSO session",
				},
				{
					id: "api-access",
					kind: RequirementKind.BackendOidc,
					label: "API access token",
					attributes: { audience: "https://api.example.com" },
				},
			],
		});

		// Step 1: Check what's needed.
		let snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Pending);
		expect(snap.nextPending?.id).toBe("corp-session");
		expect(snap.nextPending?.kind).toBe(RequirementKind.Session);

		// Step 2: Adopter performs SSO login... then resolves.
		planner.resolve({
			requirementId: "corp-session",
			status: ResolutionStatus.Fulfilled,
		});

		snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Pending);
		expect(snap.nextPending?.id).toBe("api-access");
		expect(snap.nextPending?.kind).toBe(RequirementKind.BackendOidc);
		expect(snap.resolved).toBe(1);

		// Step 3: Adopter exchanges backend-oidc token... then resolves.
		planner.resolve({
			requirementId: "api-access",
			status: ResolutionStatus.Fulfilled,
		});

		snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Settled);
		expect(snap.nextPending).toBeNull();
		expect(snap.resolved).toBe(2);
		expect(snap.total).toBe(2);
	});
});

// ===========================================================================
// 2. Mixed resolution statuses
// ===========================================================================

describe("mixed resolution reference flow", () => {
	it("handles skipped and failed requirements gracefully", () => {
		const planner = createRequirementPlanner({
			requirements: [
				{ id: "primary-session", kind: RequirementKind.Session },
				{
					id: "optional-analytics",
					kind: RequirementKind.Custom,
					label: "Analytics token (optional)",
				},
				{ id: "main-api", kind: RequirementKind.BackendOidc },
			],
		});

		// Primary session: fulfilled.
		planner.resolve({
			requirementId: "primary-session",
			status: ResolutionStatus.Fulfilled,
		});

		// Optional analytics: skipped.
		planner.resolve({
			requirementId: "optional-analytics",
			status: ResolutionStatus.Skipped,
			reason: "User declined analytics consent",
		});

		// Main API: failed.
		planner.resolve({
			requirementId: "main-api",
			status: ResolutionStatus.Failed,
			reason: "Token endpoint returned 503",
		});

		const snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Settled);
		expect(snap.resolutions).toHaveLength(3);

		// The adopter can now inspect resolutions to decide what to do.
		const failed = snap.resolutions.filter(
			(r) => r.status === ResolutionStatus.Failed,
		);
		expect(failed).toHaveLength(1);
		expect(failed[0].requirementId).toBe("main-api");
	});
});

// ===========================================================================
// 3. Reset and retry
// ===========================================================================

describe("reset and retry flow", () => {
	it("allows retrying a failed plan after reset", () => {
		const planner = createRequirementPlanner({
			requirements: [
				{ id: "session", kind: RequirementKind.Session },
				{ id: "api", kind: RequirementKind.BackendOidc },
			],
		});

		// First attempt: session fails.
		planner.resolve({
			requirementId: "session",
			status: ResolutionStatus.Failed,
			reason: "Network timeout",
		});
		planner.resolve({
			requirementId: "api",
			status: ResolutionStatus.Skipped,
			reason: "Session failed",
		});
		expect(planner.snapshot().status).toBe(PlanStatus.Settled);

		// Reset and retry.
		planner.reset();

		const snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Pending);
		expect(snap.nextPending?.id).toBe("session");
		expect(snap.resolved).toBe(0);

		// Second attempt: both succeed.
		planner.resolve({
			requirementId: "session",
			status: ResolutionStatus.Fulfilled,
		});
		planner.resolve({
			requirementId: "api",
			status: ResolutionStatus.Fulfilled,
		});
		expect(planner.snapshot().status).toBe(PlanStatus.Settled);
		expect(planner.snapshot().resolved).toBe(2);
	});
});

// ===========================================================================
// 4. Error handling
// ===========================================================================

describe("error handling in orchestration flow", () => {
	it("prevents out-of-order resolution", () => {
		const planner = createRequirementPlanner({
			requirements: [
				{ id: "first", kind: RequirementKind.Session },
				{ id: "second", kind: RequirementKind.BackendOidc },
			],
		});

		expect(() =>
			planner.resolve({
				requirementId: "second",
				status: ResolutionStatus.Fulfilled,
			}),
		).toThrow(RequirementPlannerError);
	});

	it("prevents double resolution after settled", () => {
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
});
