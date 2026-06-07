import {
	type AuthRequirement,
	type FoundationEnvironment,
	type RequirementBehaviourWithRouteContext,
	type RequirementPlannerHost,
	type RequirementPlannerHostBehaviour,
	type RequirementsComposition,
	type RouteBehaviourContextExtra,
	type SecuritydeptInjectorTrait,
	type SecuritydeptRouteMetadata,
	writeSecuritydeptRouteMetadata,
} from "@securitydept/client";
import {
	createTanStackBeforeLoad,
	type SecuritydeptTanStackRouterContext,
	type TanStackBeforeLoadContextLike,
} from "./route-guard";

export interface CreateTanStackRouterContextOptions {
	readonly environment?: FoundationEnvironment;
	readonly injector?: SecuritydeptInjectorTrait;
}

export interface TanStackRouteSecurityOptions<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
> {
	readonly requirements?: readonly TAuthRequirement[];
	readonly composition?: RequirementsComposition;
	readonly plannerHost?: RequirementPlannerHost<TBehaviour>;
	readonly behaviour?: RequirementPlannerHostBehaviour<
		TAuthRequirement,
		RouteBehaviourContextExtra,
		TBehaviour
	>;
}

export interface TanStackRouteOptionsLike {
	readonly staticData?: object;
	readonly beforeLoad?: (context: TanStackBeforeLoadContextLike) => unknown;
	readonly [key: string]: unknown;
}

export function createTanStackRouterContext(
	options: CreateTanStackRouterContextOptions = {},
): Pick<SecuritydeptTanStackRouterContext, "securitydeptInjector"> {
	const securitydeptInjector =
		options.injector ?? options.environment?.injector;
	if (!securitydeptInjector) {
		throw new Error(
			"[createTanStackRouterContext] Missing SecurityDept injector. Pass `injector` or `environment`.",
		);
	}
	return { securitydeptInjector };
}

export function secureRoute<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
>(
	security: TanStackRouteSecurityOptions<TAuthRequirement, TBehaviour>,
	routeOptions: TanStackRouteOptionsLike = {},
): TanStackRouteOptionsLike {
	return {
		...routeOptions,
		staticData: writeRequirementStaticData(security, routeOptions.staticData),
	};
}

export function secureRouteRoot<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	> = Partial<RequirementBehaviourWithRouteContext<TAuthRequirement>>,
>(
	security: TanStackRouteSecurityOptions<TAuthRequirement, TBehaviour>,
	routeOptions: TanStackRouteOptionsLike = {},
): TanStackRouteOptionsLike {
	const previousBeforeLoad = routeOptions.beforeLoad;
	const securityBeforeLoad = createTanStackBeforeLoad<
		TAuthRequirement,
		TBehaviour
	>(
		security.plannerHost
			? { plannerHost: security.plannerHost }
			: security.behaviour
				? { behaviour: security.behaviour }
				: undefined,
	);
	return {
		...routeOptions,
		staticData: writeRequirementStaticData(security, routeOptions.staticData),
		async beforeLoad(context) {
			const previousResult = await previousBeforeLoad?.(context);
			await securityBeforeLoad(context);
			return previousResult;
		},
	};
}

function writeRequirementStaticData<
	TAuthRequirement extends AuthRequirement,
	TBehaviour extends Partial<
		RequirementBehaviourWithRouteContext<TAuthRequirement>
	>,
>(
	security: TanStackRouteSecurityOptions<TAuthRequirement, TBehaviour>,
	base: object | undefined,
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
