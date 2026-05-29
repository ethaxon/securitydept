// Static requirement planner — fixed requirement list
//
// Canonical public export: @securitydept/client

import { type AuthRequirement } from "../contract";
import { type RequirementPlannerHost } from "../planner-host";
import { BaseRequirementPlanner } from "./base-planner";

/**
 * A planner whose effective requirement list is a fixed array supplied at
 * construction time.
 *
 * @example
 * ```ts
 * const planner = StaticRequirementPlanner.fromRequirements(host, [
 *   createAuthRequirement({ id: "session" }),
 * ]);
 * const plan = await planner.buildPlan();
 * await planner.checkUnauthenticatedCandidates(plan);
 * const step = await planner.runStep(plan);
 * // or: const result = await planner.runUntilSettled();
 * ```
 */
export class StaticRequirementPlanner extends BaseRequirementPlanner {
	private readonly staticRequirements: readonly AuthRequirement[];

	protected constructor(
		host: RequirementPlannerHost,
		requirements: readonly AuthRequirement[],
	) {
		super(host);
		this.staticRequirements = requirements;
	}

	/** Create a static planner from an ordered requirement list. */
	static fromRequirements(
		host: RequirementPlannerHost,
		requirements: readonly AuthRequirement[],
	): StaticRequirementPlanner {
		return new StaticRequirementPlanner(host, requirements);
	}

	protected buildRequirementList(): Map<string, AuthRequirement> {
		const map = new Map<string, AuthRequirement>();
		for (const requirement of this.staticRequirements) {
			map.set(requirement.id, requirement);
		}
		return map;
	}
}
