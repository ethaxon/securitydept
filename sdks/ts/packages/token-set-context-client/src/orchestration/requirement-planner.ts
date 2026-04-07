// Multi-requirement orchestration — headless requirement planner
//
// This module provides a minimal, mode-agnostic, headless primitive for
// expressing multi-requirement / multi-OIDC orchestration flows.
//
// Core concept:
//   1. Define a list of AuthRequirements (e.g. "need session", "need backend-oidc token")
//   2. The RequirementPlanner tells you which requirement is pending next
//   3. When a requirement is resolved, it advances to the next one
//   4. When all are resolved, the plan is settled
//
// The planner is intentionally headless — it does NOT:
//   - Know about specific auth modes or protocols
//   - Render UI or manage popup/redirect flows
//   - Own cross-tab state or leader election
//
// It is the adopter's (or a higher-level coordinator's) responsibility to
// translate "next pending requirement" into the appropriate auth action.

// ---------------------------------------------------------------------------
// Requirement kinds
// ---------------------------------------------------------------------------

/** Well-known requirement kind identifiers. */
export const RequirementKind = {
	Session: "session",
	BackendOidc: "backend_oidc",
	FrontendOidc: "frontend_oidc",
	Custom: "custom",
} as const;

export type RequirementKind =
	(typeof RequirementKind)[keyof typeof RequirementKind];

// ---------------------------------------------------------------------------
// Requirement definition
// ---------------------------------------------------------------------------

/** A single auth requirement within an orchestration plan. */
export interface AuthRequirement {
	/** Unique identifier for this requirement within the plan. */
	id: string;
	/** The kind of auth requirement. */
	kind: RequirementKind | (string & {});
	/** Human-readable label (for logging / debugging). */
	label?: string;
	/** Arbitrary metadata the adopter can attach. */
	attributes?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Resolution
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

// ---------------------------------------------------------------------------
// Plan state
// ---------------------------------------------------------------------------

/** Overall plan status. */
export const PlanStatus = {
	/** There are still pending requirements. */
	Pending: "pending",
	/** All requirements have been resolved. */
	Settled: "settled",
} as const;

export type PlanStatus = (typeof PlanStatus)[keyof typeof PlanStatus];

/** Internal state for a single requirement within the plan. */
interface RequirementState {
	requirement: AuthRequirement;
	resolution: RequirementResolution | null;
}

/** Read-only snapshot of the current plan state. */
export interface PlanSnapshot {
	/** Overall plan status. */
	status: PlanStatus;
	/** The next pending requirement, or `null` if settled. */
	nextPending: AuthRequirement | null;
	/** All resolutions collected so far (in order). */
	resolutions: readonly RequirementResolution[];
	/** Total requirement count. */
	total: number;
	/** Number of resolved requirements. */
	resolved: number;
}

// ---------------------------------------------------------------------------
// Planner errors
// ---------------------------------------------------------------------------

/** Error thrown when a planner operation is invalid. */
export class RequirementPlannerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RequirementPlannerError";
	}
}

// ---------------------------------------------------------------------------
// RequirementPlanner
// ---------------------------------------------------------------------------

/** Options for creating a {@link RequirementPlanner}. */
export interface CreateRequirementPlannerOptions {
	/** Ordered list of requirements to fulfill. */
	requirements: readonly AuthRequirement[];
}

/**
 * Headless multi-requirement planner.
 *
 * Drives a sequential requirement fulfillment flow:
 *   1. Call {@link snapshot} to see what's pending.
 *   2. Resolve the {@link PlanSnapshot.nextPending} requirement.
 *   3. Call {@link resolve} with the result.
 *   4. Repeat until {@link PlanSnapshot.status} is `"settled"`.
 *
 * @example
 * ```ts
 * const planner = createRequirementPlanner({
 *   requirements: [
 *     { id: "session", kind: RequirementKind.Session },
 *     { id: "api-token", kind: RequirementKind.BackendOidc },
 *   ],
 * });
 *
 * let snap = planner.snapshot();
 * while (snap.status === PlanStatus.Pending) {
 *   const req = snap.nextPending!;
 *   // ... perform auth action for req.kind ...
 *   planner.resolve({ requirementId: req.id, status: ResolutionStatus.Fulfilled });
 *   snap = planner.snapshot();
 * }
 * // snap.status === PlanStatus.Settled
 * ```
 */
export interface RequirementPlanner {
	/** Get a read-only snapshot of the current plan state. */
	snapshot(): PlanSnapshot;
	/** Resolve the next pending requirement. */
	resolve(resolution: RequirementResolution): void;
	/** Reset the planner to its initial state. */
	reset(): void;
}

/**
 * Create a headless requirement planner.
 *
 * @see {@link RequirementPlanner} for usage.
 */
export function createRequirementPlanner(
	options: CreateRequirementPlannerOptions,
): RequirementPlanner {
	if (options.requirements.length === 0) {
		throw new RequirementPlannerError(
			"Cannot create a planner with zero requirements",
		);
	}

	// Validate uniqueness of requirement IDs.
	const ids = new Set<string>();
	for (const req of options.requirements) {
		if (ids.has(req.id)) {
			throw new RequirementPlannerError(
				`Duplicate requirement ID: "${req.id}"`,
			);
		}
		ids.add(req.id);
	}

	let states: RequirementState[] = [];

	/** Shallow-clone a requirement to prevent external mutation. */
	function cloneRequirement(r: AuthRequirement): AuthRequirement {
		return {
			...r,
			attributes: r.attributes ? { ...r.attributes } : undefined,
		};
	}

	function initStates(): void {
		states = options.requirements.map((r) => ({
			requirement: cloneRequirement(r),
			resolution: null,
		}));
	}

	initStates();

	function findNextPending(): RequirementState | null {
		return states.find((s) => s.resolution === null) ?? null;
	}

	return {
		snapshot(): PlanSnapshot {
			const next = findNextPending();
			const resolutions: RequirementResolution[] = [];
			for (const s of states) {
				if (s.resolution !== null) resolutions.push({ ...s.resolution });
			}
			return {
				status: next === null ? PlanStatus.Settled : PlanStatus.Pending,
				nextPending: next ? cloneRequirement(next.requirement) : null,
				resolutions,
				total: states.length,
				resolved: resolutions.length,
			};
		},

		resolve(resolution: RequirementResolution): void {
			const next = findNextPending();
			if (next === null) {
				throw new RequirementPlannerError(
					"Cannot resolve: all requirements are already settled",
				);
			}
			if (resolution.requirementId !== next.requirement.id) {
				throw new RequirementPlannerError(
					`Cannot resolve requirement "${resolution.requirementId}": ` +
						`the next pending requirement is "${next.requirement.id}"`,
				);
			}
			next.resolution = resolution;
		},

		reset(): void {
			initStates();
		},
	};
}
