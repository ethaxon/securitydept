import { type RequirementsComposition } from "@securitydept/client";
import {
	secureRoute as baseSecureRoute,
	type CreateTanStackRouteSecurityPatchOptions,
	type TanStackRouteRootSecurityPatch,
	type TanStackRouteSecurityPatch,
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
	options: CreateTanStackRouteSecurityPatchOptions = {},
): TanStackRouteSecurityPatch {
	return baseSecureRoute<TokenSetClientRegistryAuthRequirement>(
		security,
		options,
	);
}

export function secureTokenSetRouteRoot(
	security: TokenSetSecureRouteRootSecurityOptions = {},
	options: CreateTanStackRouteSecurityPatchOptions = {},
): TanStackRouteRootSecurityPatch {
	const securityBeforeLoad = createTokenSetCanBeforeLoad({
		checkClientAuthenticated: security.checkClientAuthenticated,
		onClientUnauthenticated: security.onClientUnauthenticated,
		selectClientCandidate: security.selectClientCandidate,
	});
	const secured = secureTokenSetRoute(security, options);
	return {
		...secured,
		beforeLoad: securityBeforeLoad,
	};
}
