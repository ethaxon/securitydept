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
	type UrlTree,
} from "@angular/router";
import {
	PipelineOutcome,
	type RequirementBehaviour,
	RequirementPlannerHost,
	RouteCompositionRequirementPlanner,
} from "@securitydept/client";
import {
	injectRequirementPlannerHost,
	REQUIREMENT_PLANNER_HOST,
} from "./planner-host";
import { projectAngularRouteSegments } from "./route-metadata";

/** Options shared by {@link createAngularCanActivate} and its child variant. */
export interface CreateAngularGuardOptions {
	/**
	 * Explicit planner host. When set, {@link behaviour} is ignored.
	 * When omitted, the guard builds a self-managed host from {@link behaviour}
	 * whose parent is the nearest {@link REQUIREMENT_PLANNER_HOST} in DI.
	 */
	plannerHost?: RequirementPlannerHost;
	/**
	 * Partial behaviour for this guard scope. Unspecified fields inherit from the
	 * nearest DI-provided host, then safe defaults at the root.
	 */
	behaviour?: Partial<RequirementBehaviour>;
}

/**
 * Resolve the planner host at guard entry (synchronous DI phase).
 *
 * Prefers an explicit host, otherwise creates a self-managed host from
 * {@link CreateAngularGuardOptions.behaviour} whose parent is the nearest
 * provided host — so behaviour still flows through the DI-mapped chain even
 * when no host is declared at this scope.
 */
function resolveGuardHost(
	options: CreateAngularGuardOptions | undefined,
): RequirementPlannerHost {
	if (options?.plannerHost) {
		return options.plannerHost;
	}
	return RequirementPlannerHost.fromBehaviour(options?.behaviour ?? {}, {
		parent: injectRequirementPlannerHost() ?? undefined,
	});
}

async function runRouteGuard(
	route: ActivatedRouteSnapshot,
	host: RequirementPlannerHost,
	router: Router,
): Promise<boolean | UrlTree> {
	const segments = projectAngularRouteSegments(route);
	const planner = RouteCompositionRequirementPlanner.fromRootRoute(
		host,
		segments,
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
export function createAngularCanActivate(
	options?: CreateAngularGuardOptions,
): CanActivateFn {
	return (route) => {
		const host = resolveGuardHost(options);
		const router = inject(Router);
		return runRouteGuard(route, host, router);
	};
}

/**
 * Create a `CanActivateChildFn` bridging the child route chain to the
 * requirement planner pipeline.
 */
export function createAngularCanActivateChild(
	options?: CreateAngularGuardOptions,
): CanActivateChildFn {
	return (childRoute) => {
		const host = resolveGuardHost(options);
		const router = inject(Router);
		return runRouteGuard(childRoute, host, router);
	};
}
