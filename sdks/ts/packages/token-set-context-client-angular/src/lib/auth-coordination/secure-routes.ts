// Token-set secure route helpers — query-first registry requirements

import {
	type CanActivateChildFn,
	type CanActivateFn,
	type Route,
} from "@angular/router";
import { type RequirementsComposition } from "@securitydept/client";
import {
	secureRoute as baseSecureRoute,
	secureRouteRoot as baseSecureRouteRoot,
	type CreateAngularGuardOptions,
	createAngularCanActivate,
	createAngularCanActivateChild,
	type SecureRouteConfig,
} from "@securitydept/client-angular";
import { type TokenSetClientRegistryAuthRequirement } from "@securitydept/token-set-context-client/registry";
import {
	type ProvideTokenSetRequirementPlannerHostOptions,
	provideTokenSetRequirementPlannerHost,
} from "./planner-host";

/** Serializable token-set security declaration for a child route. */
export interface TokenSetSecureRouteSecurityOptions {
	/** Requirements declared at this route segment. */
	requirements?: readonly TokenSetClientRegistryAuthRequirement[];
	/** Composition strategy against ancestor requirements (default `merge`). */
	composition?: RequirementsComposition;
}

/** Root-level token-set security: metadata plus registry behaviour hooks. */
export interface TokenSetSecureRouteRootSecurityOptions
	extends TokenSetSecureRouteSecurityOptions,
		ProvideTokenSetRequirementPlannerHostOptions {}

/** Guard factory options specialized to token-set registry requirements. */
export type TokenSetAngularGuardOptions =
	CreateAngularGuardOptions<TokenSetClientRegistryAuthRequirement>;

/**
 * Create a token-set `CanActivateFn`. The behaviour host is resolved from DI
 * (provided by {@link provideTokenSetRequirementPlannerHost}).
 */
export function createTokenSetCanActivate(
	options?: TokenSetAngularGuardOptions,
): CanActivateFn {
	return createAngularCanActivate<TokenSetClientRegistryAuthRequirement>(
		options,
	);
}

/**
 * Create a token-set `CanActivateChildFn`. The behaviour host is resolved from
 * DI (provided by {@link provideTokenSetRequirementPlannerHost}).
 */
export function createTokenSetCanActivateChild(
	options?: TokenSetAngularGuardOptions,
): CanActivateChildFn {
	return createAngularCanActivateChild<TokenSetClientRegistryAuthRequirement>(
		options,
	);
}

/**
 * Declare a secured child route. Writes token-set registry requirement
 * metadata only; enforcement is owned by a guarded
 * {@link secureTokenSetRouteRoot} ancestor.
 */
export function secureTokenSetRoute(
	path: string,
	security: TokenSetSecureRouteSecurityOptions = {},
	routeOptions?: SecureRouteConfig,
): Route {
	return baseSecureRoute<TokenSetClientRegistryAuthRequirement>(
		path,
		{
			requirements: security.requirements,
			composition: security.composition,
		},
		routeOptions,
	);
}

/**
 * Declare a guarded token-set route root. Delegates guard assembly to the
 * client-angular base helper and mounts registry-backed behaviour hooks.
 */
export function secureTokenSetRouteRoot(
	path: string,
	security: TokenSetSecureRouteRootSecurityOptions = {},
	routeOptions?: SecureRouteConfig,
): Route {
	const providers = [
		...(routeOptions?.providers ?? []),
		provideTokenSetRequirementPlannerHost({
			checkClientAuthenticated: security.checkClientAuthenticated,
			onClientUnauthenticated: security.onClientUnauthenticated,
			selectClientCandidate: security.selectClientCandidate,
		}),
	];
	return baseSecureRouteRoot<TokenSetClientRegistryAuthRequirement>(
		path,
		{
			requirements: security.requirements,
			composition: security.composition,
		},
		{
			...routeOptions,
			providers,
		},
	);
}
