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
	type RequirementBehaviourWithRouteContext,
	type RequirementResolution,
	RequirementsComposition,
	type RouteBehaviourContextExtra,
	type RouteStateSnapshotTrait,
	type RouteTreeSegment,
	resolveEffectiveRequirements,
} from "../contract";
import { type RequirementPlannerHost } from "../planner-host";
import { BaseRequirementPlanner, type RequirementPlan } from "./base-planner";

/** Fold a matched route chain into its effective requirement list. */
function foldSegments<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
>(
	segments: readonly RouteTreeSegment<TAuthRequirement>[],
): readonly TAuthRequirement[] {
	const effective = new Map<string, TAuthRequirement>();
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
 * Construct via {@link fromRouteSegments} for a matched route chain, or
 * {@link fromRouteTransition} for a transition that preserves shared-prefix
 * resolutions from the previous planner instance.
 */
export class RouteCompositionRequirementPlanner<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
> extends BaseRequirementPlanner<
	TAuthRequirement,
	RouteBehaviourContextExtra,
	TBehaviour
> {
	private readonly _segments: readonly RouteTreeSegment<TAuthRequirement>[];
	private readonly _effective: readonly TAuthRequirement[];
	private readonly _planContext: RouteBehaviourContextExtra;

	protected constructor(
		host: RequirementPlannerHost<TBehaviour>,
		segments: readonly RouteTreeSegment<TAuthRequirement>[],
		routeState: RouteStateSnapshotTrait,
		preservedResolutions: readonly RequirementResolution[] = [],
	) {
		super(host, preservedResolutions);
		this._segments = segments;
		this._effective = foldSegments(segments);
		this._planContext = Object.freeze({
			routeState: Object.freeze({ ...routeState }),
		});
	}

	/** Build a planner from a matched route chain. */
	static fromRouteSegments<
		TAuthRequirement extends AuthRequirement = AuthRequirement,
		TBehaviour extends Partial<
			RequirementBehaviourWithRouteContext<TAuthRequirement>
		> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
	>(
		host: RequirementPlannerHost<TBehaviour>,
		segments: readonly RouteTreeSegment<TAuthRequirement>[],
		routeState: RouteStateSnapshotTrait,
	): RouteCompositionRequirementPlanner<TAuthRequirement, TBehaviour> {
		return new RouteCompositionRequirementPlanner(host, segments, routeState);
	}

	/**
	 * Build a planner for a route transition, preserving resolutions for the
	 * shared requirement prefix carried over from `previousPlan`.
	 */
	static fromRouteTransition<
		TAuthRequirement extends AuthRequirement = AuthRequirement,
		TBehaviour extends Partial<
			RequirementBehaviourWithRouteContext<TAuthRequirement>
		> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
	>(
		host: RequirementPlannerHost<TBehaviour>,
		currentSegments: readonly RouteTreeSegment<TAuthRequirement>[],
		routeState: RouteStateSnapshotTrait,
		previousPlanner: RouteCompositionRequirementPlanner<
			TAuthRequirement,
			TBehaviour
		>,
		previousPlan: RequirementPlan<TAuthRequirement, RouteBehaviourContextExtra>,
	): RouteCompositionRequirementPlanner<TAuthRequirement, TBehaviour> {
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
			routeState,
			preserved,
		);
	}

	get planContext(): RouteBehaviourContextExtra {
		return this._planContext;
	}

	/** The matched route chain backing this planner. */
	get segments(): readonly RouteTreeSegment<TAuthRequirement>[] {
		return this._segments;
	}

	/** The folded effective requirement list (composition applied). */
	get effectiveRequirements(): readonly TAuthRequirement[] {
		return this._effective;
	}

	protected buildRequirementList(): Map<string, TAuthRequirement> {
		return new Map(
			this._effective.map((requirement) => [requirement.id, requirement]),
		);
	}
}
