// Angular Router route adapter for auth-coordination
//
// Canonical import path:
//   import { ... } from "@securitydept/client-angular"
//
// Provides the projection layer between Angular Router's ActivatedRouteSnapshot
// tree and the SDK's framework-agnostic RouteMatchNode[] contract.
// Uses real @angular/router types (ActivatedRouteSnapshot) so consuming apps
// get full type-safety and IDE autocomplete without any casting.
//
// Architecture boundary:
//   - Does NOT own the Angular router, guards, or navigation lifecycle.
//   - Does NOT re-export core orchestration primitives.
//   - Does NOT carry token-set-specific mapping or policy.
//   - The adopter wires this into their guards / resolvers.
//
// Stability: provisional

import { Injectable } from "@angular/core";
import type { ActivatedRouteSnapshot } from "@angular/router";
import type {
	AuthRequirement,
	RouteMatchNode,
} from "@securitydept/client/auth-coordination";

// ---------------------------------------------------------------------------
// Projection options
// ---------------------------------------------------------------------------

/** Options for {@link AuthRouteAdapter} projection methods. */
export interface AuthRouteAdapterOptions {
	/**
	 * Key used to read auth requirements from route `data`.
	 *
	 * @default "authRequirements"
	 */
	requirementsKey?: string;
}

/** Default key for auth requirements in Angular route `data`. */
export const DEFAULT_ROUTE_REQUIREMENTS_KEY = "authRequirements";

// ---------------------------------------------------------------------------
// Guard adapter result
// ---------------------------------------------------------------------------

/** Result from {@link AuthRouteAdapter.check}. */
export interface RouteGuardResult {
	/** Whether all requirements are settled (route can activate). */
	canActivate: boolean;
	/** The pending requirement still awaiting resolution, if any. */
	pendingRequirement: AuthRequirement | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Angular service that bridges Angular Router's `ActivatedRouteSnapshot` to
 * the SDK's framework-agnostic `RouteMatchNode[]` contract.
 *
 * Inject this into `CanActivateFn` guards or class-based guards.
 *
 * @example
 * ```ts
 * export const authGuard: CanActivateFn = (route) => {
 *   const adapter = inject(AuthRouteAdapter);
 *   const result = adapter.check(route, orchestrator);
 *   if (!result.canActivate && result.pendingRequirement) {
 *     // Trigger auth flow for the pending requirement
 *   }
 *   return result.canActivate;
 * };
 * ```
 */
@Injectable({ providedIn: "root" })
export class AuthRouteAdapter {
	/**
	 * Project the `pathFromRoot` of an `ActivatedRouteSnapshot` into the SDK's
	 * `RouteMatchNode[]` chain.
	 *
	 * Route segments without a `routeConfig` (e.g. the root segment) are
	 * assigned routeId `"__root__"`. Segments with a config use the `path`
	 * as their routeId (or `"__index__"` for empty-path segments).
	 */
	projectRouteMatch(
		leafRoute: ActivatedRouteSnapshot,
		options?: AuthRouteAdapterOptions,
	): RouteMatchNode[] {
		const key = options?.requirementsKey ?? DEFAULT_ROUTE_REQUIREMENTS_KEY;
		const chain = leafRoute.pathFromRoot ?? [leafRoute];
		return chain.map((segment) => this.segmentToNode(segment, key));
	}

	/**
	 * Project an explicit array of `ActivatedRouteSnapshot` segments into the
	 * SDK's `RouteMatchNode[]` chain.
	 *
	 * Use when you already have a flattened chain (e.g. from
	 * `ActivatedRoute.pathFromRoot`).
	 */
	projectRouteSegments(
		segments: readonly ActivatedRouteSnapshot[],
		options?: AuthRouteAdapterOptions,
	): RouteMatchNode[] {
		const key = options?.requirementsKey ?? DEFAULT_ROUTE_REQUIREMENTS_KEY;
		return segments.map((segment) => this.segmentToNode(segment, key));
	}

	/**
	 * Project the route snapshot and check whether all requirements are settled.
	 *
	 * @param leafRoute - The leaf `ActivatedRouteSnapshot` from the guard call.
	 * @param orchestrator - The SDK orchestrator managing the requirement plan.
	 * @param options - Optional projection options.
	 */
	check(
		leafRoute: ActivatedRouteSnapshot,
		orchestrator: {
			activateMatchedRoutes(chain: readonly RouteMatchNode[]): void;
			snapshot(): {
				settled: boolean;
				pendingRequirement: AuthRequirement | null;
			};
		},
		options?: AuthRouteAdapterOptions,
	): RouteGuardResult {
		const chain = this.projectRouteMatch(leafRoute, options);
		orchestrator.activateMatchedRoutes(chain);
		const snap = orchestrator.snapshot();
		return {
			canActivate: snap.settled,
			pendingRequirement: snap.pendingRequirement,
		};
	}

	private segmentToNode(
		segment: ActivatedRouteSnapshot,
		key: string,
	): RouteMatchNode {
		const routeId = this.resolveRouteId(segment);
		const rawRequirements =
			segment.data[key] ?? segment.routeConfig?.data?.[key];
		const requirements: AuthRequirement[] = Array.isArray(rawRequirements)
			? rawRequirements
			: [];
		return { routeId, requirements };
	}

	private resolveRouteId(segment: ActivatedRouteSnapshot): string {
		if (!segment.routeConfig) return "__root__";
		const path = segment.routeConfig.path;
		if (path === undefined || path === null || path === "") return "__index__";
		return path;
	}
}
