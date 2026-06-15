import {
	createSignal,
	ENVIRONMENT_TOKEN,
	REQUIREMENT_PLANNER_HOST,
	RequirementPlannerHost,
	ResourceStatus,
	type RouteBehaviourContextExtra,
	readSecuritydeptRouteMetadata,
	resourceFromSnapshots,
	SecuritydeptInjector,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { createTanStackRouterContext } from "@securitydept/client-react/tanstack-router";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	TokenSetClientInitializationMode,
	TokenSetClientRegistry,
	TokenSetClientRegistryAuthRequirement,
	type TokenSetClientRegistryEntry,
	TokenSetClientRegistryRequirementBehaviour,
} from "@securitydept/token-set-context-client/registry";
import { describe, expect, it, vi } from "vitest";
import {
	createTokenSetCanBeforeLoad,
	secureTokenSetRoute,
	secureTokenSetRouteRoot,
} from "../tanstack-router";

function createClient(isAuthenticatedValue: boolean): BaseOidcModeClient {
	const isAuthenticatedSnapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: isAuthenticatedValue,
	} as const);
	const isAuthenticated = resourceFromSnapshots(() =>
		isAuthenticatedSnapshot.get(),
	);
	return {
		isAuthenticated,
		loginWithRedirect: vi.fn(async () => undefined),
		dispose: () => undefined,
		[SYMBOL_DISPOSE]: () => undefined,
	} as unknown as BaseOidcModeClient;
}

function createEntry(
	clientKey: string,
	client: BaseOidcModeClient,
): TokenSetClientRegistryEntry<BaseOidcModeClient> {
	return {
		clientFactory: () => client,
		meta: {
			clientKey,
			urlPatterns: [],
			callbackUrl: undefined,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Lazy,
		},
	};
}

describe("token-set TanStack auth coordination", () => {
	it("writes token-set requirements to route staticData", () => {
		const requirement = TokenSetClientRegistryAuthRequirement.create({
			id: "main-auth",
			query: { clientKey: "main" },
		});

		const route = secureTokenSetRoute({
			requirements: [requirement],
		});

		expect(
			readSecuritydeptRouteMetadata<TokenSetClientRegistryAuthRequirement>(
				route.staticData,
			)?.requirements,
		).toEqual([requirement]);
	});

	it("combines existing root beforeLoad before token-set beforeLoad", async () => {
		const environment = createEnvironmentForTest();
		const registry =
			TokenSetClientRegistry.fromEnvironmentConfig<BaseOidcModeClient>({
				environment,
			});
		registry.register(createEntry("main", createClient(true)));
		const injector = SecuritydeptInjector.fromParentInjector(
			environment.injector,
			[
				{ provide: TOKEN_SET_CLIENT_REGISTRY, useValue: registry },
				{ provide: ENVIRONMENT_TOKEN, useValue: environment },
			],
		);
		const previousBeforeLoad = vi.fn(async () => "previous");
		const requirement = TokenSetClientRegistryAuthRequirement.create({
			id: "main-auth",
			query: { clientKey: "main" },
		});
		const route = secureTokenSetRouteRoot(
			{
				requirements: [requirement],
			},
			{
				beforeLoad: previousBeforeLoad,
			},
		);

		await expect(
			route.beforeLoad?.({
				context: createTanStackRouterContext({ injector }),
				matches: [
					{
						routeId: "__root__",
						staticData: route.staticData,
					},
				],
				location: { href: "https://app.example.com/private" },
			}),
		).resolves.toBe("previous");
		expect(previousBeforeLoad).toHaveBeenCalledTimes(1);
	});

	it("runs custom unauthenticated hooks with route context", async () => {
		const environment = createEnvironmentForTest();
		const registry =
			TokenSetClientRegistry.fromEnvironmentConfig<BaseOidcModeClient>({
				environment,
			});
		registry.register(createEntry("main", createClient(false)));
		const onClientUnauthenticated = vi.fn(() => true);
		const parentHost = RequirementPlannerHost.fromBehaviour(
			new TokenSetClientRegistryRequirementBehaviour<
				BaseOidcModeClient,
				RouteBehaviourContextExtra
			>(registry, {
				onClientUnauthenticated,
			}),
			{ environment },
		);
		const injector = SecuritydeptInjector.fromParentInjector(
			environment.injector,
			[
				{ provide: TOKEN_SET_CLIENT_REGISTRY, useValue: registry },
				{ provide: REQUIREMENT_PLANNER_HOST, useValue: parentHost },
			],
		);
		const requirement = TokenSetClientRegistryAuthRequirement.create({
			id: "main-auth",
			query: { clientKey: "main" },
		});
		const beforeLoad = createTokenSetCanBeforeLoad({
			onClientUnauthenticated,
		});

		await beforeLoad({
			context: createTanStackRouterContext({ injector }),
			matches: [
				{
					routeId: "__root__",
					staticData: secureTokenSetRoute({
						requirements: [requirement],
					}).staticData,
				},
			],
			location: { href: "https://app.example.com/private" },
		});

		expect(onClientUnauthenticated).toHaveBeenCalledWith(
			requirement,
			expect.objectContaining({
				planContext: {
					routeState: { url: "https://app.example.com/private" },
				},
			}),
			expect.anything(),
		);
	});
});
