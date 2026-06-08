import {
	type AuthenticatedCheck,
	type AuthRequirement,
	type DisposableTrait,
	type FoundationEnvironment,
	isRouteBehaviourContextExtra,
	promisesToRacedAsyncGenerator,
	type RequirementBehaviour,
	type RequirementBehaviourContext,
	type RequirementBehaviourWithRouteContext,
	type RequirementCandidateSelectionContext,
	RequirementPlannerHost,
	type ResourceTrait,
	type UnauthenticatedAction,
} from "@securitydept/client";
import { v7 as uuidv7 } from "uuid";
import { type BaseOidcModeClient } from "../orchestration/client/base-client";
import { type TokenSetOidcRedirectLoginOptions } from "../orchestration/client/types";
import { type TokenSetClientQueryOptions } from "./contracts/query";
import { type TokenSetClientReadyRecordView } from "./contracts/types";
import { type TokenSetClientRegistry } from "./core/client-registry";

export interface TokenSetClientRegistryOidcModeClient extends DisposableTrait {
	readonly isAuthenticated: ResourceTrait<boolean>;
	loginWithRedirect(options?: TokenSetOidcRedirectLoginOptions): Promise<void>;
}

export interface TokenSetClientRegistryAuthRequirementInput {
	readonly id?: string;
	readonly label?: string;
	readonly query: TokenSetClientQueryOptions;
}

export class TokenSetClientRegistryAuthRequirement implements AuthRequirement {
	readonly id: string;
	readonly label?: string;
	readonly attributes: Readonly<{
		query: TokenSetClientQueryOptions;
	}>;

	protected constructor(
		id: string,
		label: string | undefined,
		attributes: Readonly<{
			query: TokenSetClientQueryOptions;
		}>,
	) {
		this.id = id;
		this.label = label;
		this.attributes = Object.freeze(attributes);
	}

	static create(
		input: TokenSetClientRegistryAuthRequirementInput,
	): TokenSetClientRegistryAuthRequirement {
		return new TokenSetClientRegistryAuthRequirement(
			input.id ?? uuidv7(),
			input.label,
			Object.freeze({ query: input.query }),
		);
	}
}

export type TokenSetClientRegistryClientGenerator<
	TClient extends TokenSetClientRegistryOidcModeClient = BaseOidcModeClient,
> = AsyncGenerator<TokenSetClientReadyRecordView<TClient>, void, unknown>;

export type TokenSetClientRegistryAuthRequirementContext<TPlanContext = {}> =
	RequirementBehaviourContext<
		TokenSetClientRegistryAuthRequirement,
		TPlanContext
	>;

export type TokenSetClientRegistryAuthRequirementCandidateSelectionContext<
	TPlanContext = {},
> = RequirementCandidateSelectionContext<
	TokenSetClientRegistryAuthRequirement,
	TPlanContext
>;

export type TokenSetCheckClientAuthenticated<
	TClient extends TokenSetClientRegistryOidcModeClient = BaseOidcModeClient,
	TPlanContext = {},
> = (
	requirement: TokenSetClientRegistryAuthRequirement,
	context: TokenSetClientRegistryAuthRequirementContext<TPlanContext>,
	clients: TokenSetClientRegistryClientGenerator<TClient>,
) => AuthenticatedCheck;

export type TokenSetOnClientUnauthenticated<
	TClient extends TokenSetClientRegistryOidcModeClient = BaseOidcModeClient,
	TPlanContext = {},
> = (
	requirement: TokenSetClientRegistryAuthRequirement,
	context: TokenSetClientRegistryAuthRequirementContext<TPlanContext>,
	clients: TokenSetClientRegistryClientGenerator<TClient>,
) => UnauthenticatedAction;

export type TokenSetSelectClientCandidate<
	TClient extends TokenSetClientRegistryOidcModeClient = BaseOidcModeClient,
	TPlanContext = {},
> = (
	requirement: TokenSetClientRegistryAuthRequirement,
	context: TokenSetClientRegistryAuthRequirementCandidateSelectionContext<TPlanContext>,
	clients: TokenSetClientRegistryClientGenerator<TClient>,
) => boolean | Promise<boolean>;

export interface TokenSetClientRegistryRequirementBehaviourOptions<
	TClient extends TokenSetClientRegistryOidcModeClient = BaseOidcModeClient,
	TPlanContext = {},
> {
	readonly checkClientAuthenticated?: TokenSetCheckClientAuthenticated<
		TClient,
		TPlanContext
	>;
	readonly onClientUnauthenticated?: TokenSetOnClientUnauthenticated<
		TClient,
		TPlanContext
	>;
	readonly selectClientCandidate?: TokenSetSelectClientCandidate<
		TClient,
		TPlanContext
	>;
}

/**
 * Partial planner-host behaviour contract for token-set registry requirements.
 *
 * Hosts and planners (`BaseRequirementPlanner`, `RouteCompositionRequirementPlanner`)
 * should bind this shape — not the concrete behaviour class — so covariance stays
 * sound without adapter-side casts.
 */
export interface TokenSetClientRegistryRequirementBehaviourShape<
	TPlanContext = {},
> extends Partial<
		RequirementBehaviour<TokenSetClientRegistryAuthRequirement, TPlanContext>
	> {}

/** Route-scoped partial behaviour for token-set registry planner hosts. */
export interface TokenSetClientRegistryRouteRequirementBehaviourShape
	extends Partial<
		RequirementBehaviourWithRouteContext<TokenSetClientRegistryAuthRequirement>
	> {}

export class TokenSetClientRegistryRequirementBehaviour<
	TClient extends TokenSetClientRegistryOidcModeClient = BaseOidcModeClient,
	TPlanContext = {},
> implements
		RequirementBehaviour<TokenSetClientRegistryAuthRequirement, TPlanContext>
{
	constructor(
		private readonly registry: TokenSetClientRegistry<TClient>,
		private readonly options: TokenSetClientRegistryRequirementBehaviourOptions<
			TClient,
			TPlanContext
		> = {},
	) {}

	readonly checkAuthenticated = async (
		requirement: TokenSetClientRegistryAuthRequirement,
		context: TokenSetClientRegistryAuthRequirementContext<TPlanContext>,
	): Promise<boolean> => {
		const clients = this.resolveClientViews(requirement);
		const checkClientAuthenticated = this.options.checkClientAuthenticated;
		if (checkClientAuthenticated) {
			return await checkClientAuthenticated(requirement, context, clients);
		}
		return await this.defaultCheckClientAuthenticated(clients);
	};

	readonly onUnauthenticated = async (
		requirement: TokenSetClientRegistryAuthRequirement,
		context: TokenSetClientRegistryAuthRequirementContext<TPlanContext>,
	): Promise<boolean | string> => {
		const clients = this.resolveClientViews(requirement);
		const onClientUnauthenticated = this.options.onClientUnauthenticated;
		if (onClientUnauthenticated) {
			return await onClientUnauthenticated(requirement, context, clients);
		}
		return await this.defaultOnClientUnauthenticated(clients, context);
	};

	readonly selectCandidate = async (
		context: TokenSetClientRegistryAuthRequirementCandidateSelectionContext<TPlanContext>,
	): Promise<TokenSetClientRegistryAuthRequirement | undefined> => {
		const selectClientCandidate = this.options.selectClientCandidate;
		if (!selectClientCandidate) {
			const firstCandidate = await context.candidateList.next();
			return firstCandidate.done ? undefined : firstCandidate.value;
		}

		let firstCandidate: TokenSetClientRegistryAuthRequirement | undefined;
		for await (const candidate of context.candidateList) {
			firstCandidate ??= candidate;
			const clients = this.resolveClientViews(candidate);
			if (await selectClientCandidate(candidate, context, clients)) {
				return candidate;
			}
		}
		return firstCandidate;
	};

	private resolveClientViews(
		requirement: TokenSetClientRegistryAuthRequirement,
	): TokenSetClientRegistryClientGenerator<TClient> {
		return promisesToRacedAsyncGenerator(
			[
				...this.registry.clientRecordGenForQuery(requirement.attributes.query),
			].map(async (recordSignal) => {
				const view = await this.registry.clientRecordFor(
					recordSignal.get().meta.clientKey,
					{ initialize: true },
				);
				await view.client.isAuthenticated.whenValue();
				return view;
			}),
		);
	}

	private async defaultCheckClientAuthenticated(
		clients: TokenSetClientRegistryClientGenerator<TClient>,
	): Promise<boolean> {
		for await (const client of clients) {
			if ((await client.client.isAuthenticated.whenValue()) !== true) {
				return false;
			}
		}
		return true;
	}

	private async defaultOnClientUnauthenticated(
		clients: TokenSetClientRegistryClientGenerator<TClient>,
		context: TokenSetClientRegistryAuthRequirementContext<TPlanContext>,
	): Promise<boolean> {
		for await (const client of clients) {
			if ((await client.client.isAuthenticated.whenValue()) !== true) {
				await client.client.loginWithRedirect(
					isRouteBehaviourContextExtra(context.planContext)
						? { postAuthRedirectUri: context.planContext.routeState.url }
						: undefined,
				);
				return await new Promise<never>(() => {
					// Keep the planner pending while a full-page redirect is in progress.
				});
			}
		}
		return true;
	}
}

export class TokenSetClientRegistryPlannerHost<
	TClient extends TokenSetClientRegistryOidcModeClient = BaseOidcModeClient,
	TPlanContext = {},
	TBehaviour extends
		TokenSetClientRegistryRequirementBehaviourShape<TPlanContext> = TokenSetClientRegistryRequirementBehaviourShape<TPlanContext>,
> extends RequirementPlannerHost<TBehaviour> {
	constructor(
		readonly registry: TokenSetClientRegistry<TClient>,
		behaviour: TBehaviour,
		environment?: FoundationEnvironment,
		parent?: RequirementPlannerHost<TBehaviour>,
	) {
		super(behaviour, environment, parent);
	}
}
