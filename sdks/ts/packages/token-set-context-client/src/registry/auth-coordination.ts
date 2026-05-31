import {
	type AuthenticatedCheck,
	type AuthRequirement,
	type DisposableTrait,
	type FoundationEnvironment,
	isRouteBehaviourContextExtra,
	promisesToRacedAsyncGenerator,
	type ReadableReplaySignalTrait,
	type RequirementBehaviour,
	type RequirementBehaviourContext,
	type RequirementCandidateSelectionContext,
	RequirementPlannerHost,
	type UnauthenticatedAction,
} from "@securitydept/client";
import { v7 as uuidv7 } from "uuid";
import { type BaseOidcModeClient } from "../orchestration/client/base-client";
import { type OidcRedirectLoginOptions } from "../orchestration/client/types";
import { type ClientQueryOptions } from "./contracts/query";
import { type ClientReadyRecordView } from "./contracts/types";
import { type ClientRegistry } from "./core/client-registry";

export interface ClientRegistryOidcModeClient extends DisposableTrait {
	readonly isAuthenticated: ReadableReplaySignalTrait<boolean>;
	loginWithRedirect(options?: OidcRedirectLoginOptions): Promise<void>;
}

export interface ClientRegistryAuthRequirementInput {
	readonly id?: string;
	readonly label?: string;
	readonly query: ClientQueryOptions;
}

export class ClientRegistryAuthRequirement implements AuthRequirement {
	readonly id: string;
	readonly label?: string;
	readonly attributes: Readonly<{
		query: ClientQueryOptions;
	}>;

	protected constructor(
		id: string,
		label: string | undefined,
		attributes: Readonly<{
			query: ClientQueryOptions;
		}>,
	) {
		this.id = id;
		this.label = label;
		this.attributes = Object.freeze(attributes);
	}

	static create(
		input: ClientRegistryAuthRequirementInput,
	): ClientRegistryAuthRequirement {
		return new ClientRegistryAuthRequirement(
			input.id ?? uuidv7(),
			input.label,
			Object.freeze({ query: input.query }),
		);
	}
}

export type ClientRegistryClientGenerator<
	TClient extends ClientRegistryOidcModeClient = BaseOidcModeClient,
> = AsyncGenerator<ClientReadyRecordView<TClient>, void, unknown>;

export type ClientRegistryAuthRequirementContext<TPlanContext = {}> =
	RequirementBehaviourContext<ClientRegistryAuthRequirement, TPlanContext>;

export type ClientRegistryAuthRequirementCandidateSelectionContext<
	TPlanContext = {},
> = RequirementCandidateSelectionContext<
	ClientRegistryAuthRequirement,
	TPlanContext
>;

export type CheckClientAuthenticated<
	TClient extends ClientRegistryOidcModeClient = BaseOidcModeClient,
	TPlanContext = {},
> = (
	requirement: ClientRegistryAuthRequirement,
	context: ClientRegistryAuthRequirementContext<TPlanContext>,
	clients: ClientRegistryClientGenerator<TClient>,
) => AuthenticatedCheck;

export type OnClientUnauthenticated<
	TClient extends ClientRegistryOidcModeClient = BaseOidcModeClient,
	TPlanContext = {},
> = (
	requirement: ClientRegistryAuthRequirement,
	context: ClientRegistryAuthRequirementContext<TPlanContext>,
	clients: ClientRegistryClientGenerator<TClient>,
) => UnauthenticatedAction;

export type SelectClientCandidate<
	TClient extends ClientRegistryOidcModeClient = BaseOidcModeClient,
	TPlanContext = {},
> = (
	requirement: ClientRegistryAuthRequirement,
	context: ClientRegistryAuthRequirementCandidateSelectionContext<TPlanContext>,
	clients: ClientRegistryClientGenerator<TClient>,
) => boolean | Promise<boolean>;

export interface ClientRegistryRequirementBehaviourOptions<
	TClient extends ClientRegistryOidcModeClient = BaseOidcModeClient,
	TPlanContext = {},
> {
	readonly checkClientAuthenticated?: CheckClientAuthenticated<
		TClient,
		TPlanContext
	>;
	readonly onClientUnauthenticated?: OnClientUnauthenticated<
		TClient,
		TPlanContext
	>;
	readonly selectClientCandidate?: SelectClientCandidate<TClient, TPlanContext>;
}

export class ClientRegistryRequirementBehaviour<
	TClient extends ClientRegistryOidcModeClient = BaseOidcModeClient,
	TPlanContext = {},
> implements RequirementBehaviour<ClientRegistryAuthRequirement, TPlanContext>
{
	constructor(
		private readonly registry: ClientRegistry<TClient>,
		private readonly options: ClientRegistryRequirementBehaviourOptions<
			TClient,
			TPlanContext
		> = {},
	) {}

	readonly checkAuthenticated = async (
		requirement: ClientRegistryAuthRequirement,
		context: ClientRegistryAuthRequirementContext<TPlanContext>,
	): Promise<boolean> => {
		const clients = this.resolveClientViews(requirement);
		const checkClientAuthenticated = this.options.checkClientAuthenticated;
		if (checkClientAuthenticated) {
			return await checkClientAuthenticated(requirement, context, clients);
		}
		return await this.defaultCheckClientAuthenticated(clients);
	};

	readonly onUnauthenticated = async (
		requirement: ClientRegistryAuthRequirement,
		context: ClientRegistryAuthRequirementContext<TPlanContext>,
	): Promise<boolean | string> => {
		const clients = this.resolveClientViews(requirement);
		const onClientUnauthenticated = this.options.onClientUnauthenticated;
		if (onClientUnauthenticated) {
			return await onClientUnauthenticated(requirement, context, clients);
		}
		return await this.defaultOnClientUnauthenticated(clients, context);
	};

	readonly selectCandidate = async (
		context: ClientRegistryAuthRequirementCandidateSelectionContext<TPlanContext>,
	): Promise<ClientRegistryAuthRequirement | undefined> => {
		const selectClientCandidate = this.options.selectClientCandidate;
		if (!selectClientCandidate) {
			const firstCandidate = await context.candidateList.next();
			return firstCandidate.done ? undefined : firstCandidate.value;
		}

		let firstCandidate: ClientRegistryAuthRequirement | undefined;
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
		requirement: ClientRegistryAuthRequirement,
	): ClientRegistryClientGenerator<TClient> {
		return promisesToRacedAsyncGenerator(
			[
				...this.registry.clientRecordGenForQuery(requirement.attributes.query),
			].map(async (recordSignal) => {
				const view = await this.registry.initialize(
					recordSignal.get().meta.clientKey,
				);
				await view.client.isAuthenticated.whenValue();
				return view;
			}),
		);
	}

	private async defaultCheckClientAuthenticated(
		clients: ClientRegistryClientGenerator<TClient>,
	): Promise<boolean> {
		for await (const client of clients) {
			if ((await client.client.isAuthenticated.whenValue()) !== true) {
				return false;
			}
		}
		return true;
	}

	private async defaultOnClientUnauthenticated(
		clients: ClientRegistryClientGenerator<TClient>,
		context: ClientRegistryAuthRequirementContext<TPlanContext>,
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

export class ClientRegistryPlannerHost<
	TClient extends ClientRegistryOidcModeClient = BaseOidcModeClient,
	TPlanContext = {},
> extends RequirementPlannerHost<
	ClientRegistryRequirementBehaviour<TClient, TPlanContext>
> {
	constructor(
		readonly registry: ClientRegistry<TClient>,
		behaviour: ClientRegistryRequirementBehaviour<TClient, TPlanContext>,
		environment?: FoundationEnvironment,
		parent?: RequirementPlannerHost<
			ClientRegistryRequirementBehaviour<TClient, TPlanContext>
		>,
	) {
		super(behaviour, environment, parent);
	}
}
