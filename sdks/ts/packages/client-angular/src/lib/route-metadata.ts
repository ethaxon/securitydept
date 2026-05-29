// Angular route metadata projection
//
// Canonical import path:
//   import { projectAngularRouteSegments } from "@securitydept/client-angular"
//
// Reads serializable auth requirement metadata declared in Angular route
// `data` and projects a matched route chain (`pathFromRoot`) into the SDK's
// framework-agnostic `RouteTreeSegment[]`. Composition folding is owned by the
// `RouteCompositionRequirementPlanner`, so this layer only extracts per-segment
// declarations.
//
// Route metadata storage is owned by `@securitydept/client`
// ({@link readSecuritydeptRouteMetadata} / {@link writeSecuritydeptRouteMetadata}).
//
// Architecture boundary:
//   - Does NOT own auth enforcement, planner logic, or navigation.
//   - Does NOT carry token-set-specific mapping or policy.
//   - Framework-specific (Angular Router types) but requirement-system-agnostic.
//
// Stability: provisional

import { type ActivatedRouteSnapshot } from "@angular/router";
import {
	type RouteTreeSegment,
	readSecuritydeptRouteMetadata,
} from "@securitydept/client";

/**
 * Resolved route `data` for a segment: static `routeConfig.data` merged with
 * snapshot `data` (snapshot wins on key collision).
 */
export function routeDataFromSegment(
	segment: ActivatedRouteSnapshot,
): Record<string, unknown> {
	return {
		...(segment.routeConfig?.data ?? {}),
		...segment.data,
	};
}

/**
 * Project the `pathFromRoot` of an `ActivatedRouteSnapshot` into the SDK's
 * `RouteTreeSegment[]` chain (root -> leaf).
 *
 * Each segment carries its declared requirements and composition strategy;
 * inherit/merge/replace folding is applied later by the
 * `RouteCompositionRequirementPlanner`.
 *
 * Segments without a `routeConfig` (e.g. the root) get routeId `"__root__"`;
 * empty-path segments get `"__index__"`.
 */
export function projectAngularRouteSegments(
	leafRoute: ActivatedRouteSnapshot,
): RouteTreeSegment[] {
	const chain = leafRoute.pathFromRoot ?? [leafRoute];
	return chain.map((segment) => segmentToTreeNode(segment));
}

function segmentToTreeNode(segment: ActivatedRouteSnapshot): RouteTreeSegment {
	const metadata = readSecuritydeptRouteMetadata(routeDataFromSegment(segment));
	const requirements = metadata?.requirements ? [...metadata.requirements] : [];
	const composition = metadata?.composition;
	return composition
		? { routeId: resolveRouteId(segment), requirements, composition }
		: { routeId: resolveRouteId(segment), requirements };
}

function resolveRouteId(segment: ActivatedRouteSnapshot): string {
	if (!segment.routeConfig) {
		return "__root__";
	}
	const path = segment.routeConfig.path;
	if (path === undefined || path === null || path === "") {
		return "__index__";
	}
	return path;
}
