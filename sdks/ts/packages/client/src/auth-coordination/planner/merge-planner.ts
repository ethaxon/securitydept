// Merge requirement planner — concatenation of multiple planners
//
// Canonical public export: @securitydept/client
//
// Concatenates source planners in order. Overlapping ids follow Map semantics:
// the later source wins for the same key.

import { type AuthRequirement, type RequirementBehaviour } from "../contract";
import { type RequirementPlannerHost } from "../planner-host";
import { BaseRequirementPlanner } from "./base-planner";

/**
 * A planner whose effective requirements are the ordered union of its source
 * planners. Overlapping ids follow Map semantics (later source wins).
 *
 * @example
 * ```ts
 * const planner = MergeRequirementPlanner.fromPlanners(host, [
 *   sessionPlanner,
 *   oidcPlanner,
 * ]);
 * ```
 */
export class MergeRequirementPlanner<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
	TBehaviour extends Partial<
		RequirementBehaviour<TAuthRequirement, TPlanContext>
	> = Partial<RequirementBehaviour<TAuthRequirement, TPlanContext>>,
> extends BaseRequirementPlanner<TAuthRequirement, TPlanContext, TBehaviour> {
	private readonly sources: readonly BaseRequirementPlanner<
		TAuthRequirement,
		TPlanContext,
		TBehaviour
	>[];

	get planContext(): TPlanContext {
		return Object.assign(
			{},
			...this.sources.map((source) => source.planContext),
		);
	}

	protected constructor(
		host: RequirementPlannerHost<TBehaviour>,
		sources: readonly BaseRequirementPlanner<
			TAuthRequirement,
			TPlanContext,
			TBehaviour
		>[],
	) {
		super(host);
		this.sources = sources;
	}

	/** Create a merge planner from an ordered list of source planners. */
	static fromPlanners<
		TAuthRequirement extends AuthRequirement = AuthRequirement,
		TPlanContext = {},
		TBehaviour extends Partial<
			RequirementBehaviour<TAuthRequirement, TPlanContext>
		> = Partial<RequirementBehaviour<TAuthRequirement, TPlanContext>>,
	>(
		host: RequirementPlannerHost<TBehaviour>,
		planners: readonly BaseRequirementPlanner<
			TAuthRequirement,
			TPlanContext,
			TBehaviour
		>[],
	): MergeRequirementPlanner<TAuthRequirement, TPlanContext, TBehaviour> {
		return new MergeRequirementPlanner(host, planners);
	}

	protected async buildRequirementList(): Promise<
		Map<string, TAuthRequirement>
	> {
		const map = new Map<string, TAuthRequirement>();
		for (const source of this.sources) {
			for (const requirement of await source.resolveRequirementList()) {
				map.set(requirement.id, requirement);
			}
		}
		return map;
	}
}
