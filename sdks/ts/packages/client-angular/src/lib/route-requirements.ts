// Angular route metadata requirement helper
//
// Canonical import path:
//   import { withRouteRequirements, extractFullRouteRequirements, ... } from "@securitydept/client-angular"
//
// Provides the canonical route-metadata layer for Angular Router auth requirement
// declaration. Requirements are stored in route `data` rather than in DI scope,
// enabling full-route aggregation guards to collect the complete requirement set
// from the entire path-from-root chain in a single pass.
//
// Architecture boundary:
//   - Does NOT own auth enforcement or planner logic.
//   - Does NOT carry token-set-specific mapping or policy.
//   - Provides typed helpers for declaring and reading requirements from route data.
//   - framework-specific (Angular Router types) but requirement-system-agnostic.
//
// Relationship to provideRouteScopedRequirements():
//   - provideRouteScopedRequirements() is a lower-level DI-scope helper.
//   - This module is the canonical path for Angular Router auth requirement
//     declaration when full-route aggregation is needed.
//
// Key sentinel note:
//   DEFAULT_ROUTE_REQUIREMENTS_KEY is defined in router.ts (AuthRouteAdapter's
//   companion constant). ROUTE_REQUIREMENTS_DATA_KEY exported here is its
//   semantic alias — both hold the same value ("authRequirements").
//   Adopters may use either name; they are interchangeable.
//
// Stability: provisional

import type { ActivatedRouteSnapshot } from "@angular/router";
import {
	type AuthRequirement,
	RequirementsClientSetComposition,
} from "@securitydept/client/auth-coordination";
import { DEFAULT_ROUTE_REQUIREMENTS_KEY } from "./router";

// ---------------------------------------------------------------------------
// Route data key
// ---------------------------------------------------------------------------

/**
 * Default key for auth requirements in Angular route `data`.
 *
 * Semantic alias for {@link DEFAULT_ROUTE_REQUIREMENTS_KEY} (defined in
 * `router.ts`). Both hold the same value (`"authRequirements"`).
 * Use either name — they are interchangeable.
 *
 * Set this key in `Route.data` to declare auth requirements for a route segment:
 * ```ts
 * { path: "dashboard", data: withRouteRequirements([{ id: "session", kind: "session" }]) }
 * ```
 *
 * The key is also read by {@link AuthRouteAdapter} when projecting snapshots.
 *
 * @see {@link withRouteRequirements}
 * @see {@link extractFullRouteRequirements}
 */
export const ROUTE_REQUIREMENTS_DATA_KEY = DEFAULT_ROUTE_REQUIREMENTS_KEY;

/**
 * Default key for the route-level composition strategy in Angular route `data`.
 *
 * Used together with {@link ROUTE_REQUIREMENTS_DATA_KEY}. The default
 * composition is `merge` when the key is omitted.
 */
export const ROUTE_REQUIREMENTS_COMPOSITION_DATA_KEY =
	"authRequirementsComposition";

/**
 * Route-level auth requirement declaration stored in Angular route `data`.
 */
export interface RouteRequirementsDeclaration {
	requirements: readonly AuthRequirement[];
	composition: RequirementsClientSetComposition;
}

/**
 * Options for {@link withRouteRequirements}.
 */
export interface WithRouteRequirementsOptions {
	/**
	 * How this route segment composes with its parent route chain.
	 * @default RequirementsClientSetComposition.Merge
	 */
	composition?: RequirementsClientSetComposition;

	/**
	 * Additional route data properties to merge into the returned object.
	 */
	extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Declaration helper
// ---------------------------------------------------------------------------

/**
 * Build an Angular route `data` object declaring auth requirements for a
 * single route segment.
 *
 * Use this as the `data` field in an Angular `Route` config. Nested routes
 * can declare their own requirements; a full-route aggregation guard will
 * walk the entire `pathFromRoot` chain to collect all requirements in one pass.
 *
 * @example
 * ```ts
 * // Parent route declares base requirement
 * {
 *   path: "app",
 *   data: withRouteRequirements([{ id: "session", kind: "session" }]),
 *   children: [
 *     // Child route adds an additional requirement
 *     {
 *       path: "admin",
 *       data: withRouteRequirements([{ id: "admin-oidc", kind: "backend_oidc" }]),
 *       canActivate: [createTokenSetRouteAggregationGuard(...)],
 *     },
 *   ],
 * }
 * ```
 *
 * @param requirements - One or more auth requirements for this route segment.
 * @param extra - Optional additional data properties to merge.
 */
export function withRouteRequirements(
	requirements: AuthRequirement[],
	optionsOrExtra?: WithRouteRequirementsOptions | Record<string, unknown>,
	maybeExtra?: Record<string, unknown>,
): Record<string, unknown> {
	const { composition, extra } = normalizeRequirementOptions(
		optionsOrExtra,
		maybeExtra,
	);
	return {
		...extra,
		[ROUTE_REQUIREMENTS_DATA_KEY]: requirements,
		[ROUTE_REQUIREMENTS_COMPOSITION_DATA_KEY]: composition,
	};
}

// ---------------------------------------------------------------------------
// Aggregation helper
// ---------------------------------------------------------------------------

/**
 * Extract and flatten auth requirements from a complete Angular route chain.
 *
 * Walks all segments from root to leaf (from `leafRoute.pathFromRoot`)
 * and concatenates the declared {@link AuthRequirement} arrays in order.
 * Requirements from ancestor routes appear before requirements from
 * descendant routes. Duplicate `id` values are NOT de-duplicated here —
 * the caller (guard / enforcement layer) is responsible for deduplication
 * or merge logic.
 *
 * This is the extraction counter-part to {@link withRouteRequirements}.
 * A full-route aggregation guard calls this once and hands the complete
 * flat array to the planner / enforcement layer.
 *
 * @param leafRoute - The leaf `ActivatedRouteSnapshot` from the guard call.
 * @param requirementsKey - Override the route data key (default: `"authRequirements"`).
 */
export function extractFullRouteRequirements(
	leafRoute: ActivatedRouteSnapshot,
	requirementsKey = ROUTE_REQUIREMENTS_DATA_KEY,
	compositionKey = ROUTE_REQUIREMENTS_COMPOSITION_DATA_KEY,
): AuthRequirement[] {
	const chain = leafRoute.pathFromRoot ?? [leafRoute];
	let result: AuthRequirement[] = [];
	for (const segment of chain) {
		const raw =
			segment.data[requirementsKey] ??
			segment.routeConfig?.data?.[requirementsKey];
		const composition =
			readRouteComposition(segment, compositionKey) ??
			RequirementsClientSetComposition.Merge;
		const requirements = Array.isArray(raw) ? (raw as AuthRequirement[]) : [];
		result = resolveEffectiveRequirements(result, {
			composition,
			requirements,
		});
	}
	return result;
}

/**
 * Resolve the effective auth requirements by composing the parent chain with a
 * child route declaration.
 *
 * Composition semantics mirror `resolveEffectiveClientSet()`:
 * - `inherit` keeps the parent requirements unchanged
 * - `merge` appends child requirements and replaces same-id parent entries
 * - `replace` discards the parent chain and uses only the child's requirements
 */
export function resolveEffectiveRequirements(
	parentRequirements: readonly AuthRequirement[],
	child: RouteRequirementsDeclaration,
): AuthRequirement[] {
	switch (child.composition) {
		case RequirementsClientSetComposition.Inherit:
			return [...parentRequirements];

		case RequirementsClientSetComposition.Merge: {
			const merged = new Map<string, AuthRequirement>();
			for (const requirement of parentRequirements) {
				merged.set(requirement.id, requirement);
			}
			for (const requirement of child.requirements) {
				merged.set(requirement.id, requirement);
			}
			return [...merged.values()];
		}

		case RequirementsClientSetComposition.Replace:
			return [...child.requirements];

		default: {
			const _exhaustive: never = child.composition;
			throw new Error(
				`[resolveEffectiveRequirements] Unknown composition: ${_exhaustive}`,
			);
		}
	}
}

function normalizeRequirementOptions(
	optionsOrExtra?: WithRouteRequirementsOptions | Record<string, unknown>,
	maybeExtra?: Record<string, unknown>,
): {
	composition: RequirementsClientSetComposition;
	extra?: Record<string, unknown>;
} {
	if (
		optionsOrExtra &&
		("composition" in optionsOrExtra || "extra" in optionsOrExtra)
	) {
		const options = optionsOrExtra as WithRouteRequirementsOptions;
		return {
			composition:
				options.composition ?? RequirementsClientSetComposition.Merge,
			extra: maybeExtra ?? options.extra,
		};
	}

	return {
		composition: RequirementsClientSetComposition.Merge,
		extra: optionsOrExtra as Record<string, unknown> | undefined,
	};
}

function readRouteComposition(
	segment: ActivatedRouteSnapshot,
	compositionKey: string,
): RequirementsClientSetComposition | undefined {
	const raw =
		segment.data[compositionKey] ?? segment.routeConfig?.data?.[compositionKey];
	if (
		raw === RequirementsClientSetComposition.Inherit ||
		raw === RequirementsClientSetComposition.Merge ||
		raw === RequirementsClientSetComposition.Replace
	) {
		return raw;
	}
	return undefined;
}
