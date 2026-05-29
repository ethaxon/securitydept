// Angular secure route helpers — declarative route assembly
//
// Canonical import path:
//   import { secureRoute, secureRouteRoot } from "@securitydept/client-angular"
//
// Two composable helpers for wiring auth requirements onto Angular routes:
//   - secureRoute:     writes requirement metadata into route `data` ONLY.
//   - secureRouteRoot: writes metadata AND attaches the canActivate /
//                      canActivateChild guards (and, optionally, a scoped
//                      RequirementPlannerHost provider).
//
// The split lets a single guarded root route cover a whole subtree: child
// segments declare their own requirements via `secureRoute`, and the root's
// canActivateChild folds the full chain through the planner.
//
// Architecture boundary:
//   - Does NOT own behaviour or token-set-specific policy.
//   - Delegates enforcement to createAngularCanActivate/Child.
//
// Stability: provisional

import { type Route } from "@angular/router";
import {
	type AuthRequirement,
	type RequirementPlannerHost,
	type RequirementsComposition,
	type SecuritydeptRouteMetadata,
	writeSecuritydeptRouteMetadata,
} from "@securitydept/client";
import {
	provideRequirementPlannerHost,
	type RequirementPlannerHostBehaviour,
} from "./planner-host";
import {
	createAngularCanActivate,
	createAngularCanActivateChild,
} from "./route-guard";
export interface SecureRouteSecurityOptions {
	/** Auth requirements declared on this route segment. */
	requirements?: readonly AuthRequirement[];
	/** Composition strategy against the inherited chain (default: `merge`). */
	composition?: RequirementsComposition;
	/**
	 * Explicit planner host for the guards on a root route. When omitted, the
	 * guard resolves the nearest host from DI (or a self-managed default).
	 */
	plannerHost?: RequirementPlannerHost;
	/**
	 * Behaviour to provide as a scoped {@link RequirementPlannerHost} at the
	 * root route. Mounted via `provideRequirementPlannerHost` in `providers`.
	 */
	behaviour?: RequirementPlannerHostBehaviour;
}

/** Additional route config merged into the produced {@link Route}. */
export type SecureRouteConfig = Omit<
	Route,
	"path" | "canActivate" | "canActivateChild"
>;

function writeRequirementData(
	security: SecureRouteSecurityOptions,
	base: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const patch: SecuritydeptRouteMetadata = {};
	if (security.requirements !== undefined) {
		patch.requirements = security.requirements;
	}
	if (security.composition !== undefined) {
		patch.composition = security.composition;
	}
	if (Object.keys(patch).length === 0) {
		return { ...(base ?? {}) };
	}
	return writeSecuritydeptRouteMetadata(base, patch);
}

/**
 * Declare a secure route segment: writes requirement metadata into route
 * `data` only. No guard is attached — a guarded ancestor (see
 * {@link secureRouteRoot}) enforces the folded chain.
 */
export function secureRoute(
	path: string,
	security: SecureRouteSecurityOptions,
	routeOptions?: SecureRouteConfig,
): Route {
	return {
		...routeOptions,
		path,
		data: writeRequirementData(security, routeOptions?.data),
	};
}

/**
 * Declare a guarded root route: writes requirement metadata AND attaches
 * `canActivate` + `canActivateChild` guards bound to the requirement planner.
 *
 * When `security.behaviour` is set, a scoped {@link RequirementPlannerHost}
 * provider is mounted so descendant guards inherit it through DI.
 */
export function secureRouteRoot(
	path: string,
	security: SecureRouteSecurityOptions,
	routeOptions?: SecureRouteConfig,
): Route {
	const guardOptions = security.plannerHost
		? { plannerHost: security.plannerHost }
		: undefined;
	const providers = security.behaviour
		? [
				...(routeOptions?.providers ?? []),
				provideRequirementPlannerHost(security.behaviour),
			]
		: routeOptions?.providers;
	const route: Route = {
		...routeOptions,
		path,
		data: writeRequirementData(security, routeOptions?.data),
		canActivate: [createAngularCanActivate(guardOptions)],
		canActivateChild: [createAngularCanActivateChild(guardOptions)],
	};
	if (providers) {
		route.providers = providers;
	}
	return route;
}
