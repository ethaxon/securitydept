import {
	ENVIRONMENT_TOKEN,
	REQUIREMENT_PLANNER_HOST,
	RequirementPlannerHost,
	ResourceStatus,
	type RouteBehaviourContextExtra,
	readSecuritydeptRouteMetadata,
	SecuritydeptInjector,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { createTanStackRouterContext } from "@securitydept/client-react/tanstack-router";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	TokenSetClientRegistry,
	TokenSetClientRegistryAuthRequirement,
	TokenSetClientRegistryRequirementBehaviour,
} from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetClientForTest,
	createTokenSetClientRegistryEntryForTest,
} from "@securitydept/token-set-context-client/test";
import { describe, expect, it, vi } from "vitest";
import {
	createTokenSetCanBeforeLoad,
	secureTokenSetRoute,
	secureTokenSetRouteRoot,
} from "../tanstack-router";

function createClient(isAuthenticatedValue: boolean): BaseOidcModeClient {
	return createTokenSetClientForTest({
		authSnapshot: {
			status: ResourceStatus.Resolved,
			value: isAuthenticatedValue
				? { tokens: { accessToken: "test-at" }, metadata: {} }
				: null,
		},
		loginWithRedirect: vi.fn(async () => undefined),
	});
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

	it("returns a focused root patch and runs token-set beforeLoad", async () => {
		const environment = createEnvironmentForTest();
		const registry =
			TokenSetClientRegistry.fromEnvironmentConfig<BaseOidcModeClient>({
				environment,
			});
		registry.register(
			createTokenSetClientRegistryEntryForTest({
				clientKey: "main",
				client: createClient(true),
			}),
		);
		const injector = SecuritydeptInjector.fromParentInjector(
			environment.injector,
			[
				{ provide: TOKEN_SET_CLIENT_REGISTRY, useValue: registry },
				{ provide: ENVIRONMENT_TOKEN, useValue: environment },
			],
		);
		const requirement = TokenSetClientRegistryAuthRequirement.create({
			id: "main-auth",
			query: { clientKey: "main" },
		});
		const route = secureTokenSetRouteRoot(
			{
				requirements: [requirement],
			},
			{
				staticData: { title: "Private" },
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
		).resolves.toBeUndefined();
		expect(route.staticData).toMatchObject({ title: "Private" });
		expect(Object.keys(route).sort()).toEqual(["beforeLoad", "staticData"]);
	});

	it("runs custom unauthenticated hooks with route context", async () => {
		const environment = createEnvironmentForTest();
		const registry =
			TokenSetClientRegistry.fromEnvironmentConfig<BaseOidcModeClient>({
				environment,
			});
		registry.register(
			createTokenSetClientRegistryEntryForTest({
				clientKey: "main",
				client: createClient(false),
			}),
		);
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
