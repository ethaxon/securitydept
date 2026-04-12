// Multi-requirement orchestration baseline — contract evidence
//
// This file demonstrates that the headless orchestration primitive can drive
// a real multi-requirement flow: session → backend-oidc → custom.
//
// Canonical import: @securitydept/client/auth-coordination
// (moved from @securitydept/token-set-context-client/orchestration in iteration 102)

import type {
	PlanStatus as PlanStatusType,
	ResolutionStatus as ResolutionStatusType,
} from "@securitydept/client/auth-coordination";
import {
	createRequirementPlanner,
	PlanStatus,
	RequirementPlannerError,
	ResolutionStatus,
} from "@securitydept/client/auth-coordination";
import { describe, expect, it } from "vitest";

// Type-level proof: named types are directly importable from the new canonical subpath.
const _statusProof: ResolutionStatusType = ResolutionStatus.Fulfilled;
const _planProof: PlanStatusType = PlanStatus.Pending;
void _statusProof;
void _planProof;

// ===========================================================================
// 1. Adopter-facing reference flow: session → backend-oidc → settled
// ===========================================================================

describe("adopter-facing reference flow: session → backend-oidc → settled", () => {
	it("drives a complete two-requirement flow to settled", () => {
		// An adopter would define their requirements using plain kind strings:
		const planner = createRequirementPlanner({
			requirements: [
				{
					id: "corp-session",
					kind: "session",
					label: "Corporate SSO session",
				},
				{
					id: "api-access",
					kind: "backend_oidc",
					label: "API access token",
					attributes: { audience: "https://api.example.com" },
				},
			],
		});

		// Step 1: Check what's needed.
		let snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Pending);
		expect(snap.nextPending?.id).toBe("corp-session");
		expect(snap.nextPending?.kind).toBe("session");

		// Step 2: Adopter performs SSO login... then resolves.
		planner.resolve({
			requirementId: "corp-session",
			status: ResolutionStatus.Fulfilled,
		});

		snap = planner.snapshot();
		expect(snap.status).toBe(PlanStatus.Pending);
		expect(snap.nextPending?.id).toBe("api-access");
		expect(snap.nextPending?.kind).toBe("backend_oidc");
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
				{ id: "primary-session", kind: "session" },
				{
					id: "optional-analytics",
					kind: "custom",
					label: "Analytics token (optional)",
				},
				{ id: "main-api", kind: "backend_oidc" },
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
			(r: { status: string }) => r.status === ResolutionStatus.Failed,
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
				{ id: "session", kind: "session" },
				{ id: "api", kind: "backend_oidc" },
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
				{ id: "first", kind: "session" },
				{ id: "second", kind: "backend_oidc" },
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
			requirements: [{ id: "only", kind: "session" }],
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
