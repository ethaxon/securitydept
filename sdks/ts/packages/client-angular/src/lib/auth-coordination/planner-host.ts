// Angular planner-host integration — DI-based RequirementPlannerHost wiring
//
// Canonical import path:
//   import {
//     REQUIREMENT_PLANNER_HOST,
//     provideRequirementPlannerHost,
//     injectRequirementPlannerHost,
//   } from "@securitydept/client-angular"
//
// Maps Angular's hierarchical DI onto the SDK's `RequirementPlannerHost` parent
// chain: each scope that calls `provideRequirementPlannerHost` builds a host
// whose `parent` is the nearest ancestor host (looked up via `skipSelf`). Leaf
// guards then resolve behaviour by walking that chain, mirroring route/DI
// scoping without any framework coupling in the core.
//
// Architecture boundary:
//   - Does NOT own the planner-host contract (that lives in @securitydept/client)
//   - Does NOT carry token-set-specific mapping or policy
//   - Provides only the Angular DI wiring for the shared contract
//
// Stability: provisional

import {
	type EnvironmentProviders,
	InjectionToken,
	inject,
	makeEnvironmentProviders,
} from "@angular/core";
import {
	type AuthRequirement,
	type RequirementBehaviour,
	RequirementPlannerHost,
} from "@securitydept/client";
import { ENVIRONMENT } from "../environment";

/**
 * DI token for the nearest {@link RequirementPlannerHost}.
 *
 * Provide at app / route scope via {@link provideRequirementPlannerHost}.
 * Guards read the nearest instance via {@link injectRequirementPlannerHost}.
 */
export const REQUIREMENT_PLANNER_HOST = new InjectionToken<
	RequirementPlannerHost<unknown>
>("REQUIREMENT_PLANNER_HOST");

/**
 * A partial behaviour, or a factory that produces one inside an Angular
 * injection context (so it may call `inject()` to resolve DI services).
 */
export type RequirementPlannerHostBehaviour<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
	TBehaviour extends Partial<
		RequirementBehaviour<TAuthRequirement, TPlanContext>
	> = Partial<RequirementBehaviour<TAuthRequirement, TPlanContext>>,
> = TBehaviour | (() => TBehaviour);

/**
 * Provide a {@link RequirementPlannerHost} at the current injector scope.
 *
 * The host's `parent` is resolved from the nearest ancestor host via
 * `skipSelf`, so nested route/module scopes compose into a behaviour chain
 * that mirrors DI hierarchy. `behaviour` may be a factory to resolve DI
 * services (e.g. a registry) at construction time.
 *
 * @example
 * ```ts
 * // app.config.ts
 * providers: [provideRequirementPlannerHost(() => ({
 *   checkAuthenticated: (req) => inject(AuthService).isReady(req),
 *   onUnauthenticated: (req) => `/login/${req.id}`,
 * }))],
 * ```
 */
export function provideRequirementPlannerHost<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
	TBehaviour extends Partial<
		RequirementBehaviour<TAuthRequirement, TPlanContext>
	> = Partial<RequirementBehaviour<TAuthRequirement, TPlanContext>>,
>(
	behaviour: RequirementPlannerHostBehaviour<
		TAuthRequirement,
		TPlanContext,
		TBehaviour
	>,
): EnvironmentProviders {
	return makeEnvironmentProviders([
		{
			provide: REQUIREMENT_PLANNER_HOST,
			useFactory: (): RequirementPlannerHost<unknown> => {
				// skipSelf avoids reading our own (not-yet-created) token value.
				const parent =
					inject(REQUIREMENT_PLANNER_HOST, {
						optional: true,
						skipSelf: true,
					}) ?? undefined;
				const resolved =
					typeof behaviour === "function" ? behaviour() : behaviour;
				return RequirementPlannerHost.fromBehaviour(resolved, {
					parent: parent as RequirementPlannerHost<TBehaviour> | undefined,
					environment:
						inject(ENVIRONMENT, {
							optional: true,
						}) ?? undefined,
				}) as RequirementPlannerHost<unknown>;
			},
		},
	]);
}

/** Options for {@link injectRequirementPlannerHost}. */
export interface InjectRequirementPlannerHostOptions {
	/** Skip the current injector level (read the parent host). */
	skipSelf?: boolean;
}

/**
 * Inject the nearest {@link RequirementPlannerHost}, or `null` when none is
 * provided in the current injector hierarchy.
 *
 * Returning `null` (rather than throwing) lets guards fall back to a
 * self-managed host; required behaviour still fails fast during planner build
 * if no host provides it.
 */
export function injectRequirementPlannerHost<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
	TPlanContext = {},
	TBehaviour extends Partial<
		RequirementBehaviour<TAuthRequirement, TPlanContext>
	> = Partial<RequirementBehaviour<TAuthRequirement, TPlanContext>>,
>(
	options?: InjectRequirementPlannerHostOptions,
): RequirementPlannerHost<TBehaviour> | null {
	return inject(REQUIREMENT_PLANNER_HOST, {
		optional: true,
		skipSelf: options?.skipSelf ?? false,
	}) as RequirementPlannerHost<TBehaviour> | null;
}
