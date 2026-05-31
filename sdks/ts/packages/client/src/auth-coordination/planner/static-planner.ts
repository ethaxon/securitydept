// Static requirement planner — fixed requirement list
//
// Canonical public export: @securitydept/client

import { type AuthRequirement, type RequirementBehaviour } from "../contract";
import { type RequirementPlannerHost } from "../planner-host";
import { BaseRequirementPlanner } from "./base-planner";

/**
 * A planner whose effective requirement list is a fixed array supplied at
 * construction time.
 *
 * @example
 * ```ts
 * const planner = StaticRequirementPlanner.fromRequirements(host, [
 *   StaticAttrsAuthRequirement.create({ id: "session" }),
 * ] as Readonly<AuthRequirement[]>);
 * const plan = await planner.buildPlan();
 * const step = await planner.runStep(plan);
 * // or: const result = await planner.runUntilSettled();
 * ```
 */
export class StaticRequirementPlanner<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<RequirementBehaviour<TAuthRequirement>> = Partial<
		RequirementBehaviour<TAuthRequirement>
	>,
> extends BaseRequirementPlanner<TAuthRequirement, {}, TBehaviour> {
	private readonly staticRequirements: readonly TAuthRequirement[];

	get planContext(): {} {
		return {};
	}

	protected constructor(
		host: RequirementPlannerHost<TBehaviour>,
		requirements: readonly TAuthRequirement[],
	) {
		super(host);
		this.staticRequirements = requirements;
	}

	/** Create a static planner from an ordered requirement list. */
	static fromRequirements<
		TAuthRequirement extends AuthRequirement = AuthRequirement,
		TBehaviour extends Partial<
			RequirementBehaviour<TAuthRequirement>
		> = Partial<RequirementBehaviour<TAuthRequirement>>,
	>(
		host: RequirementPlannerHost<TBehaviour>,
		requirements: readonly TAuthRequirement[],
	): StaticRequirementPlanner<TAuthRequirement, TBehaviour> {
		return new StaticRequirementPlanner(host, requirements);
	}

	protected buildRequirementList(): Map<string, TAuthRequirement> {
		const map = new Map<string, TAuthRequirement>();
		for (const requirement of this.staticRequirements) {
			map.set(requirement.id, requirement);
		}
		return map;
	}
}
