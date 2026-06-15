import {
	ENVIRONMENT_TOKEN,
	REQUIREMENT_PLANNER_HOST,
	type RequirementPlannerHost,
	type RouteBehaviourContextExtra,
} from "@securitydept/client";
import {
	createTanStackBeforeLoad,
	type TanStackBeforeLoadContextLike,
} from "@securitydept/client-react/tanstack-router";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	type TokenSetClientRegistry,
	type TokenSetClientRegistryAuthRequirement,
	TokenSetClientRegistryPlannerHost,
	TokenSetClientRegistryRequirementBehaviour,
	type TokenSetClientRegistryRequirementBehaviourOptions,
	type TokenSetClientRegistryRouteRequirementBehaviourShape,
} from "@securitydept/token-set-context-client/registry";

export type TokenSetTanStackRequirementPlannerOptions =
	TokenSetClientRegistryRequirementBehaviourOptions<
		BaseOidcModeClient,
		RouteBehaviourContextExtra
	>;

export interface CreateTokenSetCanBeforeLoadOptions
	extends TokenSetTanStackRequirementPlannerOptions {}

export function createTokenSetCanBeforeLoad(
	options: CreateTokenSetCanBeforeLoadOptions = {},
) {
	return async (context: TanStackBeforeLoadContextLike): Promise<void> => {
		const injector = context.context.securitydeptInjector;
		const registry = injector.get(TOKEN_SET_CLIENT_REGISTRY);
		const environment = injector.get(ENVIRONMENT_TOKEN);
		const parent = injector.get(
			REQUIREMENT_PLANNER_HOST,
			null,
		) as RequirementPlannerHost<TokenSetClientRegistryRouteRequirementBehaviourShape> | null;
		const behaviour = new TokenSetClientRegistryRequirementBehaviour<
			BaseOidcModeClient,
			RouteBehaviourContextExtra
		>(registry as TokenSetClientRegistry, options);
		const host = new TokenSetClientRegistryPlannerHost<
			BaseOidcModeClient,
			RouteBehaviourContextExtra,
			TokenSetClientRegistryRouteRequirementBehaviourShape
		>(
			registry as TokenSetClientRegistry,
			behaviour,
			environment,
			parent ?? undefined,
		);

		return await createTanStackBeforeLoad<
			TokenSetClientRegistryAuthRequirement,
			TokenSetClientRegistryRouteRequirementBehaviourShape
		>({
			plannerHost: host,
		})(context);
	};
}
