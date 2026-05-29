// Route composition requirement planner — matched route chain folding
//
// Canonical public export: @securitydept/client
//
// Folds a matched route chain (root -> leaf) into a single effective
// requirement list, applying each segment's inherit/merge/replace composition.
//
// Route transitions are modeled as immutable construction: there is no in-place
// reset. A fresh instance is produced from the previous one, preserving the
// resolutions for the shared requirement prefix so cross-navigation progress is
// not lost while diverging requirements are re-planned.

import {
	type AuthRequirement,
	type RequirementResolution,
	RequirementsComposition,
	type RouteTreeSegment,
	resolveEffectiveRequirements,
} from "../contract";
import { type RequirementPlannerHost } from "../planner-host";
import { BaseRequirementPlanner, type RequirementPlan } from "./base-planner";

/** Fold a matched route chain into its effective requirement list. */
function foldSegments(
	segments: readonly RouteTreeSegment[],
): readonly AuthRequirement[] {
	const effective = new Map<string, AuthRequirement>();
	for (const segment of segments) {
		resolveEffectiveRequirements(
			{
				composition: segment.composition ?? RequirementsComposition.Merge,
				requirements: segment.requirements,
			},
			effective,
		);
	}
	return [...effective.values()];
}

/** Length of the shared requirement-id prefix between two effective lists. */
function sharedPrefixLength(
	previous: readonly AuthRequirement[],
	next: readonly AuthRequirement[],
): number {
	const limit = Math.min(previous.length, next.length);
	let shared = 0;
	while (shared < limit && previous[shared].id === next[shared].id) {
		shared += 1;
	}
	return shared;
}

/**
 * A planner driven by a matched route chain with composition semantics.
 *
 * Construct via {@link fromRootRoute} for the first activation, or
 * {@link fromActiveRoute} for a transition that preserves shared-prefix
 * resolutions from the previous planner instance.
 */
export class RouteCompositionRequirementPlanner extends BaseRequirementPlanner {
	private readonly _segments: readonly RouteTreeSegment[];
	private readonly _effective: readonly AuthRequirement[];

	protected constructor(
		host: RequirementPlannerHost,
		segments: readonly RouteTreeSegment[],
		preservedResolutions: readonly RequirementResolution[] = [],
	) {
		super(host, preservedResolutions);
		this._segments = segments;
		this._effective = foldSegments(segments);
	}

	/** Build a planner from a matched route chain (first activation). */
	static fromRootRoute(
		host: RequirementPlannerHost,
		segments: readonly RouteTreeSegment[],
	): RouteCompositionRequirementPlanner {
		return new RouteCompositionRequirementPlanner(host, segments);
	}

	/**
	 * Build a planner for a route transition, preserving resolutions for the
	 * shared requirement prefix carried over from `previousPlan`.
	 */
	static fromActiveRoute(
		host: RequirementPlannerHost,
		currentSegments: readonly RouteTreeSegment[],
		previousPlanner: RouteCompositionRequirementPlanner,
		previousPlan: RequirementPlan,
	): RouteCompositionRequirementPlanner {
		const nextEffective = foldSegments(currentSegments);
		const shared = sharedPrefixLength(
			previousPlanner.effectiveRequirements,
			nextEffective,
		);
		const sharedIds = new Set(
			nextEffective.slice(0, shared).map((requirement) => requirement.id),
		);
		const preserved = previousPlan.resolutionList.filter((resolution) =>
			sharedIds.has(resolution.requirementId),
		);
		return new RouteCompositionRequirementPlanner(
			host,
			currentSegments,
			preserved,
		);
	}

	/** The matched route chain backing this planner. */
	get segments(): readonly RouteTreeSegment[] {
		return this._segments;
	}

	/** The folded effective requirement list (composition applied). */
	get effectiveRequirements(): readonly AuthRequirement[] {
		return this._effective;
	}

	protected buildRequirementList(): Map<string, AuthRequirement> {
		return new Map(
			this._effective.map((requirement) => [requirement.id, requirement]),
		);
	}
}
