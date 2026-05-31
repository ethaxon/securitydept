// Angular route guards — bridge to RouteCompositionRequirementPlanner
//
// Canonical import path:
//   import {
//     createAngularCanActivate,
//     createAngularCanActivateChild,
//   } from "@securitydept/client-angular"
//
// Produces Angular `CanActivateFn` / `CanActivateChildFn` guards that project
// the matched route chain into `RouteTreeSegment[]`, run the SDK's
// `RouteCompositionRequirementPlanner` against the nearest
// `RequirementPlannerHost`, and map the pipeline result onto Angular's guard
// return contract (`true` / `false` / `UrlTree`).
//
// Injection-context discipline: DI reads (host, Router) happen synchronously at
// guard entry, before any `await`. Behaviour that needs DI services should be
// provided via {@link provideRequirementPlannerHost} (or its factory form), not
// inline callbacks that call `inject()` here.
//
// Architecture boundary:
//   - Does NOT own behaviour (checkAuthenticated / onUnauthenticated) — that is
//     resolved through the RequirementPlannerHost chain.
//   - Does NOT carry token-set-specific mapping or policy.
//
// Stability: provisional

import { inject } from "@angular/core";
import {
	type ActivatedRouteSnapshot,
	type CanActivateChildFn,
	type CanActivateFn,
	Router,
	type RouterStateSnapshot,
	type UrlTree,
} from "@angular/router";
import {
	type AuthRequirement,
	PipelineOutcome,
	type RequirementBehaviourWithRouteContext,
	RequirementPlannerHost,
	type RouteBehaviourContextExtra,
	RouteCompositionRequirementPlanner,
} from "@securitydept/client";
import {
	injectRequirementPlannerHost,
	REQUIREMENT_PLANNER_HOST,
} from "./planner-host";
import { projectAngularRouteSegments } from "./route-metadata";

/** Options shared by {@link createAngularCanActivate} and its child variant. */
export interface CreateAngularGuardOptions<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
> {
	/**
	 * Explicit planner host. When omitted, the guard uses the nearest
	 * {@link REQUIREMENT_PLANNER_HOST} in DI, falling back to an empty host only
	 * when no provider exists.
	 */
	plannerHost?: RequirementPlannerHost<TBehaviour>;
}

/**
 * Resolve the planner host at guard entry (synchronous DI phase).
 *
 * Prefers an explicit host, otherwise reuses the nearest provided host. The
 * empty fallback exists only so missing behaviour fails in the core planner
 * contract rather than as an Angular DI error.
 */
function resolveGuardHost<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
>(
	options: CreateAngularGuardOptions<TAuthRequirement, TBehaviour> | undefined,
): RequirementPlannerHost<TBehaviour> {
	if (options?.plannerHost) {
		return options.plannerHost;
	}
	const parent =
		injectRequirementPlannerHost<
			TAuthRequirement,
			RouteBehaviourContextExtra,
			TBehaviour
		>() ?? undefined;
	if (parent) {
		return parent;
	}
	return RequirementPlannerHost.fromBehaviour({} as TBehaviour);
}

async function runRouteGuard<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
>(
	route: ActivatedRouteSnapshot,
	state: RouterStateSnapshot,
	host: RequirementPlannerHost<TBehaviour>,
	router: Router,
): Promise<boolean | UrlTree> {
	const segments = projectAngularRouteSegments<TAuthRequirement>(route);
	const planner = RouteCompositionRequirementPlanner.fromRouteSegments(
		host,
		segments,
		{ url: state.url },
	);
	const result = await planner.runUntilSettled();
	switch (result.outcome) {
		case PipelineOutcome.Settled:
			return true;
		case PipelineOutcome.Blocked:
			return false;
		case PipelineOutcome.Redirect:
			return router.parseUrl(result.location);
	}
}

/**
 * Create a `CanActivateFn` bridging the route chain to the requirement
 * planner pipeline.
 */
export function createAngularCanActivate<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
>(
	options?: CreateAngularGuardOptions<TAuthRequirement, TBehaviour>,
): CanActivateFn {
	return (route, state) => {
		const host = resolveGuardHost<TAuthRequirement, TBehaviour>(options);
		const router = inject(Router);
		return runRouteGuard<TAuthRequirement, TBehaviour>(
			route,
			state,
			host,
			router,
		);
	};
}

/**
 * Create a `CanActivateChildFn` bridging the child route chain to the
 * requirement planner pipeline.
 */
export function createAngularCanActivateChild<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
>(
	options?: CreateAngularGuardOptions<TAuthRequirement, TBehaviour>,
): CanActivateChildFn {
	return (childRoute, state) => {
		const host = resolveGuardHost<TAuthRequirement, TBehaviour>(options);
		const router = inject(Router);
		return runRouteGuard<TAuthRequirement, TBehaviour>(
			childRoute,
			state,
			host,
			router,
		);
	};
}
