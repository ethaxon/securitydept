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

// ---------------------------------------------------------------------------
// Requirement declaration
// ---------------------------------------------------------------------------

/** Input for {@link createAuthRequirement}. */
export interface AuthRequirementInput {
	/**
	 * Opaque entity id within a plan or route composition scope.
	 *
	 * Pass explicitly when parent/child composition must target the same logical
	 * requirement. When omitted, a new uuidv7 id is assigned at creation time.
	 */
	id?: string;
	/** Human-readable label (for logging / debugging / chooser UI). */
	label?: string;
	/** Arbitrary serializable metadata for adapter-specific matching. */
	attributes?: Record<string, unknown>;
}

/** A single auth requirement within a plan. */
export interface AuthRequirement {
	/** Unique entity id for this requirement within the plan. */
	readonly id: string;
	/** Human-readable label (for logging / debugging). */
	readonly label?: string;
	/** Opaque metadata — not interpreted by the coordination layer. */
	readonly attributes?: Readonly<Record<string, unknown>>;
}

/**
 * Create an auth requirement with a stable or generated entity id.
 *
 * The returned object and its `attributes` object are frozen.
 */
export function createAuthRequirement(
	input: AuthRequirementInput = {},
): AuthRequirement {
	const attributes = input.attributes ? { ...input.attributes } : undefined;
	if (attributes !== undefined) {
		Object.freeze(attributes);
	}

	return Object.freeze({
		id: input.id ?? uuidv7(),
		label: input.label,
		attributes,
	});
}

/** Create multiple auth requirements in declaration order. */
export function createAuthRequirements(
	inputs: readonly AuthRequirementInput[],
): AuthRequirement[] {
	return inputs.map((input) => createAuthRequirement(input));
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
export interface RequirementBehaviourContext {
	/** The full effective requirement list for the active plan. */
	readonly requirements: readonly AuthRequirement[];
	/** Requirements not yet satisfied (the actionable set). */
	readonly candidateList: readonly AuthRequirement[];
	/** Resolutions collected so far (in requirement order). */
	readonly resolutionList: readonly RequirementResolution[];
}

/** Decide whether a single requirement is already satisfied. */
export type CheckAuthenticated = (
	requirement: AuthRequirement,
	context: RequirementBehaviourContext,
) => AuthenticatedCheck;

/** Decide what to do when a selected requirement is unauthenticated. */
export type OnUnauthenticated = (
	requirement: AuthRequirement,
	context: RequirementBehaviourContext,
) => UnauthenticatedAction;

/**
 * Reduce the candidate set to the single requirement to act on next.
 *
 * The default strategy picks `context.candidateList[0]` (declaration order).
 * Only invoked when `candidateList` is non-empty.
 */
export type SelectCandidate = (
	context: RequirementBehaviourContext,
) => AuthRequirement | Promise<AuthRequirement>;

/** The full behaviour contract resolved by a planner host. */
export interface RequirementBehaviour {
	checkAuthenticated: CheckAuthenticated;
	onUnauthenticated: OnUnauthenticated;
	selectCandidate: SelectCandidate;
}

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
export type PipelineStepResult =
	| { outcome: typeof PipelineOutcome.Settled }
	| { outcome: typeof PipelineOutcome.Resolved; requirement: AuthRequirement }
	| { outcome: typeof PipelineOutcome.Blocked; requirement: AuthRequirement }
	| {
			outcome: typeof PipelineOutcome.Redirect;
			requirement: AuthRequirement;
			location: string;
	  };

/** Result of {@link BaseRequirementPlanner.runUntilSettled}. */
export type PipelineRunResult =
	| {
			outcome: typeof PipelineOutcome.Settled;
			resolutions: readonly RequirementResolution[];
	  }
	| { outcome: typeof PipelineOutcome.Blocked; requirement: AuthRequirement }
	| {
			outcome: typeof PipelineOutcome.Redirect;
			requirement: AuthRequirement;
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
export interface RouteTreeSegment {
	/** Route segment identifier (e.g. route name or path pattern). */
	routeId: string;
	/** Auth requirements declared on this route segment. */
	requirements: readonly AuthRequirement[];
	/** Composition strategy against the inherited chain. Defaults to `merge`. */
	composition?: RequirementsComposition;
}

/** A requirements declaration annotated with its composition strategy. */
export interface RouteRequirementsDeclaration {
	composition: RequirementsComposition;
	requirements: readonly AuthRequirement[];
}

/**
 * Apply a route requirements declaration onto an effective requirement map.
 *
 * Reuse `effective` across a route chain so merge/replace fold in O(total
 * requirements) without rebuilding parent state each segment. When omitted, a
 * fresh map is created for one-shot composition.
 */
export function resolveEffectiveRequirements(
	child: RouteRequirementsDeclaration,
	effective: Map<string, AuthRequirement> = new Map(),
): Map<string, AuthRequirement> {
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
