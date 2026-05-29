// Token-set secure route helpers — specialized over the client-angular base
//
// Canonical import path:
//   import { secureRoute, secureRouteRoot }
//     from "@securitydept/token-set-context-client-angular"
//
// Thin token-set specialization of the generic client-angular route helpers:
//   - secureRoute / secureRouteRoot normalize token-set requirement inputs
//     (kind -> attributes.requirementKind) and delegate to the base helpers.
//   - secureRouteRoot additionally mounts provideTokenSetRequirementPlannerHost
//     so the base guards resolve token-set behaviour through DI.
//   - createTokenSetCanActivate / createTokenSetCanActivateChild are token-set
//     named aliases over the base guard factories (host comes from DI).
//
// Stability: provisional

import {
	type CanActivateChildFn,
	type CanActivateFn,
	type Route,
} from "@angular/router";
import {
	type AuthRequirement,
	createAuthRequirement,
	type RequirementsComposition,
} from "@securitydept/client";
import {
	secureRoute as baseSecureRoute,
	secureRouteRoot as baseSecureRouteRoot,
	createAngularCanActivate,
	createAngularCanActivateChild,
	type SecureRouteConfig,
} from "@securitydept/client-angular";
import {
	type ProvideTokenSetRequirementPlannerHostOptions,
	provideTokenSetRequirementPlannerHost,
	TOKEN_SET_REQUIREMENT_KIND_ATTRIBUTE,
	type TokenSetRequirementPolicy,
} from "./planner-host";

export type { TokenSetRequirementPolicy };

/**
 * Token-set requirement declaration for route metadata.
 *
 * `kind` is stored under `attributes.requirementKind` so the token-set planner
 * host can map it to registry clients.
 */
export interface TokenSetAuthRequirementInput {
	/** Stable requirement id (matches `requirementPolicies` keys). */
	id: string;
	/** Token-set requirement kind (default registry mapping). */
	kind?: string;
	/** Human-readable label. */
	label?: string;
	/** Extra opaque attributes merged alongside `requirementKind`. */
	attributes?: Record<string, unknown>;
}

/** Serializable token-set security declaration for a child route. */
export interface TokenSetSecureRouteSecurityOptions {
	/** Requirements declared at this route segment. */
	requirements?: readonly TokenSetAuthRequirementInput[];
	/** Composition strategy against ancestor requirements (default `merge`). */
	composition?: RequirementsComposition;
}

/** Root-level token-set security: metadata plus behaviour policy. */
export interface TokenSetSecureRouteRootSecurityOptions
	extends TokenSetSecureRouteSecurityOptions,
		ProvideTokenSetRequirementPlannerHostOptions {}

function normalizeTokenSetRequirement(
	input: TokenSetAuthRequirementInput,
): AuthRequirement {
	const attributes =
		input.kind !== undefined
			? {
					...input.attributes,
					[TOKEN_SET_REQUIREMENT_KIND_ATTRIBUTE]: input.kind,
				}
			: input.attributes;
	return createAuthRequirement({
		id: input.id,
		label: input.label,
		attributes,
	});
}

function normalizeRequirements(
	requirements: readonly TokenSetAuthRequirementInput[] | undefined,
): AuthRequirement[] {
	return (requirements ?? []).map(normalizeTokenSetRequirement);
}

/**
 * Create a token-set `CanActivateFn`. The behaviour host is resolved from DI
 * (provided by {@link provideTokenSetRequirementPlannerHost}).
 */
export function createTokenSetCanActivate(): CanActivateFn {
	return createAngularCanActivate();
}

/**
 * Create a token-set `CanActivateChildFn`. The behaviour host is resolved from
 * DI (provided by {@link provideTokenSetRequirementPlannerHost}).
 */
export function createTokenSetCanActivateChild(): CanActivateChildFn {
	return createAngularCanActivateChild();
}

/**
 * Declare a secured child route. Writes token-set requirement metadata only —
 * enforcement is owned by a guarded {@link secureRouteRoot} ancestor.
 */
export function secureRoute(
	path: string,
	security: TokenSetSecureRouteSecurityOptions = {},
	routeOptions?: SecureRouteConfig,
): Route {
	return baseSecureRoute(
		path,
		{
			requirements: normalizeRequirements(security.requirements),
			composition: security.composition,
		},
		routeOptions,
	);
}

/**
 * Declare a guarded token-set route root. Delegates guard assembly to the
 * client-angular base helper and mounts a token-set behaviour host provider so
 * the base guards resolve registry-backed behaviour through DI.
 */
export function secureRouteRoot(
	path: string,
	security: TokenSetSecureRouteRootSecurityOptions = {},
	routeOptions?: SecureRouteConfig,
): Route {
	const providers = [
		...(routeOptions?.providers ?? []),
		provideTokenSetRequirementPlannerHost({
			requirementPolicies: security.requirementPolicies,
			requirementHandlers: security.requirementHandlers,
			defaultOnUnauthenticated: security.defaultOnUnauthenticated,
		}),
	];
	return baseSecureRouteRoot(
		path,
		{
			requirements: normalizeRequirements(security.requirements),
			composition: security.composition,
		},
		{
			...routeOptions,
			providers,
		},
	);
}

/** Token-set-named alias for {@link secureRoute}. */
export const secureTokenSetRoute = secureRoute;

/** Token-set-named alias for {@link secureRouteRoot}. */
export const secureTokenSetRouteRoot = secureRouteRoot;
