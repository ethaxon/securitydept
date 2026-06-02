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
	provideRequirementPlannerHost,
	type RequirementBehaviourWithRouteContext,
	type RequirementPlannerHost,
	type RequirementPlannerHostBehaviour,
	type RequirementsComposition,
	type RouteBehaviourContextExtra,
	type SecuritydeptRouteMetadata,
	writeSecuritydeptRouteMetadata,
} from "@securitydept/client";
import { provideSecuritydept } from "../injection";
import {
	createAngularCanActivate,
	createAngularCanActivateChild,
} from "./route-guard";

export interface SecureRouteSecurityOptions<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
> {
	/** Auth requirements declared on this route segment. */
	requirements?: readonly TAuthRequirement[];
	/** Composition strategy against the inherited chain (default: `merge`). */
	composition?: RequirementsComposition;
	/**
	 * Explicit planner host for the guards on a root route. When omitted, the
	 * guard resolves the nearest host from DI (or a self-managed default).
	 */
	plannerHost?: RequirementPlannerHost<TBehaviour>;
	/**
	 * Behaviour to provide as a scoped {@link RequirementPlannerHost} at the
	 * root route. Mounted via `provideSecuritydept({ providers: [...] })`.
	 */
	behaviour?: RequirementPlannerHostBehaviour<
		TAuthRequirement,
		RouteBehaviourContextExtra,
		TBehaviour
	>;
}

/** Additional route config merged into the produced {@link Route}. */
export type SecureRouteConfig = Omit<Route, "path">;

function writeRequirementData<TAuthRequirement extends AuthRequirement>(
	security: SecureRouteSecurityOptions<TAuthRequirement>,
	base: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const patch: SecuritydeptRouteMetadata<TAuthRequirement> = {};
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
export function secureRoute<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
>(
	path: string,
	security: SecureRouteSecurityOptions<TAuthRequirement, TBehaviour>,
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
export function secureRouteRoot<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
>(
	path: string,
	security: SecureRouteSecurityOptions<TAuthRequirement, TBehaviour>,
	routeOptions?: SecureRouteConfig,
): Route {
	const guardOptions = security.plannerHost
		? { plannerHost: security.plannerHost }
		: undefined;
	const providers = security.behaviour
		? [
				...(routeOptions?.providers ?? []),
				provideSecuritydept({
					providers: [
						provideRequirementPlannerHost<
							TAuthRequirement,
							RouteBehaviourContextExtra,
							TBehaviour
						>(security.behaviour),
					],
				}),
			]
		: routeOptions?.providers;
	const route: Route = {
		...routeOptions,
		path,
		data: writeRequirementData(security, routeOptions?.data),
		canActivate: [
			...(routeOptions?.canActivate ?? []),
			createAngularCanActivate<TAuthRequirement, TBehaviour>(guardOptions),
		],
		canActivateChild: [
			...(routeOptions?.canActivateChild ?? []),
			createAngularCanActivateChild<TAuthRequirement, TBehaviour>(guardOptions),
		],
	};
	if (providers) {
		route.providers = providers;
	}
	return route;
}
