import {
	createInMemoryRecordStore,
	RouteCompositionRequirementPlanner,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendOidcModeClient } from "../../backend-oidc-mode/client/client";
import { createBackendOidcModeClientFactory } from "../../backend-oidc-mode/client/client-factory";
import { FrontendOidcModeClient } from "../../frontend-oidc-mode/client/client";
import { createFrontendOidcModeClientFactory } from "../../frontend-oidc-mode/client/client-factory";
import { type TokenSetRefreshErrorPolicy } from "../../orchestration/client/types";
import {
	TokenSetClientRegistryAuthRequirement,
	TokenSetClientRegistryPlannerHost,
	TokenSetClientRegistryRequirementBehaviour,
} from "../auth-coordination";
import { TokenSetClientRegistry } from "../core/client-registry";

const expired = {
	tokens: {
		accessToken: "expired",
		refreshMaterial: "revoked",
		accessTokenExpiresAt: "2020-01-01T00:00:00Z",
	},
	metadata: {},
};

async function harness(
	mode: "frontend" | "backend",
	response: {
		status: number;
		headers: Record<string, string>;
		body: Record<string, string>;
	},
	policy?: TokenSetRefreshErrorPolicy,
) {
	const store = createInMemoryRecordStore();
	await store.set(
		"auth",
		JSON.stringify({ version: 1, storedAt: Date.now(), value: expired }),
	);
	const transport = { execute: vi.fn(async () => response) };
	const environment = createEnvironmentForTest({
		persistentStorage: store,
		transport,
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(JSON.stringify(response.body), {
					status: response.status,
					headers: response.headers,
				}),
		),
	);
	const common = {
		persistence: { key: "auth" },
		refreshErrorPolicy: policy,
		refresh: { sources: { refreshTimer: false as const } },
	};
	const factory =
		mode === "frontend"
			? createFrontendOidcModeClientFactory({
					callbackInputResolver: null,
					config: {
						...common,
						issuer: "https://auth.example.com",
						clientId: "client",
						redirectUri: "https://app.example.com/callback",
						authorizationEndpoint: "https://auth.example.com/authorize",
						tokenEndpoint: "https://auth.example.com/token",
					},
				})
			: createBackendOidcModeClientFactory({
					callbackInputResolver: null,
					config: { ...common, baseUrl: "https://auth.example.com" },
				});
	const registry = TokenSetClientRegistry.fromEnvironmentConfig({
		environment,
	});
	registry.register({
		clientFactory: factory,
		meta: { clientKey: "auth", urlPatterns: [], initialization: "lazy" },
	});
	const behaviour = new TokenSetClientRegistryRequirementBehaviour(registry);
	const requirement = TokenSetClientRegistryAuthRequirement.create({
		query: { clientKey: "auth" },
	});
	const host = new TokenSetClientRegistryPlannerHost(
		registry,
		behaviour,
		environment,
	);
	const planner = RouteCompositionRequirementPlanner.fromRouteSegments(
		host,
		[{ routeId: "confluence", requirements: [requirement] }],
		{ url: "/confluence/workspaces?tab=owned" },
	);
	return { registry, store, planner };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

for (const mode of ["frontend", "backend"] as const) {
	describe(`${mode} revoked session recovery`, () => {
		it.each([
			"invalid_grant",
			"invalid_token",
		] as const)("initializes a revoked %s session and logs in on the first protected navigation", async (error) => {
			const login =
				mode === "frontend"
					? vi
							.spyOn(FrontendOidcModeClient.prototype, "loginWithRedirect")
							.mockResolvedValue(undefined)
					: vi
							.spyOn(BackendOidcModeClient.prototype, "loginWithRedirect")
							.mockResolvedValue(undefined);
			const {
				registry: owned,
				store,
				planner,
			} = await harness(mode, {
				status: error === "invalid_token" ? 401 : 400,
				headers: {
					"content-type": "application/json",
					...(error === "invalid_token"
						? { "www-authenticate": 'Bearer error="invalid_token"' }
						: {}),
				},
				body: { error },
			});
			using registry = owned;
			const action = planner.runUntilSettled();
			await vi.waitFor(() => expect(login).toHaveBeenCalledOnce());
			expect(login).toHaveBeenCalledWith({
				postAuthRedirectUri: "/confluence/workspaces?tab=owned",
			});
			expect(registry.clientRecordFor("auth").get().status).toBe("resolved");
			expect(await store.get("auth")).toBeNull();
			await expect(
				Promise.race([
					action.then(() => "settled"),
					Promise.resolve("redirecting"),
				]),
			).resolves.toBe("redirecting");
		});

		it.each([
			401, 503,
		])("does not classify a plain HTTP %s as revocation", async (status) => {
			const { registry: owned, store } = await harness(mode, {
				status,
				headers: { "content-type": "application/json" },
				body: { error: "server_error" },
			});
			using registry = owned;
			await expect(
				registry.clientRecordFor("auth", { initialize: true }),
			).rejects.toBeDefined();
			expect(await store.get("auth")).not.toBeNull();
		});

		it("recovers runtime revocation before the next protected navigation", async () => {
			const login =
				mode === "frontend"
					? vi
							.spyOn(FrontendOidcModeClient.prototype, "loginWithRedirect")
							.mockResolvedValue(undefined)
					: vi
							.spyOn(BackendOidcModeClient.prototype, "loginWithRedirect")
							.mockResolvedValue(undefined);
			const { registry: owned, planner } = await harness(mode, {
				status: 400,
				headers: { "content-type": "application/json" },
				body: { error: "invalid_grant" },
			});
			using registry = owned;
			const record = await registry.clientRecordFor("auth", {
				initialize: true,
			});
			await record.client.restoreState(expired);
			await expect(record.client.refreshState()).resolves.toBeNull();
			const action = planner.runUntilSettled();
			await vi.waitFor(() =>
				expect(login).toHaveBeenCalledWith({
					postAuthRedirectUri: "/confluence/workspaces?tab=owned",
				}),
			);
			await expect(
				Promise.race([
					action.then(() => "settled"),
					Promise.resolve("redirecting"),
				]),
			).resolves.toBe("redirecting");
		});

		it.each([
			'Bearer realm="api,error=invalid_token"',
			'Basic realm="api", error="invalid_token"',
			'Bearer error="invalid_token_extra"',
		])("does not recover a misleading challenge: %s", async (challenge) => {
			const { registry: owned, store } = await harness(mode, {
				status: 401,
				headers: {
					"content-type": "application/json",
					"www-authenticate": challenge,
				},
				body: {},
			});
			using registry = owned;
			await expect(
				registry.clientRecordFor("auth", { initialize: true }),
			).rejects.toBeDefined();
			expect(await store.get("auth")).not.toBeNull();
		});

		it("accepts invalid_token following a quoted realm", async () => {
			const { registry: owned } = await harness(mode, {
				status: 401,
				headers: {
					"content-type": "application/json",
					"www-authenticate": 'Bearer realm="api", error="invalid_token"',
				},
				body: {},
			});
			using registry = owned;
			const record = await registry.clientRecordFor("auth", {
				initialize: true,
			});
			expect(await record.client.isAuthenticated.whenValue()).toBe(false);
		});

		it("propagates a configured strict policy through the factory", async () => {
			const { registry: owned, store } = await harness(
				mode,
				{
					status: 400,
					headers: { "content-type": "application/json" },
					body: { error: "invalid_grant" },
				},
				"throw",
			);
			using registry = owned;
			await expect(
				registry.clientRecordFor("auth", { initialize: true }),
			).rejects.toMatchObject({ name: "TokenSetAuthorizationRevocationError" });
			expect(await store.get("auth")).toBeNull();
		});
	});
}
