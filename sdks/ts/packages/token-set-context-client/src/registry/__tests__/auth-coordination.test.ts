import {
	createFoundationEnvironment,
	StaticRequirementPlanner,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	BaseOidcModeClient,
	type BaseOidcModeClientOptions,
	type TokenSetAuthSnapshot,
} from "../../orchestration";
import {
	TokenSetClientRegistryAuthRequirement,
	type TokenSetClientRegistryClientGenerator,
	TokenSetClientRegistryPlannerHost,
	TokenSetClientRegistryRequirementBehaviour,
} from "../auth-coordination";
import { type TokenSetClientQueryOptions } from "../contracts/query";
import { TokenSetClientInitializationMode } from "../contracts/types";
import { createTokenSetClientRegistry } from "../core/client-registry";

function createOptions(id: string): BaseOidcModeClientOptions {
	return {
		environment: createFoundationEnvironment({}),
		tracing: {
			target: "test-token-set",
			prefix: "test_token_set",
		},
		id,
	};
}

function createAuthSnapshot(accessToken: string): TokenSetAuthSnapshot {
	return {
		tokens: {
			accessToken,
			accessTokenIssuedAt: new Date(Date.now() - 60_000).toISOString(),
			accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
		},
		metadata: {},
	};
}

class TestOidcClient extends BaseOidcModeClient {
	readonly loginWithRedirect = vi.fn(async () => undefined);

	constructor(id: string) {
		super(createOptions(id));
	}

	async loginWithPopup(): Promise<never> {
		throw new Error("not implemented");
	}

	protected async _refreshAuthSnapshot(
		snapshot: TokenSetAuthSnapshot,
	): Promise<TokenSetAuthSnapshot | null> {
		return snapshot;
	}
}

async function createClient(
	id: string,
	authenticated: boolean,
): Promise<TestOidcClient> {
	const client = new TestOidcClient(id);
	if (authenticated) {
		await client.restoreState(createAuthSnapshot(`${id}-at`));
	} else {
		await client.start();
	}
	return client;
}

function createRequirement(
	id: string,
	query: TokenSetClientQueryOptions,
): TokenSetClientRegistryAuthRequirement {
	return TokenSetClientRegistryAuthRequirement.create({
		id,
		query,
	});
}

function createContext(
	requirements: readonly TokenSetClientRegistryAuthRequirement[],
) {
	return {
		planContext: {},
		environment: createFoundationEnvironment({}),
		requirements,
		resolutionList: [],
	};
}

function createRouteContext(
	requirements: readonly TokenSetClientRegistryAuthRequirement[],
	url: string,
) {
	return {
		planContext: { routeState: { url } },
		environment: createFoundationEnvironment({}),
		requirements,
		resolutionList: [],
	};
}

async function collectClientKeys(
	clients: TokenSetClientRegistryClientGenerator<TestOidcClient>,
): Promise<string[]> {
	const clientKeys: string[] = [];
	for await (const view of clients) {
		clientKeys.push(view.meta.clientKey);
	}
	return clientKeys;
}

describe("TokenSetClientRegistryRequirementBehaviour", () => {
	it("treats all matched authenticated clients as fulfilled", async () => {
		const registry = createTokenSetClientRegistry<TestOidcClient>({
			environment: {},
		});
		const first = await createClient("first", true);
		const second = await createClient("second", true);
		registry.register({
			clientFactory: () => first,
			meta: {
				clientKey: "first",
				urlPatterns: [],
				callbackPath: undefined,
				requirementKind: "workspace",
				providerFamily: undefined,
				initialization: TokenSetClientInitializationMode.Lazy,
			},
		});
		registry.register({
			clientFactory: () => second,
			meta: {
				clientKey: "second",
				urlPatterns: [],
				callbackPath: undefined,
				requirementKind: "workspace",
				providerFamily: undefined,
				initialization: TokenSetClientInitializationMode.Lazy,
			},
		});
		const requirement = createRequirement("workspace", {
			requirementKind: "workspace",
		});
		const behaviour = new TokenSetClientRegistryRequirementBehaviour(registry);

		await expect(
			behaviour.checkAuthenticated(requirement, createContext([requirement])),
		).resolves.toBe(true);
	});

	it("keeps a requirement unauthenticated when any matched client is false", async () => {
		const registry = createTokenSetClientRegistry<TestOidcClient>({
			environment: {},
		});
		const first = await createClient("first", true);
		const second = await createClient("second", false);
		for (const [clientKey, client] of [
			["first", first],
			["second", second],
		] as const) {
			registry.register({
				clientFactory: () => client,
				meta: {
					clientKey,
					urlPatterns: [],
					callbackPath: undefined,
					requirementKind: "workspace",
					providerFamily: undefined,
					initialization: TokenSetClientInitializationMode.Lazy,
				},
			});
		}
		const requirement = createRequirement("workspace", {
			requirementKind: "workspace",
		});
		const behaviour = new TokenSetClientRegistryRequirementBehaviour(registry);

		await expect(
			behaviour.checkAuthenticated(requirement, createContext([requirement])),
		).resolves.toBe(false);
	});

	it("treats requirements with no matching clients as fulfilled", async () => {
		const registry = createTokenSetClientRegistry<TestOidcClient>({
			environment: {},
		});
		const requirement = createRequirement("missing", { clientKey: "missing" });
		const behaviour = new TokenSetClientRegistryRequirementBehaviour(registry);

		await expect(
			behaviour.checkAuthenticated(requirement, createContext([requirement])),
		).resolves.toBe(true);
	});

	it("starts redirect login for the first unauthenticated client and stays pending", async () => {
		const registry = createTokenSetClientRegistry<TestOidcClient>({
			environment: {},
		});
		const first = await createClient("first", true);
		const second = await createClient("second", false);
		for (const [clientKey, client] of [
			["first", first],
			["second", second],
		] as const) {
			registry.register({
				clientFactory: () => client,
				meta: {
					clientKey,
					urlPatterns: [],
					callbackPath: undefined,
					requirementKind: "workspace",
					providerFamily: undefined,
					initialization: TokenSetClientInitializationMode.Lazy,
				},
			});
		}
		const requirement = createRequirement("workspace", {
			requirementKind: "workspace",
		});
		const behaviour = new TokenSetClientRegistryRequirementBehaviour(registry);

		const action = behaviour.onUnauthenticated(
			requirement,
			createContext([requirement]),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(first.loginWithRedirect).not.toHaveBeenCalled();
		expect(second.loginWithRedirect).toHaveBeenCalledTimes(1);
		await expect(
			Promise.race([
				action.then(
					() => "settled",
					() => "settled",
				),
				new Promise((resolve) => setTimeout(() => resolve("pending"), 10)),
			]),
		).resolves.toBe("pending");
	});

	it("passes route state url as post-auth redirect URI for default redirect login", async () => {
		const registry = createTokenSetClientRegistry<TestOidcClient>({
			environment: {},
		});
		const client = await createClient("workspace", false);
		registry.register({
			clientFactory: () => client,
			meta: {
				clientKey: "workspace",
				urlPatterns: [],
				callbackPath: undefined,
				requirementKind: "workspace",
				providerFamily: undefined,
				initialization: TokenSetClientInitializationMode.Lazy,
			},
		});
		const requirement = createRequirement("workspace", {
			requirementKind: "workspace",
		});
		const behaviour = new TokenSetClientRegistryRequirementBehaviour(registry);

		const action = behaviour.onUnauthenticated(
			requirement,
			createRouteContext([requirement], "/workspace/documents?tab=owned"),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(client.loginWithRedirect).toHaveBeenCalledWith({
			postAuthRedirectUri: "/workspace/documents?tab=owned",
		});
		await expect(
			Promise.race([
				action.then(
					() => "settled",
					() => "settled",
				),
				new Promise((resolve) => setTimeout(() => resolve("pending"), 10)),
			]),
		).resolves.toBe("pending");
	});

	it("passes typed requirement context and ready clients to custom hooks", async () => {
		const registry = createTokenSetClientRegistry<TestOidcClient>({
			environment: {},
		});
		const client = await createClient("workspace", false);
		registry.register({
			clientFactory: () => client,
			meta: {
				clientKey: "workspace",
				urlPatterns: [],
				callbackPath: undefined,
				requirementKind: "workspace",
				providerFamily: undefined,
				initialization: TokenSetClientInitializationMode.Lazy,
			},
		});
		const requirement = createRequirement("workspace", {
			requirementKind: "workspace",
		});
		const seenClientKeys: string[][] = [];
		const behaviour = new TokenSetClientRegistryRequirementBehaviour(registry, {
			checkClientAuthenticated: async (hookRequirement, context, clients) => {
				expect(hookRequirement.attributes.query).toEqual({
					requirementKind: "workspace",
				});
				expect(context.requirements[0]).toBe(requirement);
				seenClientKeys.push(await collectClientKeys(clients));
				return false;
			},
			onClientUnauthenticated: async (_hookRequirement, _context, clients) => {
				seenClientKeys.push(await collectClientKeys(clients));
				return false;
			},
		});

		await expect(
			behaviour.checkAuthenticated(requirement, createContext([requirement])),
		).resolves.toBe(false);
		await expect(
			behaviour.onUnauthenticated(requirement, createContext([requirement])),
		).resolves.toBe(false);
		expect(seenClientKeys).toEqual([["workspace"], ["workspace"]]);
	});

	it("starts matched client initialization immediately and yields ready clients first", async () => {
		const registry = createTokenSetClientRegistry<TestOidcClient>({
			environment: {},
		});
		const second = await createClient("second", true);
		const firstFactory = vi.fn(
			() =>
				new Promise<TestOidcClient>(() => {
					// Keep the first initialization pending so the raced generator yields
					// the second ready client first.
				}),
		);
		const secondFactory = vi.fn(() => second);
		registry.register({
			clientFactory: firstFactory,
			meta: {
				clientKey: "first",
				urlPatterns: [],
				callbackPath: undefined,
				requirementKind: "workspace",
				providerFamily: undefined,
				initialization: TokenSetClientInitializationMode.Lazy,
			},
		});
		registry.register({
			clientFactory: secondFactory,
			meta: {
				clientKey: "second",
				urlPatterns: [],
				callbackPath: undefined,
				requirementKind: "workspace",
				providerFamily: undefined,
				initialization: TokenSetClientInitializationMode.Lazy,
			},
		});
		const requirement = createRequirement("workspace", {
			requirementKind: "workspace",
		});
		const behaviour = new TokenSetClientRegistryRequirementBehaviour(registry, {
			checkClientAuthenticated: async (_hookRequirement, _context, clients) => {
				const firstResult = await clients.next();
				if (firstResult.done) {
					return false;
				}
				return firstResult.value.meta.clientKey === "second";
			},
		});

		await expect(
			behaviour.checkAuthenticated(requirement, createContext([requirement])),
		).resolves.toBe(true);
		expect(firstFactory).toHaveBeenCalledTimes(1);
		expect(secondFactory).toHaveBeenCalledTimes(1);
	});

	it("yields ready clients in authentication signal completion order", async () => {
		const registry = createTokenSetClientRegistry<TestOidcClient>({
			environment: {},
		});
		const first = new TestOidcClient("first");
		const second = await createClient("second", false);
		const firstFactory = vi.fn(() => first);
		const secondFactory = vi.fn(() => second);
		registry.register({
			clientFactory: firstFactory,
			meta: {
				clientKey: "first",
				urlPatterns: [],
				callbackPath: undefined,
				requirementKind: "workspace",
				providerFamily: undefined,
				initialization: TokenSetClientInitializationMode.Lazy,
			},
		});
		registry.register({
			clientFactory: secondFactory,
			meta: {
				clientKey: "second",
				urlPatterns: [],
				callbackPath: undefined,
				requirementKind: "workspace",
				providerFamily: undefined,
				initialization: TokenSetClientInitializationMode.Lazy,
			},
		});
		const requirement = createRequirement("workspace", {
			requirementKind: "workspace",
		});
		const behaviour = new TokenSetClientRegistryRequirementBehaviour(registry, {
			checkClientAuthenticated: async (_hookRequirement, _context, clients) => {
				const firstResult = await clients.next();
				if (firstResult.done) {
					return false;
				}
				return firstResult.value.meta.clientKey === "second";
			},
		});

		await expect(
			behaviour.checkAuthenticated(requirement, createContext([requirement])),
		).resolves.toBe(true);
		expect(firstFactory).toHaveBeenCalledTimes(1);
		expect(secondFactory).toHaveBeenCalledTimes(1);
	});

	it("uses custom selectClientCandidate as an ordered predicate", async () => {
		const registry = createTokenSetClientRegistry<TestOidcClient>({
			environment: {},
		});
		const first = await createClient("first", false);
		const second = await createClient("second", false);
		for (const [clientKey, client] of [
			["first", first],
			["second", second],
		] as const) {
			registry.register({
				clientFactory: () => client,
				meta: {
					clientKey,
					urlPatterns: [],
					callbackPath: undefined,
					requirementKind: clientKey,
					providerFamily: undefined,
					initialization: TokenSetClientInitializationMode.Lazy,
				},
			});
		}
		const firstRequirement = createRequirement("first", {
			requirementKind: "first",
		});
		const secondRequirement = createRequirement("second", {
			requirementKind: "second",
		});
		const selectedClientKeys: string[] = [];
		const behaviour = new TokenSetClientRegistryRequirementBehaviour(registry, {
			onClientUnauthenticated: () => false,
			selectClientCandidate: async (_requirement, _context, clients) => {
				const clientKeys = await collectClientKeys(clients);
				selectedClientKeys.push(...clientKeys);
				return clientKeys.includes("second");
			},
		});
		const host = new TokenSetClientRegistryPlannerHost(
			registry,
			behaviour,
			createFoundationEnvironment({}),
		);
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			firstRequirement,
			secondRequirement,
		]);

		const plan = await planner.buildPlan();
		const step = await planner.runStep(plan);

		expect(step.outcome).toBe("blocked");
		if (step.outcome === "blocked") {
			expect(step.requirement.id).toBe("second");
		}
		expect(selectedClientKeys).toEqual(["first", "second"]);
	});

	it("supports TokenSetClientRegistryPlannerHost in the auth planner pipeline", async () => {
		const registry = createTokenSetClientRegistry<TestOidcClient>({
			environment: {},
		});
		const client = await createClient("workspace", true);
		registry.register({
			clientFactory: () => client,
			meta: {
				clientKey: "workspace",
				urlPatterns: [],
				callbackPath: undefined,
				requirementKind: "workspace",
				providerFamily: undefined,
				initialization: TokenSetClientInitializationMode.Lazy,
			},
		});
		const requirement = createRequirement("workspace", {
			requirementKind: "workspace",
		});
		const host = new TokenSetClientRegistryPlannerHost(
			registry,
			new TokenSetClientRegistryRequirementBehaviour(registry),
			createFoundationEnvironment({}),
		);
		const planner = StaticRequirementPlanner.fromRequirements(host, [
			requirement,
		]);

		await expect(planner.runUntilSettled()).resolves.toMatchObject({
			outcome: "settled",
			resolutions: [{ requirementId: "workspace", status: "fulfilled" }],
		});
	});
});
