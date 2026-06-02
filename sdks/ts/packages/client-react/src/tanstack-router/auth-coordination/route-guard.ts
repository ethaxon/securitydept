import {
	type AuthRequirement,
	ENVIRONMENT_TOKEN,
	injectRequirementPlannerHost,
	PipelineOutcome,
	type RequirementBehaviourWithRouteContext,
	RequirementPlannerHost,
	type RequirementPlannerHostBehaviour,
	type RouteBehaviourContextExtra,
	RouteCompositionRequirementPlanner,
	type SecuritydeptInjectorTrait,
} from "@securitydept/client";
import { redirect } from "@tanstack/react-router";
import {
	projectTanStackRouteSegments,
	type TanStackRouteMatchLike,
} from "./route-metadata";

export interface SecuritydeptTanStackRouterContext {
	readonly securitydeptInjector: SecuritydeptInjectorTrait;
	readonly router?: {
		readonly state: {
			readonly matches: readonly TanStackRouteMatchLike[];
		};
	};
}

export interface TanStackBeforeLoadContextLike {
	readonly context: SecuritydeptTanStackRouterContext;
	readonly matches: readonly TanStackRouteMatchLike[];
	readonly location: {
		readonly href: string;
	};
}

export interface CreateTanStackBeforeLoadWithPlannerHostOptions<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
> {
	readonly plannerHost: RequirementPlannerHost<TBehaviour>;
	readonly behaviour?: never;
}

export interface CreateTanStackBeforeLoadWithBehaviourOptions<
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

export type CreateTanStackBeforeLoadOptions<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
> =
	| CreateTanStackBeforeLoadWithPlannerHostOptions<TAuthRequirement, TBehaviour>
	| CreateTanStackBeforeLoadWithBehaviourOptions<TAuthRequirement, TBehaviour>;

export class TanStackRouteSecurityBlockedError extends Error {
	constructor(readonly requirement: AuthRequirement) {
		super(`TanStack route security blocked requirement: ${requirement.id}`);
		this.name = "TanStackRouteSecurityBlockedError";
	}
}

export function createTanStackBeforeLoad<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
>(options?: CreateTanStackBeforeLoadOptions<TAuthRequirement, TBehaviour>) {
	return async (context: TanStackBeforeLoadContextLike): Promise<void> => {
		const injector = context.context.securitydeptInjector;
		const parentHost = injectRequirementPlannerHost<
			TAuthRequirement,
			RouteBehaviourContextExtra,
			TBehaviour
		>({ injector });
		const host =
			options?.plannerHost ??
			(options?.behaviour
				? RequirementPlannerHost.fromBehaviour(
						typeof options.behaviour === "function"
							? options.behaviour()
							: options.behaviour,
						{
							parent: parentHost ?? undefined,
							environment: injector.get(ENVIRONMENT_TOKEN, null) ?? undefined,
						},
					)
				: parentHost) ??
			RequirementPlannerHost.fromBehaviour({} as TBehaviour);
		const segments = projectTanStackRouteSegments<TAuthRequirement>(
			context.matches,
		);
		const planner = RouteCompositionRequirementPlanner.fromRouteSegments(
			host,
			segments,
			{
				url: context.location.href,
			},
		);
		const result = await planner.runUntilSettled();
		switch (result.outcome) {
			case PipelineOutcome.Settled:
				return;
			case PipelineOutcome.Blocked:
				throw new TanStackRouteSecurityBlockedError(result.requirement);
			case PipelineOutcome.Redirect:
				throw redirect({ to: result.location });
		}
	};
}
