// Auth coordination contracts — serializable types and pure composition helpers
//
// Canonical public export: @securitydept/client
//
// This module owns the headless, framework-agnostic vocabulary shared across
// the requirement planner host and planner variants:
//   - AuthRequirement declarations (serializable)
//   - Resolution / status value domains
//   - Behaviour callback signatures (implemented by RequirementPlannerHost)
//   - Route composition strategy and the pure folding function
//   - Pipeline result shapes
//
// It contains no runtime coordination logic — only types, value constants,
// frozen factories, and the side-effect-free composition function.

import { v7 as uuidv7 } from "uuid";
import { type FoundationEnvironment } from "../environment";

// ---------------------------------------------------------------------------
// Requirement declaration
// ---------------------------------------------------------------------------
export interface AuthRequirement {
	/** Unique entity id for this requirement within the plan. */
	readonly id: string;
	/** Human-readable label (for logging / debugging). */
	readonly label?: string;
}

export interface StaticAttrsAuthRequirementInput<
	TAttributes = Record<string, unknown>,
> {
	readonly id?: string;
	readonly label?: string;
	readonly attributes?: TAttributes;
}

export class StaticAttrsAuthRequirement<TAttributes = Record<string, unknown>>
	implements AuthRequirement
{
	protected constructor(
		readonly id: string,
		readonly label: string | undefined,
		readonly attributes: TAttributes | undefined,
	) {
		Object.freeze(this);
	}

	public static create<TAttributes = Record<string, unknown>>(
		input?: StaticAttrsAuthRequirementInput<TAttributes>,
	): StaticAttrsAuthRequirement<TAttributes> {
		return new StaticAttrsAuthRequirement<TAttributes>(
			input?.id ?? uuidv7(),
			input?.label,
			input?.attributes ? Object.freeze(input.attributes) : undefined,
		);
	}

	public static createList<TAttributes = Record<string, unknown>>(
		inputs: readonly StaticAttrsAuthRequirementInput<TAttributes>[],
	): readonly StaticAttrsAuthRequirement<TAttributes>[] {
		return inputs.map((input) => StaticAttrsAuthRequirement.create(input));
	}
}

// ---------------------------------------------------------------------------
// Resolution and status
// ---------------------------------------------------------------------------

/** Outcome of resolving a single requirement. */
export const ResolutionStatus = {
	Fulfilled: "fulfilled",
	Failed: "failed",
	Skipped: "skipped",
} as const;

export type ResolutionStatus =
	(typeof ResolutionStatus)[keyof typeof ResolutionStatus];

/** The resolution result for a single requirement. */
export interface RequirementResolution {
	/** The requirement ID this resolution applies to. */
	requirementId: string;
	/** Outcome status. */
	status: ResolutionStatus;
	/** Optional error or reason for failure/skip. */
	reason?: string;
}

/** Overall plan status. */
export const PlanStatus = {
	/** There are still pending requirements. */
	Pending: "pending",
	/** All requirements have been resolved. */
	Settled: "settled",
} as const;

export type PlanStatus = (typeof PlanStatus)[keyof typeof PlanStatus];

/** Error thrown when a planner contract is violated (e.g. duplicate ids). */
export class RequirementPlannerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RequirementPlannerError";
	}
}

// ---------------------------------------------------------------------------
// Behaviour callbacks (implemented by RequirementPlannerHost)
// ---------------------------------------------------------------------------

/** Result of an authentication check. */
export type AuthenticatedCheck = boolean | Promise<boolean>;

/**
 * Return value of an unauthenticated handler.
 *
 * - `true` — the requirement is now satisfied (resolved as fulfilled);
 *   the pipeline records the resolution and may continue.
 * - `false` — block: the requirement cannot proceed.
 * - `string` — redirect to the given location.
 * - A never-settling `Promise` — used when a full-page external redirect has
 *   started; the step intentionally never resolves so the host navigation is
 *   not finalized while the page is leaving.
 */
export type UnauthenticatedAction =
	| boolean
	| string
	| Promise<boolean | string>;

/**
 * Behaviour evaluation context handed to every behaviour callback.
 *
 * Reflects the planner state at the moment the callback is invoked.
 */
export type RequirementBehaviourContext<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
> = {
	readonly planContext: TPlanContext;
	readonly environment: FoundationEnvironment;
	/** The full effective requirement list for the active plan. */
	readonly requirements: readonly TAuthRequirement[];
	/** Resolutions collected so far (in requirement order). */
	readonly resolutionList: readonly RequirementResolution[];
};

/** Stream of unauthenticated requirements discovered by the planner. */
export type RequirementCandidateGenerator<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
> = AsyncGenerator<TAuthRequirement, void, unknown>;

/**
 * Context handed to candidate selection.
 *
 * `candidateList` is intentionally a stream: selectors that can act on the
 * first available unauthenticated requirement do not need to wait for all
 * checks to complete, while chooser-style selectors can still collect the full
 * stream with `for await`.
 */
export type RequirementCandidateSelectionContext<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
> = RequirementBehaviourContext<TAuthRequirement, TPlanContext> & {
	/** Requirements not yet satisfied, yielded as their checks complete. */
	readonly candidateList: RequirementCandidateGenerator<TAuthRequirement>;
};

/** Decide whether a single requirement is already satisfied. */
export type CheckAuthenticated<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
> = (
	requirement: TAuthRequirement,
	context: RequirementBehaviourContext<TAuthRequirement, TPlanContext>,
) => AuthenticatedCheck;

/** Decide what to do when a selected requirement is unauthenticated. */
export type OnUnauthenticated<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
> = (
	requirement: TAuthRequirement,
	context: RequirementBehaviourContext<TAuthRequirement, TPlanContext>,
) => UnauthenticatedAction;

/**
 * Reduce the candidate set to the single requirement to act on next.
 *
 * The default strategy picks the first unauthenticated candidate yielded by the
 * stream. Chooser-style strategies may collect the full stream when they need
 * a complete candidate set.
 */
export type SelectCandidate<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
> = (
	context: RequirementCandidateSelectionContext<TAuthRequirement, TPlanContext>,
) => TAuthRequirement | undefined | Promise<TAuthRequirement | undefined>;

/** The full behaviour contract resolved by a planner host. */
export interface RequirementBehaviour<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
> {
	checkAuthenticated: CheckAuthenticated<TAuthRequirement, TPlanContext>;
	onUnauthenticated: OnUnauthenticated<TAuthRequirement, TPlanContext>;
	selectCandidate: SelectCandidate<TAuthRequirement, TPlanContext>;
}

export interface RouteStateSnapshotTrait {
	readonly url: string;
}

export interface RouteBehaviourContextExtra {
	readonly routeState: RouteStateSnapshotTrait;
}

export function isRouteStateSnapshotTrait(
	value: unknown,
): value is RouteStateSnapshotTrait {
	return typeof value === "object" && value !== null && "url" in value;
}

export function isRouteBehaviourContextExtra(
	value: unknown,
): value is RouteBehaviourContextExtra {
	return (
		typeof value === "object" &&
		value !== null &&
		"routeState" in value &&
		isRouteStateSnapshotTrait(value.routeState)
	);
}

export type RequirementBehaviourWithRouteContext<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
> = RequirementBehaviour<TAuthRequirement, RouteBehaviourContextExtra>;

// ---------------------------------------------------------------------------
// Pipeline results
// ---------------------------------------------------------------------------

/** Outcome of a pipeline step or run. */
export const PipelineOutcome = {
	/** No candidates remain — the plan is satisfied. */
	Settled: "settled",
	/** A candidate was resolved as fulfilled; more may remain. */
	Resolved: "resolved",
	/** A candidate's handler blocked progress. */
	Blocked: "blocked",
	/** A candidate's handler requested a redirect. */
	Redirect: "redirect",
} as const;

export type PipelineOutcome =
	(typeof PipelineOutcome)[keyof typeof PipelineOutcome];

/** Result of a single {@link BaseRequirementPlanner.runStep}. */
export type PipelineStepResult<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
> =
	| { outcome: typeof PipelineOutcome.Settled }
	| { outcome: typeof PipelineOutcome.Resolved; requirement: TAuthRequirement }
	| { outcome: typeof PipelineOutcome.Blocked; requirement: TAuthRequirement }
	| {
			outcome: typeof PipelineOutcome.Redirect;
			requirement: TAuthRequirement;
			location: string;
	  };

/** Result of {@link BaseRequirementPlanner.runUntilSettled}. */
export type PipelineRunResult<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
> =
	| {
			outcome: typeof PipelineOutcome.Settled;
			resolutions: readonly RequirementResolution[];
	  }
	| { outcome: typeof PipelineOutcome.Blocked; requirement: TAuthRequirement }
	| {
			outcome: typeof PipelineOutcome.Redirect;
			requirement: TAuthRequirement;
			location: string;
	  };

// ---------------------------------------------------------------------------
// Route composition
// ---------------------------------------------------------------------------

/**
 * How a route segment's requirements compose with the inherited parent chain.
 *
 * - `inherit` — keep the parent requirements unchanged (segment adds nothing)
 * - `merge` — inherit parent requirements, then append/override with the
 *   segment's own (same-id entries replace the parent's)
 * - `replace` — discard the parent chain, use only the segment's requirements
 */
export const RequirementsComposition = {
	Inherit: "inherit",
	Merge: "merge",
	Replace: "replace",
} as const;

export type RequirementsComposition =
	(typeof RequirementsComposition)[keyof typeof RequirementsComposition];

/** A single node in a matched route chain. */
export interface RouteTreeSegment<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
> {
	/** Route segment identifier (e.g. route name or path pattern). */
	routeId: string;
	/** Auth requirements declared on this route segment. */
	requirements: readonly TAuthRequirement[];
	/** Composition strategy against the inherited chain. Defaults to `merge`. */
	composition?: RequirementsComposition;
}

/** A requirements declaration annotated with its composition strategy. */
export interface RouteRequirementsDeclaration<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
> {
	composition: RequirementsComposition;
	requirements: readonly TAuthRequirement[];
}

/**
 * Apply a route requirements declaration onto an effective requirement map.
 *
 * Reuse `effective` across a route chain so merge/replace fold in O(total
 * requirements) without rebuilding parent state each segment. When omitted, a
 * fresh map is created for one-shot composition.
 */
export function resolveEffectiveRequirements<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
>(
	child: RouteRequirementsDeclaration<TAuthRequirement>,
	effective: Map<string, TAuthRequirement> = new Map(),
): Map<string, TAuthRequirement> {
	switch (child.composition) {
		case RequirementsComposition.Inherit:
			return effective;

		case RequirementsComposition.Merge:
			for (const requirement of child.requirements) {
				effective.set(requirement.id, requirement);
			}
			return effective;

		case RequirementsComposition.Replace:
			effective.clear();
			for (const requirement of child.requirements) {
				effective.set(requirement.id, requirement);
			}
			return effective;

		default: {
			const _exhaustive: never = child.composition;
			throw new RequirementPlannerError(
				`Unknown requirements composition: ${String(_exhaustive)}`,
			);
		}
	}
}
