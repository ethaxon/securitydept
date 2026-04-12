// Shared auth route orchestrator — headless router integration baseline
//
// Canonical location: @securitydept/client/auth-coordination
//
// Provides a minimal, framework-agnostic glue layer between route-level auth
// requirements and the RequirementPlanner, driven by a matched route chain
// (not a single flat routeId).
//
// Core design choices (absorbing Angular Router + TanStack Router patterns):
//   - Input is a **matched route chain** (parent → child → grandchild),
//     mirroring Angular's `ActivatedRouteSnapshot[]` and TanStack's matched route tree.
//   - Parent requirements are **inherited** by children by default.
//   - Children can **append** additional requirements.
//   - The orchestrator merges the full chain into a single effective requirement plan.
//   - Route transitions diff the chain: shared prefix requirements/decisions
//     are preserved; diverging suffix requirements/decisions are discarded.
//
// Architecture boundary:
//   - This module does NOT own the router, render UI, or manage navigation.
//   - It provides the headless orchestration contract that the router calls into.
//   - The adopter is responsible for translating "pending requirement" into
//     the appropriate auth action (redirect, popup, etc.) and calling back
//     with the resolution.
//
// Owner rationale: This orchestrator depends only on RouteMatchNode[] (a shared
// contract) and RequirementPlanner (also in this module). It does not depend on
// token-set material, OIDC protocol details, or any framework specifics.
// Canonical owner is @securitydept/client.

import type {
	AuthRequirement,
	PlanSnapshot,
	RequirementPlanner,
	RequirementResolution,
} from "./requirement-planner";
import { createRequirementPlanner, PlanStatus } from "./requirement-planner";

// ---------------------------------------------------------------------------
// Route match node types
// ---------------------------------------------------------------------------

/**
 * A single node in a matched route chain.
 *
 * The adopter maps their framework's route match result into this contract:
 *   - Angular: `ActivatedRouteSnapshot` → `RouteMatchNode`
 *   - TanStack Router: matched route entry → `RouteMatchNode`
 *   - Any other: route guard / middleware context → `RouteMatchNode`
 */
export interface RouteMatchNode {
	/** Route segment identifier (e.g. route name or path pattern). */
	routeId: string;
	/** Auth requirements declared on this route segment. */
	requirements: readonly AuthRequirement[];
}

/** Chooser decision: which provider/action to use for a pending requirement. */
export interface ChooserDecision {
	/** The requirement ID this decision applies to. */
	requirementId: string;
	/** The chosen provider or action identifier. */
	providerId: string;
	/** Optional metadata for the chosen action. */
	metadata?: Record<string, unknown>;
}

/** Snapshot of the current route orchestration state. */
export interface RouteOrchestrationSnapshot {
	/** The matched route chain, or empty if no route is active. */
	matchedRoutes: readonly RouteMatchNode[];
	/** The leaf route ID (last in chain), or null if no route is active. */
	activeRouteId: string | null;
	/** The planner snapshot for the merged requirements, or null if no route. */
	plan: PlanSnapshot | null;
	/** Whether all merged requirements are fully settled. */
	settled: boolean;
	/** The pending requirement that needs a chooser decision, or null. */
	pendingRequirement: AuthRequirement | null;
}

// ---------------------------------------------------------------------------
// Route requirement orchestrator
// ---------------------------------------------------------------------------

/** Options for {@link createRouteRequirementOrchestrator}. */
export interface CreateRouteRequirementOrchestratorOptions {
	/**
	 * Optional callback fired when the orchestrator needs the adopter to
	 * act on a pending requirement (e.g. show a chooser UI or auto-redirect).
	 */
	onPendingRequirement?: (requirement: AuthRequirement) => void;

	/**
	 * Optional callback fired when all requirements for the active route
	 * are settled.
	 */
	onSettled?: (
		routeId: string,
		resolutions: readonly RequirementResolution[],
	) => void;
}

/**
 * Headless route requirement orchestrator.
 *
 * Driven by a matched route chain: the adopter maps their framework's
 * route match result into `RouteMatchNode[]` and calls `activateMatchedRoutes`.
 * Parent requirements are inherited; children append.
 */
export interface RouteRequirementOrchestrator {
	/** Get a snapshot of the current route orchestration state. */
	snapshot(): RouteOrchestrationSnapshot;

	/**
	 * Activate a matched route chain.
	 *
	 * Requirements are inherited: parent requirements come first, children append.
	 * On route transition, shared-prefix requirements and their resolutions
	 * are preserved; diverging requirements are re-planned.
	 */
	activateMatchedRoutes(matchedRoutes: readonly RouteMatchNode[]): void;

	/**
	 * Resolve the current pending requirement.
	 * Advances to the next requirement or settles the plan.
	 */
	resolve(resolution: RequirementResolution): void;

	/**
	 * Record a chooser decision for the current pending requirement.
	 */
	applyChooserDecision(decision: ChooserDecision): void;

	/**
	 * Reset the active route (e.g. on navigation away or logout).
	 */
	deactivateRoute(): void;

	/** All chooser decisions made during the current route activation. */
	readonly decisions: readonly ChooserDecision[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Merge a matched route chain into a flat requirement list (parent-first). */
function mergeChainRequirements(
	chain: readonly RouteMatchNode[],
): AuthRequirement[] {
	const merged: AuthRequirement[] = [];
	const seenIds = new Set<string>();
	for (const node of chain) {
		for (const req of node.requirements) {
			// Deduplicate by requirement ID — later (child) definitions win.
			if (seenIds.has(req.id)) continue;
			seenIds.add(req.id);
			merged.push(req);
		}
	}
	return merged;
}

/**
 * Find the length of the shared requirement prefix between old and new chains.
 * Used to determine which resolutions can be preserved on route transition.
 */
function sharedPrefixLength(
	oldReqs: readonly AuthRequirement[],
	newReqs: readonly AuthRequirement[],
): number {
	const limit = Math.min(oldReqs.length, newReqs.length);
	for (let i = 0; i < limit; i++) {
		if (oldReqs[i].id !== newReqs[i].id || oldReqs[i].kind !== newReqs[i].kind)
			return i;
	}
	return limit;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRouteRequirementOrchestrator(
	options: CreateRouteRequirementOrchestratorOptions = {},
): RouteRequirementOrchestrator {
	let matchedRoutes: RouteMatchNode[] = [];
	let activeRouteId: string | null = null;
	let planner: RequirementPlanner | null = null;
	let decisions: ChooserDecision[] = [];
	let currentMergedReqs: AuthRequirement[] = [];

	function emitPendingIfNeeded(): void {
		if (!planner || !options.onPendingRequirement) return;
		const snap = planner.snapshot();
		if (snap.nextPending) {
			options.onPendingRequirement(snap.nextPending);
		}
	}

	function emitSettledIfNeeded(): void {
		if (!planner || !activeRouteId || !options.onSettled) return;
		const snap = planner.snapshot();
		if (snap.status === PlanStatus.Settled) {
			options.onSettled(activeRouteId, snap.resolutions);
		}
	}

	function activateWithChain(chain: readonly RouteMatchNode[]): void {
		const newMerged = mergeChainRequirements(chain);
		if (newMerged.length === 0) {
			// No requirements — treat as deactivation.
			matchedRoutes = [...chain];
			activeRouteId = chain.length > 0 ? chain[chain.length - 1].routeId : null;
			planner = null;
			currentMergedReqs = [];
			decisions = [];
			return;
		}

		// Determine shared prefix to preserve existing resolutions.
		const shared = sharedPrefixLength(currentMergedReqs, newMerged);

		// Collect resolutions from the current planner that can be preserved.
		let preservedResolutions: RequirementResolution[] = [];
		if (planner && shared > 0) {
			const oldSnap = planner.snapshot();
			preservedResolutions = oldSnap.resolutions.slice(0, shared);
		}

		// Preserve decisions whose requirementIds are in the shared prefix.
		const sharedReqIds = new Set(newMerged.slice(0, shared).map((r) => r.id));
		decisions = decisions.filter((d) => sharedReqIds.has(d.requirementId));

		// Create new planner with full merged requirements.
		matchedRoutes = [...chain];
		activeRouteId = chain[chain.length - 1].routeId;
		currentMergedReqs = newMerged;
		planner = createRequirementPlanner({ requirements: newMerged });

		// Re-apply preserved resolutions.
		for (const res of preservedResolutions) {
			planner.resolve(res);
		}

		emitPendingIfNeeded();
		emitSettledIfNeeded();
	}

	return {
		snapshot(): RouteOrchestrationSnapshot {
			if (!planner || !activeRouteId) {
				return {
					matchedRoutes: [...matchedRoutes],
					activeRouteId,
					plan: null,
					settled: matchedRoutes.length > 0 && currentMergedReqs.length === 0,
					pendingRequirement: null,
				};
			}
			const plan = planner.snapshot();
			return {
				matchedRoutes: [...matchedRoutes],
				activeRouteId,
				plan,
				settled: plan.status === PlanStatus.Settled,
				pendingRequirement: plan.nextPending,
			};
		},

		activateMatchedRoutes(chain: readonly RouteMatchNode[]): void {
			activateWithChain(chain);
		},

		resolve(resolution: RequirementResolution): void {
			if (!planner) {
				throw new Error("Cannot resolve: no active route");
			}
			planner.resolve(resolution);
			emitSettledIfNeeded();
			if (planner.snapshot().status === PlanStatus.Pending) {
				emitPendingIfNeeded();
			}
		},

		applyChooserDecision(decision: ChooserDecision): void {
			decisions.push(decision);
		},

		deactivateRoute(): void {
			activeRouteId = null;
			planner = null;
			matchedRoutes = [];
			decisions = [];
			currentMergedReqs = [];
		},

		get decisions(): readonly ChooserDecision[] {
			return decisions;
		},
	};
}
