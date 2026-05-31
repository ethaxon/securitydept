// Token-set requirement planner host — Angular DI adapter over core registry auth coordination

import {
	type EnvironmentProviders,
	inject,
	makeEnvironmentProviders,
} from "@angular/core";
import {
	type FoundationEnvironment,
	type RequirementPlannerHost,
	type RouteBehaviourContextExtra,
} from "@securitydept/client";
import {
	ENVIRONMENT,
	REQUIREMENT_PLANNER_HOST,
} from "@securitydept/client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	type ClientReadyRecordView,
	ClientRegistryPlannerHost,
	ClientRegistryRequirementBehaviour,
	type ClientRegistryRequirementBehaviourOptions,
	type OnClientUnauthenticated,
} from "@securitydept/token-set-context-client/registry";
import { TokenSetClientRegistryService } from "../client-registry.service";

/** Options for {@link provideTokenSetRequirementPlannerHost}. */
export type ProvideTokenSetRequirementPlannerHostOptions =
	ClientRegistryRequirementBehaviourOptions<
		BaseOidcModeClient,
		RouteBehaviourContextExtra
	>;

/**
 * Provide registry-backed requirement behaviour for Angular guards.
 *
 * This is intentionally a thin adapter over the framework-neutral registry
 * auth-coordination layer. Route requirements must carry
 * `attributes.query: ClientQueryOptions`.
 */
export function provideTokenSetRequirementPlannerHost(
	options: ProvideTokenSetRequirementPlannerHostOptions = {},
): EnvironmentProviders {
	return makeEnvironmentProviders([
		{
			provide: REQUIREMENT_PLANNER_HOST,
			useFactory: (): RequirementPlannerHost<unknown> => {
				const registry = inject(TokenSetClientRegistryService);
				const environment = inject(ENVIRONMENT);
				const parent =
					inject(REQUIREMENT_PLANNER_HOST, {
						optional: true,
						skipSelf: true,
					}) ?? undefined;
				const behaviour = new ClientRegistryRequirementBehaviour<
					BaseOidcModeClient,
					RouteBehaviourContextExtra
				>(registry, options);
				return new ClientRegistryPlannerHost(
					registry,
					behaviour,
					environment,
					parent as
						| RequirementPlannerHost<
								ClientRegistryRequirementBehaviour<
									BaseOidcModeClient,
									RouteBehaviourContextExtra
								>
						  >
						| undefined,
				) as RequirementPlannerHost<unknown>;
			},
		},
	]);
}

/**
 * Options for {@link createTokenSetOidcLoginRedirectHandler}.
 */
export interface CreateTokenSetOidcLoginRedirectHandlerOptions {
	/**
	 * Explicit client key. When omitted, the first unauthenticated ready client
	 * yielded by the requirement's query is used.
	 */
	clientKey?: string;
	/**
	 * Optional stable environment override. The canonical path is to provide the
	 * host-owned native web environment once via `provideEnvironment(...)`.
	 */
	environment?: FoundationEnvironment;
	/**
	 * Fallback used only when the environment router has no current URL.
	 * @default "/"
	 */
	fallbackPostAuthRedirectUri?: string;
}

/**
 * Build a registry-aware unauthenticated hook that starts OIDC redirect login.
 *
 * The hook intentionally never settles after redirect starts, so Angular does
 * not finalize the rejected in-app navigation while the page is leaving.
 */
export function createTokenSetOidcLoginRedirectHandler(
	options: CreateTokenSetOidcLoginRedirectHandlerOptions = {},
): OnClientUnauthenticated<BaseOidcModeClient, RouteBehaviourContextExtra> {
	return async (_requirement, context, clients) => {
		const environment = resolveOidcRouteEnvironment(
			options.environment ?? context.environment,
		);
		const selected = await selectRedirectClient(clients, options.clientKey);
		if (!selected) {
			return false;
		}
		await selected.client.loginWithRedirect({
			postAuthRedirectUri:
				resolveAttemptedUrl(environment) ||
				options.fallbackPostAuthRedirectUri ||
				"/",
		});
		return await neverSettlingRedirectGuardResult();
	};
}

async function selectRedirectClient(
	clients: AsyncGenerator<ClientReadyRecordView<BaseOidcModeClient>>,
	clientKey: string | undefined,
): Promise<ClientReadyRecordView<BaseOidcModeClient> | undefined> {
	for await (const record of clients) {
		if (clientKey) {
			if (record.meta.clientKey === clientKey) {
				return record;
			}
			continue;
		}
		if ((await record.client.isAuthenticated.whenValue()) !== true) {
			return record;
		}
	}
	return undefined;
}

function resolveAttemptedUrl(
	environment: FoundationEnvironment,
): string | undefined {
	return environment.router?.currentUrl()?.toString();
}

function neverSettlingRedirectGuardResult(): Promise<never> {
	return new Promise<never>(() => {
		// Intentionally never resolves: a full-page browser redirect is in progress.
	});
}

function resolveOidcRouteEnvironment(
	environment: FoundationEnvironment | undefined,
): FoundationEnvironment {
	if (!environment) {
		failMissingOidcRouteEnvironment();
	}
	if (!environment.router) {
		failMissingOidcRouteEnvironment();
	}
	return environment;
}

function failMissingOidcRouteEnvironment(): never {
	throw new Error(
		"createTokenSetOidcLoginRedirectHandler requires an explicit environment.\n" +
			"Provide the host-owned environment once from the Angular composition root with provideEnvironment({ environment: (providers) => createEnvironmentForNativeWeb({ providers, ... }) }).\n" +
			"or pass a stable environment override with createTokenSetOidcLoginRedirectHandler({ environment: ... }).",
	);
}
