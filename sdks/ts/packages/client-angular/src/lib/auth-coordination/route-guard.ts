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
// `RequirementPlannerHost` resolved from the current Securitydept injector,
// and map the pipeline result onto Angular's guard return contract (`true` /
// `false` / `UrlTree`).
//
// Injection-context discipline: DI reads (host, Router) happen synchronously at
// guard entry, before any `await`. Behaviour that needs DI services should be
// provided through `provideSecuritydept({ providers: [...] })`, not inline
// callbacks that call `inject()` here.
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
	ENVIRONMENT_TOKEN,
	injectRequirementPlannerHost,
	PipelineOutcome,
	REQUIREMENT_PLANNER_HOST,
	type RequirementBehaviourWithRouteContext,
	RequirementPlannerHost,
	type RequirementPlannerHostBehaviour,
	type RouteBehaviourContextExtra,
	RouteCompositionRequirementPlanner,
} from "@securitydept/client";
import { SECURITYDEPT_INJECTOR } from "../injection";
import { projectAngularRouteSegments } from "./route-metadata";

export interface CreateAngularGuardWithPlannerHostOptions<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
> {
	/**
	 * Explicit planner host. When omitted, the guard uses the nearest
	 * {@link REQUIREMENT_PLANNER_HOST} from the Securitydept injector, falling
	 * back to an empty host only when no provider exists.
	 */
	readonly plannerHost: RequirementPlannerHost<TBehaviour>;
	readonly behaviour?: never;
}

export interface CreateAngularGuardWithBehaviourOptions<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
> {
	readonly plannerHost?: never;
	readonly behaviour?: RequirementPlannerHostBehaviour<
		TAuthRequirement,
		RouteBehaviourContextExtra,
		TBehaviour
	>;
}

/** Options shared by {@link createAngularCanActivate} and its child variant. */
export type CreateAngularGuardOptions<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
> =
	| CreateAngularGuardWithPlannerHostOptions<TAuthRequirement, TBehaviour>
	| CreateAngularGuardWithBehaviourOptions<TAuthRequirement, TBehaviour>;

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
		const securitydeptInjector = inject(SECURITYDEPT_INJECTOR, {
			optional: true,
		});
		const parentHost = securitydeptInjector
			? injectRequirementPlannerHost<
					TAuthRequirement,
					RouteBehaviourContextExtra,
					TBehaviour
				>({ injector: securitydeptInjector })
			: null;
		const host =
			options?.plannerHost ??
			(options?.behaviour
				? RequirementPlannerHost.fromBehaviour(
						typeof options.behaviour === "function"
							? options.behaviour()
							: options.behaviour,
						{
							parent: parentHost ?? undefined,
							environment:
								securitydeptInjector?.get(ENVIRONMENT_TOKEN, null) ?? undefined,
						},
					)
				: parentHost) ??
			RequirementPlannerHost.fromBehaviour({} as TBehaviour);
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
		const injector = inject(SECURITYDEPT_INJECTOR, {
			optional: true,
		});
		const parentHost = injector
			? injectRequirementPlannerHost<
					TAuthRequirement,
					RouteBehaviourContextExtra,
					TBehaviour
				>({ injector })
			: null;
		const host =
			options?.plannerHost ??
			(options?.behaviour
				? RequirementPlannerHost.fromBehaviour(
						typeof options.behaviour === "function"
							? options.behaviour()
							: options.behaviour,
						{
							parent: parentHost ?? undefined,
							environment: injector?.get(ENVIRONMENT_TOKEN, null) ?? undefined,
						},
					)
				: parentHost) ??
			RequirementPlannerHost.fromBehaviour({} as TBehaviour);
		const router = inject(Router);
		return runRouteGuard<TAuthRequirement, TBehaviour>(
			childRoute,
			state,
			host,
			router,
		);
	};
}
