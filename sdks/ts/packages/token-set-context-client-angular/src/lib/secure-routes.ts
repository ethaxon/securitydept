import type {
	ActivatedRouteSnapshot,
	CanActivateChildFn,
	Route,
	RouterStateSnapshot,
} from "@angular/router";
import type {
	AuthRequirement,
	PlannerHost,
	RequirementsClientSetComposition,
} from "@securitydept/client/auth-coordination";
import { withRouteRequirements } from "@securitydept/client-angular";
import type {
	CreateTokenSetRouteAggregationGuardOptions,
	TokenSetRequirementPolicy,
} from "./route-aggregation-guard";
import { createTokenSetRouteAggregationGuard } from "./route-aggregation-guard";

/**
 * Route data key for choosing a planner-host registered at the route root.
 */
export const TOKEN_SET_ROUTE_PLANNER_HOST_KEY_DATA_KEY =
	"tokenSetPlannerHostKey";

/**
 * Serializable route-level security declaration.
 *
 * This object is safe to embed in Angular route metadata. Non-serializable
 * runtime policy (planner host instances, callbacks, chooser implementations)
 * belongs in {@link SecureRouteRootSecurityOptions}.
 */
export interface SecureRouteSecurityOptions {
	/**
	 * Requirements declared at this route segment.
	 * @default []
	 */
	requirements?: AuthRequirement[];

	/**
	 * How this segment composes with ancestor route requirements.
	 * @default merge
	 */
	composition?: RequirementsClientSetComposition;

	/**
	 * Serializable lookup key for a planner-host provided by the root route.
	 *
	 * The nearest declared key on the active route chain wins.
	 */
	plannerHostKey?: string;
}

/**
 * Root-level runtime policy for a secured route tree.
 *
 * Everything here is intentionally non-serializable and lives outside route
 * metadata. Child `secureRoute()` calls only reference these policies by
 * serializable keys / requirement ids.
 */
export interface SecureRouteRootSecurityOptions
	extends SecureRouteSecurityOptions,
		Omit<
			CreateTokenSetRouteAggregationGuardOptions,
			"plannerHost" | "plannerHostResolver"
		> {
	/**
	 * Named planner-host instances available to the secured route tree.
	 */
	plannerHosts?: Record<string, PlannerHost>;

	/**
	 * Fallback planner-host key when no route segment declares one.
	 */
	defaultPlannerHostKey?: string;
}

type SecureRouteOptions = Omit<Route, "path" | "data"> & {
	data?: Record<string, unknown>;
};

/**
 * Build a secured child route declaration.
 *
 * The returned route contains only serializable metadata:
 * requirements, composition strategy, planner-host lookup key, and any extra
 * route data the caller provides.
 */
export function secureRoute(
	path: string,
	securityOptions: SecureRouteSecurityOptions = {},
	routeOptions: SecureRouteOptions = {},
): Route {
	const data = withRouteRequirements(securityOptions.requirements ?? [], {
		composition: securityOptions.composition,
		extra: {
			...(routeOptions.data ?? {}),
			...(securityOptions.plannerHostKey
				? {
						[TOKEN_SET_ROUTE_PLANNER_HOST_KEY_DATA_KEY]:
							securityOptions.plannerHostKey,
					}
				: {}),
		},
	});

	return {
		...routeOptions,
		path,
		data,
	};
}

/**
 * Build a secured route-tree root.
 *
 * This is the canonical Angular adopter entry for token-set route security:
 * root-level runtime policy stays here, child routes use {@link secureRoute}
 * for serializable declarations only.
 */
export function secureRouteRoot(
	path: string,
	securityOptions: SecureRouteRootSecurityOptions = {},
	routeOptions: SecureRouteOptions = {},
): Route {
	const canActivate = createTokenSetRouteAggregationGuard({
		requirementPolicies: securityOptions.requirementPolicies,
		requirementHandlers: securityOptions.requirementHandlers,
		defaultOnUnauthenticated: securityOptions.defaultOnUnauthenticated,
		requirementsKey: securityOptions.requirementsKey,
		plannerHostResolver: (route, state) =>
			resolvePlannerHostForRoute(route, state, securityOptions),
	});
	const canActivateChild = createCanActivateChildAdapter(canActivate);
	const baseRoute = secureRoute(path, securityOptions, routeOptions);

	return {
		...baseRoute,
		canActivate: [canActivate, ...(routeOptions.canActivate ?? [])],
		canActivateChild: [
			canActivateChild,
			...(routeOptions.canActivateChild ?? []),
		],
	};
}

/**
 * Alias with a token-set-specific name for callers who prefer explicit imports.
 */
export const secureTokenSetRoute = secureRoute;

/**
 * Alias with a token-set-specific name for callers who prefer explicit imports.
 */
export const secureTokenSetRouteRoot = secureRouteRoot;

function createCanActivateChildAdapter(
	canActivate: ReturnType<typeof createTokenSetRouteAggregationGuard>,
): CanActivateChildFn {
	return (childRoute, state) => canActivate(childRoute, state);
}

function resolvePlannerHostForRoute(
	route: ActivatedRouteSnapshot,
	_state: RouterStateSnapshot,
	securityOptions: SecureRouteRootSecurityOptions,
): PlannerHost | undefined {
	const plannerHostKey =
		findNearestPlannerHostKey(route) ?? securityOptions.defaultPlannerHostKey;

	if (plannerHostKey) {
		const resolved = securityOptions.plannerHosts?.[plannerHostKey];
		if (!resolved) {
			throw new Error(
				`[secureRouteRoot] No planner host registered for key "${plannerHostKey}"`,
			);
		}
		return resolved;
	}

	return undefined;
}

function findNearestPlannerHostKey(
	route: ActivatedRouteSnapshot,
): string | undefined {
	const chain = route.pathFromRoot ?? [route];
	for (let index = chain.length - 1; index >= 0; index -= 1) {
		const segment = chain[index];
		if (!segment) continue;
		const raw =
			segment.data[TOKEN_SET_ROUTE_PLANNER_HOST_KEY_DATA_KEY] ??
			segment.routeConfig?.data?.[TOKEN_SET_ROUTE_PLANNER_HOST_KEY_DATA_KEY];
		if (typeof raw === "string" && raw.length > 0) {
			return raw;
		}
	}
	return undefined;
}

export type { TokenSetRequirementPolicy };
