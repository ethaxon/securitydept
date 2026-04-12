// Shared planner-host — route-scoped auth coordination host layer
//
// Canonical location: @securitydept/client/auth-coordination
//
// Provides the host-layer contract for multi-requirement auth guards:
//   - AuthGuardClientOption: a single requirement candidate with its
//     authentication check and unauthenticated action
//   - RequirementsClientSet / ScopedRequirementsClientSet: composable
//     requirement client collections with inherit/merge/replace semantics
//   - PlannerHost: the coordination contract that selects which pending
//     candidate to act on, built on RequirementPlanner for sequential
//     resolution discipline
//
// The planner-host is intentionally headless and framework-agnostic.
// Framework-specific provider/lookup (Angular DI, React Context) is handled
// by the framework adapter packages (@securitydept/client-angular,
// @securitydept/client-react).
//
// Architecture:
//   PlannerHost.evaluate() uses createRequirementPlanner() internally:
//   1. Build AuthRequirement[] from candidates' requirementId/kind/label/attributes
//   2. Auto-resolve already-authenticated requirements as Fulfilled
//   3. Ask the planner for nextPending — respects declaration order and
//      skips already-satisfied requirements
//   4. Among candidates still unauthenticated, use selectCandidate() to
//      pick the one to act on (default: the one matching nextPending first)
//
// Owner rationale: This module does not depend on token-set, session, or
// basic-auth domain objects. It is a shared coordination capability.
// Canonical owner is @securitydept/client.

import {
	type AuthRequirement,
	createRequirementPlanner,
	PlanStatus,
	ResolutionStatus,
} from "./requirement-planner";

// ---------------------------------------------------------------------------
// Auth guard client option — a single requirement candidate
// ---------------------------------------------------------------------------

/**
 * A single requirement candidate that a guard submits to the planner-host.
 *
 * Each option describes:
 * 1. What auth requirement it represents (id, kind, label)
 * 2. How to check whether it's already satisfied
 * 3. What to do when the planner selects it as the next pending action
 */
export interface AuthGuardClientOption {
	/** Unique identifier for this requirement candidate. */
	requirementId: string;

	/**
	 * The kind of auth requirement (opaque string).
	 * @example "session", "frontend_oidc", "backend_oidc"
	 */
	requirementKind: string;

	/** Human-readable label (for logging / debugging / chooser UI). */
	label?: string;

	/** Arbitrary metadata the adopter can attach. */
	attributes?: Record<string, unknown>;

	/**
	 * Check whether this requirement candidate is already authenticated.
	 * Called synchronously by the planner-host during evaluation.
	 */
	checkAuthenticated: () => boolean;

	/**
	 * Action to execute when this candidate is selected as the pending
	 * requirement by the planner-host.
	 *
	 * Return value semantics:
	 * - `true` — allow navigation (requirement will be resolved externally)
	 * - `false` — block navigation
	 * - `string` — redirect to the given URL
	 * - `Promise<...>` — async version of the above
	 */
	onUnauthenticated: () => boolean | string | Promise<boolean | string>;
}

// ---------------------------------------------------------------------------
// Requirements client set — composable requirement collections
// ---------------------------------------------------------------------------

/** A flat collection of requirement candidates. */
export interface RequirementsClientSet {
	readonly options: readonly AuthGuardClientOption[];
}

/**
 * How a child scope's requirements client set relates to its parent.
 *
 * - `inherit` — use the parent's set as-is (child adds nothing)
 * - `merge` — inherit parent's options, then append/override with child's
 *   (child options with the same `requirementId` replace parent ones)
 * - `replace` — discard parent's set entirely, use child's set only
 */
export const RequirementsClientSetComposition = {
	Inherit: "inherit",
	Merge: "merge",
	Replace: "replace",
} as const;

export type RequirementsClientSetComposition =
	(typeof RequirementsClientSetComposition)[keyof typeof RequirementsClientSetComposition];

/** A requirements client set annotated with its composition strategy. */
export interface ScopedRequirementsClientSet {
	/** How this set composes with its parent scope. */
	composition: RequirementsClientSetComposition;
	/** The requirement candidates declared at this scope. */
	options: readonly AuthGuardClientOption[];
}

// ---------------------------------------------------------------------------
// Resolve effective client set (parent + child composition)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective requirements client set by composing a parent set
 * with a child scope's declaration.
 *
 * @param parentOptions - The parent scope's resolved options (or empty).
 * @param child - The child scope's scoped set (with composition strategy).
 * @returns The effective options after composition.
 */
export function resolveEffectiveClientSet(
	parentOptions: readonly AuthGuardClientOption[],
	child: ScopedRequirementsClientSet,
): AuthGuardClientOption[] {
	switch (child.composition) {
		case RequirementsClientSetComposition.Inherit:
			return [...parentOptions];

		case RequirementsClientSetComposition.Merge: {
			// Start with parent options, then override/append with child options.
			// Child options with the same requirementId replace parent ones.
			const merged = new Map<string, AuthGuardClientOption>();
			for (const opt of parentOptions) {
				merged.set(opt.requirementId, opt);
			}
			for (const opt of child.options) {
				merged.set(opt.requirementId, opt);
			}
			return [...merged.values()];
		}

		case RequirementsClientSetComposition.Replace:
			return [...child.options];

		default: {
			const _exhaustive: never = child.composition;
			throw new Error(
				`[resolveEffectiveClientSet] Unknown composition: ${_exhaustive}`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Planner-host result
// ---------------------------------------------------------------------------

/** Result of a planner-host evaluation. */
export interface PlannerHostResult {
	/** Whether all candidates are authenticated (route can activate). */
	allAuthenticated: boolean;

	/** All candidates that are not yet authenticated. */
	unauthenticatedCandidates: readonly AuthGuardClientOption[];

	/**
	 * The candidate selected by the planner as the next one to act on.
	 * `null` when `allAuthenticated` is true.
	 *
	 * Determined by the RequirementPlanner's sequential resolution discipline:
	 * the first unresolved requirement in declaration order that is still
	 * unauthenticated, then optionally further narrowed by `selectCandidate`.
	 */
	pendingCandidate: AuthGuardClientOption | null;
}

// ---------------------------------------------------------------------------
// Planner-host contract and factory
// ---------------------------------------------------------------------------

/**
 * A candidate selection strategy.
 *
 * Receives the list of unauthenticated candidates (in RequirementPlanner
 * declaration order) and returns the one that should be acted on next.
 * The default strategy picks the first one (matching the planner's
 * `nextPending` requirement).
 *
 * Async selectors are supported: return a `Promise<AuthGuardClientOption>`
 * to implement interactive chooser UIs (e.g. show a dialog and await the
 * user's pick before navigation continues).
 *
 * @example
 * ```ts
 * // Async chooser: show a dialog and await user's selection
 * const selectCandidate: CandidateSelector = async (candidates) => {
 *   const chosen = await showChooserDialog(candidates);
 *   return chosen;
 * };
 * ```
 */
export type CandidateSelector = (
	unauthenticated: readonly AuthGuardClientOption[],
) => AuthGuardClientOption | Promise<AuthGuardClientOption>;

/** The planner-host coordination contract. */
export interface PlannerHost {
	/**
	 * Evaluate a set of requirement candidates using RequirementPlanner's
	 * sequential resolution discipline.
	 *
	 * Always returns a Promise so that custom async selectors (e.g. chooser
	 * dialog) are fully supported. Callers should always `await` the result.
	 *
	 * @param candidates - The resolved candidates from the guard's client options.
	 * @returns Promise resolving to the evaluation result.
	 */
	evaluate(
		candidates: readonly AuthGuardClientOption[],
	): Promise<PlannerHostResult>;
}

/** Options for {@link createPlannerHost}. */
export interface CreatePlannerHostOptions {
	/**
	 * Custom candidate selection strategy.
	 *
	 * The default strategy picks the candidate that corresponds to the
	 * RequirementPlanner's `nextPending` requirement (first unauthenticated
	 * in declaration order).
	 *
	 * A custom strategy can further filter or reorder the unauthenticated
	 * candidates, e.g. to implement a chooser UI that lets the user pick.
	 *
	 * @default first-unauthenticated-matching-planner-nextPending
	 *
	 * @example
	 * ```ts
	 * // Async chooser: present all options and await user's pick
	 * createPlannerHost({
	 *   selectCandidate: async (candidates) => {
	 *     return await showChooserDialog(candidates);
	 *   },
	 * })
	 * ```
	 */
	selectCandidate?: CandidateSelector;
}

/**
 * Default candidate selector: picks the first unauthenticated candidate
 * in declaration order (which aligns with RequirementPlanner's nextPending).
 */
function defaultSelectCandidate(
	unauthenticated: readonly AuthGuardClientOption[],
): AuthGuardClientOption {
	return unauthenticated[0];
}

/**
 * Create a planner-host instance backed by {@link createRequirementPlanner}.
 *
 * **How it works:**
 *
 * 1. `evaluate()` builds an `AuthRequirement[]` from `candidates`
 *    (using each candidate's `requirementId`, `requirementKind`, `label`,
 *    and `attributes`).
 * 2. A `RequirementPlanner` is created for this evaluation cycle.
 * 3. Already-authenticated requirements are auto-resolved as `Fulfilled`,
 *    respecting the planner's sequential discipline.
 * 4. The planner's `nextPending` determines the first unresolved requirement
 *    in declaration order.
 * 5. `selectCandidate` is called with all unauthenticated candidates so
 *    adopters can implement custom chooser strategies (e.g. UI dialog).
 *    The default strategy picks the first candidate (matching nextPending).
 *
 * `evaluate()` always returns a `Promise` to accommodate async selectors.
 * For synchronous selectors the Promise resolves in the same microtask tick.
 *
 * @example
 * ```ts
 * import { createPlannerHost } from "@securitydept/client/auth-coordination";
 *
 * // Default sequential strategy (sync selector, wrapped in Promise)
 * const host = createPlannerHost();
 * const result = await host.evaluate(candidates);
 *
 * // Async chooser strategy — show a dialog and await user's pick
 * const hostWithChooser = createPlannerHost({
 *   selectCandidate: async (candidates) => {
 *     return await showChooserDialog(candidates);
 *   },
 * });
 * ```
 */
export function createPlannerHost(
	options?: CreatePlannerHostOptions,
): PlannerHost {
	const selector = options?.selectCandidate ?? defaultSelectCandidate;

	return {
		async evaluate(
			candidates: readonly AuthGuardClientOption[],
		): Promise<PlannerHostResult> {
			if (candidates.length === 0) {
				return {
					allAuthenticated: true,
					unauthenticatedCandidates: [],
					pendingCandidate: null,
				};
			}

			// Build AuthRequirement[] from candidates for the planner.
			const requirements: AuthRequirement[] = candidates.map((c) => ({
				id: c.requirementId,
				kind: c.requirementKind,
				label: c.label,
				attributes: c.attributes,
			}));

			// Create a fresh planner for this evaluation cycle.
			const planner = createRequirementPlanner({ requirements });

			// Auto-resolve already-authenticated requirements in declaration order.
			// The planner enforces sequential discipline: we must resolve in order.
			for (const candidate of candidates) {
				const snap = planner.snapshot();
				if (snap.status === PlanStatus.Settled) break;

				// Resolve the planner's current nextPending if it's authenticated.
				// Only advance the planner for requirements that are currently pending
				// in order — skip if the current nextPending doesn't match this candidate.
				if (
					snap.nextPending?.id === candidate.requirementId &&
					candidate.checkAuthenticated()
				) {
					planner.resolve({
						requirementId: candidate.requirementId,
						status: ResolutionStatus.Fulfilled,
					});
				}
			}

			// Check overall status after resolving all authenticated requirements.
			const finalSnap = planner.snapshot();

			// Collect all unauthenticated candidates.
			const unauthenticated = candidates.filter((c) => !c.checkAuthenticated());

			if (
				finalSnap.status === PlanStatus.Settled ||
				unauthenticated.length === 0
			) {
				return {
					allAuthenticated: true,
					unauthenticatedCandidates: [],
					pendingCandidate: null,
				};
			}

			// Await selection — supports both sync and async selectors.
			// The selector receives the unauthenticated candidates in declaration
			// order so adopters can implement any picking strategy.
			const pendingCandidate = await selector(unauthenticated);
			return {
				allAuthenticated: false,
				unauthenticatedCandidates: unauthenticated,
				pendingCandidate,
			};
		},
	};
}
