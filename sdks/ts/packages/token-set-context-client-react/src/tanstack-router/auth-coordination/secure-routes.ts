import { type RequirementsComposition } from "@securitydept/client";
import {
	secureRoute as baseSecureRoute,
	type TanStackBeforeLoadContextLike,
	type TanStackRouteOptionsLike,
} from "@securitydept/client-react/tanstack-router";
import {
	TokenSetClientRegistryAuthRequirement,
	type TokenSetClientRegistryAuthRequirementInput,
} from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetCanBeforeLoad,
	type TokenSetTanStackRequirementPlannerOptions,
} from "./route-guard";

export {
	TokenSetClientRegistryAuthRequirement as TokenSetTanStackAuthRequirement,
};
export type TokenSetTanStackAuthRequirementInput =
	TokenSetClientRegistryAuthRequirementInput;

export interface TokenSetSecureRouteSecurityOptions {
	readonly requirements?: readonly TokenSetClientRegistryAuthRequirement[];
	readonly composition?: RequirementsComposition;
}

export interface TokenSetSecureRouteRootSecurityOptions
	extends TokenSetSecureRouteSecurityOptions,
		TokenSetTanStackRequirementPlannerOptions {}

export function secureTokenSetRoute(
	security: TokenSetSecureRouteSecurityOptions = {},
	routeOptions: TanStackRouteOptionsLike = {},
): TanStackRouteOptionsLike {
	return baseSecureRoute<TokenSetClientRegistryAuthRequirement>(
		security,
		routeOptions,
	);
}

export function secureTokenSetRouteRoot(
	security: TokenSetSecureRouteRootSecurityOptions = {},
	routeOptions: TanStackRouteOptionsLike = {},
): TanStackRouteOptionsLike {
	const previousBeforeLoad = routeOptions.beforeLoad;
	const securityBeforeLoad = createTokenSetCanBeforeLoad({
		checkClientAuthenticated: security.checkClientAuthenticated,
		onClientUnauthenticated: security.onClientUnauthenticated,
		selectClientCandidate: security.selectClientCandidate,
	});
	const secured = secureTokenSetRoute(security, routeOptions);
	return {
		...secured,
		async beforeLoad(context: TanStackBeforeLoadContextLike) {
			const previousResult = await previousBeforeLoad?.(context);
			await securityBeforeLoad(context);
			return previousResult;
		},
	};
}
