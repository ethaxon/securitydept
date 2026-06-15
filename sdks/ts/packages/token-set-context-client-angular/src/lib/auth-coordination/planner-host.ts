// Token-set requirement planner host — Angular DI adapter over core registry auth coordination

import {
	type EnvironmentProviders,
	inject,
	makeEnvironmentProviders,
} from "@angular/core";
import {
	REQUIREMENT_PLANNER_HOST,
	type RequirementPlannerHost,
	type RouteBehaviourContextExtra,
	SecuritydeptInjector,
} from "@securitydept/client";
import {
	ENVIRONMENT,
	SECURITYDEPT_INJECTOR,
} from "@securitydept/client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientRegistryPlannerHost,
	TokenSetClientRegistryRequirementBehaviour,
	type TokenSetClientRegistryRequirementBehaviourOptions,
	type TokenSetClientRegistryRouteRequirementBehaviourShape,
} from "@securitydept/token-set-context-client/registry";
import { TOKEN_SET_CLIENT_REGISTRY } from "../client-registry";

/** Options for {@link provideTokenSetRequirementPlannerHost}. */
export type ProvideTokenSetRequirementPlannerHostOptions =
	TokenSetClientRegistryRequirementBehaviourOptions<
		BaseOidcModeClient,
		RouteBehaviourContextExtra
	>;

/**
 * Provide registry-backed requirement behaviour for Angular guards.
 *
 * This is intentionally a thin adapter over the framework-neutral registry
 * auth-coordination layer. Route requirements must carry
 * `attributes.query: TokenSetClientQueryOptions`.
 */
export function provideTokenSetRequirementPlannerHost(
	options: ProvideTokenSetRequirementPlannerHostOptions = {},
): EnvironmentProviders {
	return makeEnvironmentProviders([
		{
			provide: SECURITYDEPT_INJECTOR,
			useFactory: (): SecuritydeptInjector => {
				const registry = inject(TOKEN_SET_CLIENT_REGISTRY);
				const environment = inject(ENVIRONMENT);
				const parentInjector =
					inject(SECURITYDEPT_INJECTOR, {
						optional: true,
						skipSelf: true,
					}) ?? undefined;
				const parent = (parentInjector?.get(REQUIREMENT_PLANNER_HOST, null) ??
					undefined) as
					| RequirementPlannerHost<TokenSetClientRegistryRouteRequirementBehaviourShape>
					| undefined;
				const behaviour = new TokenSetClientRegistryRequirementBehaviour<
					BaseOidcModeClient,
					RouteBehaviourContextExtra
				>(registry, options);
				const host = new TokenSetClientRegistryPlannerHost<
					BaseOidcModeClient,
					RouteBehaviourContextExtra,
					TokenSetClientRegistryRouteRequirementBehaviourShape
				>(registry, behaviour, environment, parent);
				const providers = [
					{
						provide: REQUIREMENT_PLANNER_HOST,
						useValue: host as RequirementPlannerHost<unknown>,
					},
				];
				return parentInjector
					? SecuritydeptInjector.fromParentInjector(parentInjector, providers)
					: SecuritydeptInjector.resolveAndCreate(providers);
			},
		},
	]);
}
