// Merge requirement planner — concatenation of multiple planners
//
// Canonical public export: @securitydept/client
//
// Concatenates source planners in order. Overlapping ids follow Map semantics:
// the later source wins for the same key.

import { type AuthRequirement } from "../contract";
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
export class MergeRequirementPlanner extends BaseRequirementPlanner {
	private readonly sources: readonly BaseRequirementPlanner[];

	protected constructor(
		host: RequirementPlannerHost,
		sources: readonly BaseRequirementPlanner[],
	) {
		super(host);
		this.sources = sources;
	}

	/** Create a merge planner from an ordered list of source planners. */
	static fromPlanners(
		host: RequirementPlannerHost,
		planners: readonly BaseRequirementPlanner[],
	): MergeRequirementPlanner {
		return new MergeRequirementPlanner(host, planners);
	}

	protected async buildRequirementList(): Promise<
		Map<string, AuthRequirement>
	> {
		const map = new Map<string, AuthRequirement>();
		for (const source of this.sources) {
			for (const requirement of await source.resolveRequirementList()) {
				map.set(requirement.id, requirement);
			}
		}
		return map;
	}
}
