// Multi-requirement orchestration baseline — contract evidence
//
// This file demonstrates that the headless orchestration primitive can drive
// a real multi-requirement flow: session → backend-oidc → custom.
//
// Canonical import: @securitydept/client
// (consolidated from @securitydept/token-set-context-client/orchestration)

import {
	createAuthRequirement,
	PlanStatus,
	type PlanStatus as PlanStatusType,
	RequirementPlanner,
	RequirementPlannerError,
	ResolutionStatus,
	type ResolutionStatus as ResolutionStatusType,
} from "@securitydept/client";
import { describe, expect, it } from "vitest";

// Type-level proof: named types are directly importable from the canonical root export.
const _statusProof: ResolutionStatusType = ResolutionStatus.Fulfilled;
const _planProof: PlanStatusType = PlanStatus.Pending;
void _statusProof;
void _planProof;

// ===========================================================================
// 1. Adopter-facing reference flow: session → backend-oidc → settled
// ===========================================================================

describe("adopter-facing reference flow: session → backend-oidc → settled", () => {
	it("drives a complete two-requirement flow to settled", () => {
		const planner = RequirementPlanner.fromRequirements([
			createAuthRequirement({
				id: "corp-session",
				label: "Corporate SSO session",
				attributes: { mode: "session" },
			}),
			createAuthRequirement({
				id: "api-access",
				label: "API access token",
				attributes: {
					mode: "backend_oidc",
					audience: "https://api.example.com",
				},
			}),
		]);

		expect(planner.status).toBe(PlanStatus.Pending);
		expect(planner.nextPending?.id).toBe("corp-session");
		expect(planner.nextPending?.attributes?.mode).toBe("session");

		planner.resolve({
			requirementId: "corp-session",
			status: ResolutionStatus.Fulfilled,
		});

		expect(planner.status).toBe(PlanStatus.Pending);
		expect(planner.nextPending?.id).toBe("api-access");
		expect(planner.nextPending?.attributes?.mode).toBe("backend_oidc");
		expect(planner.resolved).toBe(1);

		planner.resolve({
			requirementId: "api-access",
			status: ResolutionStatus.Fulfilled,
		});

		expect(planner.status).toBe(PlanStatus.Settled);
		expect(planner.nextPending).toBeNull();
		expect(planner.resolved).toBe(2);
		expect(planner.total).toBe(2);
	});
});

// ===========================================================================
// 2. Mixed resolution statuses
// ===========================================================================

describe("mixed resolution reference flow", () => {
	it("handles skipped and failed requirements gracefully", () => {
		const planner = RequirementPlanner.fromRequirements([
			createAuthRequirement({
				id: "primary-session",
				attributes: { mode: "session" },
			}),
			createAuthRequirement({
				id: "optional-analytics",
				label: "Analytics token (optional)",
				attributes: { mode: "custom" },
			}),
			createAuthRequirement({
				id: "main-api",
				attributes: { mode: "backend_oidc" },
			}),
		]);

		planner.resolve({
			requirementId: "primary-session",
			status: ResolutionStatus.Fulfilled,
		});

		planner.resolve({
			requirementId: "optional-analytics",
			status: ResolutionStatus.Skipped,
			reason: "User declined analytics consent",
		});

		planner.resolve({
			requirementId: "main-api",
			status: ResolutionStatus.Failed,
			reason: "Token endpoint returned 503",
		});

		expect(planner.status).toBe(PlanStatus.Settled);
		expect(planner.resolutions).toHaveLength(3);

		const failed = planner.resolutions.filter(
			(resolution) => resolution.status === ResolutionStatus.Failed,
		);
		expect(failed).toHaveLength(1);
		expect(failed[0].requirementId).toBe("main-api");
	});
});

// ===========================================================================
// 4. Error handling
// ===========================================================================

describe("error handling in orchestration flow", () => {
	it("allows resolving any still-pending requirement by id", () => {
		const planner = RequirementPlanner.fromRequirements([
			createAuthRequirement({
				id: "first",
				attributes: { mode: "session" },
			}),
			createAuthRequirement({
				id: "second",
				attributes: { mode: "backend_oidc" },
			}),
		]);

		planner.resolve({
			requirementId: "second",
			status: ResolutionStatus.Fulfilled,
		});

		expect(planner.nextPending?.id).toBe("first");
	});

	it("ignores duplicate resolution after settled", () => {
		const planner = RequirementPlanner.fromRequirements([
			createAuthRequirement({
				id: "only",
				attributes: { mode: "session" },
			}),
		]);

		planner.resolve({
			requirementId: "only",
			status: ResolutionStatus.Fulfilled,
		});

		planner.resolve({
			requirementId: "only",
			status: ResolutionStatus.Fulfilled,
		});

		expect(planner.status).toBe(PlanStatus.Settled);
		expect(planner.resolved).toBe(1);
	});
});
