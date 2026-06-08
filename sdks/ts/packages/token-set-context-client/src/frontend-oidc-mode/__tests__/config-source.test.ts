import {
	ClientErrorKind,
	createCancellationTokenSource,
	createFoundationEnvironment,
	createInMemoryRecordStore,
	type HttpResponse,
	type StorageTrait,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	FrontendOidcModeConfigProjectionSourceKind,
	injectConfigProjectionIntoRealm,
	resolveFrontendOidcModeConfigProjection,
} from "../index";

const CLIENT_KEY = "frontend-client";

function createProjection(clientId: string, generatedAt = Date.now()) {
	return {
		clientId,
		redirectUrl: "https://app.example.com/auth/callback",
		issuerUrl: "https://issuer.example.com",
		authorizationEndpoint: "https://issuer.example.com/authorize",
		tokenEndpoint: "https://issuer.example.com/token",
		generatedAt,
	};
}

function createEnvironment(options: {
	response?: HttpResponse;
	persistentStorage?: StorageTrait;
}) {
	const execute = vi.fn(async () =>
		Promise.resolve(
			options.response ?? {
				status: 200,
				headers: {},
				body: createProjection("network"),
			},
		),
	);
	return {
		environment: createFoundationEnvironment({
			transport: { execute },
			persistentStorage: options.persistentStorage,
		}),
		execute,
	};
}

describe("frontend OIDC config projection sources", () => {
	it("validates and resolves an inline projection", async () => {
		const { environment } = createEnvironment({});
		const projection = createProjection("inline");

		const resolved = await resolveFrontendOidcModeConfigProjection({
			clientKey: CLIENT_KEY,
			environment,
			sources: [
				{
					kind: FrontendOidcModeConfigProjectionSourceKind.Inline,
					projection,
				},
			],
			overrides: { redirectUri: "https://app.example.com/callback" },
		});

		expect(resolved).toMatchObject({
			projection,
			sourceKind: FrontendOidcModeConfigProjectionSourceKind.Inline,
			config: {
				clientId: "inline",
				redirectUri: "https://app.example.com/callback",
			},
		});
	});

	it("injects and reads a projection through the default realm key", async () => {
		const { environment } = createEnvironment({});
		const projection = createProjection("realm-default");
		const key = Symbol.for(
			`securitydept.frontend_oidc.config_projection:v1:${CLIENT_KEY}`,
		);
		injectConfigProjectionIntoRealm({ clientKey: CLIENT_KEY, projection });

		try {
			const resolved = await resolveFrontendOidcModeConfigProjection({
				clientKey: CLIENT_KEY,
				environment,
				sources: [{ kind: FrontendOidcModeConfigProjectionSourceKind.Realm }],
			});
			expect(resolved.projection.clientId).toBe("realm-default");
		} finally {
			Reflect.deleteProperty(globalThis, key);
		}
	});

	it("supports an explicit realm and property key", async () => {
		const { environment } = createEnvironment({});
		const realm = {};
		const key = "frontend-oidc-projection";
		injectConfigProjectionIntoRealm({
			clientKey: CLIENT_KEY,
			projection: createProjection("realm-explicit"),
			realm,
			key,
		});

		const resolved = await resolveFrontendOidcModeConfigProjection({
			clientKey: CLIENT_KEY,
			environment,
			sources: [
				{
					kind: FrontendOidcModeConfigProjectionSourceKind.Realm,
					realm,
					key,
				},
			],
		});

		expect(resolved.projection.clientId).toBe("realm-explicit");
	});

	it("uses a fresh persisted projection without requesting the network", async () => {
		const persistentStorage = createInMemoryRecordStore();
		await persistentStorage.set(
			`securitydept.frontend_oidc.config_projection:v1:${CLIENT_KEY}`,
			JSON.stringify(createProjection("persisted")),
		);
		const { environment, execute } = createEnvironment({ persistentStorage });

		const resolved = await resolveFrontendOidcModeConfigProjection({
			clientKey: CLIENT_KEY,
			environment,
			sources: [
				{ kind: FrontendOidcModeConfigProjectionSourceKind.Persisted },
				{
					kind: FrontendOidcModeConfigProjectionSourceKind.Network,
					endpoint: "/api/auth/config",
				},
			],
		});

		expect(resolved.projection.clientId).toBe("persisted");
		expect(execute).not.toHaveBeenCalled();
	});

	it("fetches and writes back when the persisted projection is stale", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const storageKey = `securitydept.frontend_oidc.config_projection:v1:${CLIENT_KEY}`;
		await persistentStorage.set(
			storageKey,
			JSON.stringify(createProjection("stale", Date.now() - 600_000)),
		);
		const { environment, execute } = createEnvironment({ persistentStorage });

		const resolved = await resolveFrontendOidcModeConfigProjection({
			clientKey: CLIENT_KEY,
			environment,
			sources: [
				{ kind: FrontendOidcModeConfigProjectionSourceKind.Persisted },
				{
					kind: FrontendOidcModeConfigProjectionSourceKind.Network,
					endpoint: "/api/auth/config",
				},
			],
		});

		expect(resolved.projection.clientId).toBe("network");
		expect(execute).toHaveBeenCalledWith({
			url: "/api/auth/config",
			method: "GET",
			headers: { accept: "application/json" },
			cancellationToken: undefined,
		});
		expect(JSON.parse((await persistentStorage.get(storageKey)) ?? "")).toEqual(
			resolved.projection,
		);
	});

	it("does not fall back after a malformed realm projection", async () => {
		const realm = { projection: { clientId: "invalid" } };
		const { environment, execute } = createEnvironment({});

		await expect(
			resolveFrontendOidcModeConfigProjection({
				clientKey: CLIENT_KEY,
				environment,
				sources: [
					{
						kind: FrontendOidcModeConfigProjectionSourceKind.Realm,
						realm,
						key: "projection",
					},
					{
						kind: FrontendOidcModeConfigProjectionSourceKind.Network,
						endpoint: "/api/auth/config",
					},
				],
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Protocol,
			code: "frontend_oidc.config.invalid_projection",
		});
		expect(execute).not.toHaveBeenCalled();
	});

	it("treats a present null realm value as malformed rather than absent", async () => {
		const realm = { projection: null };
		const { environment, execute } = createEnvironment({});

		await expect(
			resolveFrontendOidcModeConfigProjection({
				clientKey: CLIENT_KEY,
				environment,
				sources: [
					{
						kind: FrontendOidcModeConfigProjectionSourceKind.Realm,
						realm,
						key: "projection",
					},
					{
						kind: FrontendOidcModeConfigProjectionSourceKind.Network,
						endpoint: "/api/auth/config",
					},
				],
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Protocol,
			code: "frontend_oidc.config.invalid_projection",
		});
		expect(execute).not.toHaveBeenCalled();
	});

	it("passes the cancellation token to the environment transport", async () => {
		const cancellation = createCancellationTokenSource();
		const { environment, execute } = createEnvironment({});

		await resolveFrontendOidcModeConfigProjection({
			clientKey: CLIENT_KEY,
			environment,
			cancellationToken: cancellation.token,
			sources: [
				{
					kind: FrontendOidcModeConfigProjectionSourceKind.Network,
					endpoint: "/api/auth/config",
				},
			],
		});

		expect(execute).toHaveBeenCalledWith(
			expect.objectContaining({ cancellationToken: cancellation.token }),
		);
	});

	it("does not reinterpret cancellation before source resolution", async () => {
		const cancellation = createCancellationTokenSource();
		cancellation.cancel("test cancellation");
		const { environment, execute } = createEnvironment({});

		await expect(
			resolveFrontendOidcModeConfigProjection({
				clientKey: CLIENT_KEY,
				environment,
				cancellationToken: cancellation.token,
				sources: [
					{
						kind: FrontendOidcModeConfigProjectionSourceKind.Network,
						endpoint: "/api/auth/config",
					},
				],
			}),
		).rejects.toMatchObject({ kind: ClientErrorKind.Cancelled });
		expect(execute).not.toHaveBeenCalled();
	});

	it("rejects multiple persisted source descriptors", async () => {
		const { environment } = createEnvironment({});

		await expect(
			resolveFrontendOidcModeConfigProjection({
				clientKey: CLIENT_KEY,
				environment,
				sources: [
					{ kind: FrontendOidcModeConfigProjectionSourceKind.Persisted },
					{
						kind: FrontendOidcModeConfigProjectionSourceKind.Persisted,
						storageKey: "secondary",
					},
				],
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Configuration,
			code: "frontend_oidc.config.multiple_persisted_sources",
		});
	});

	it("does not fall back after a persistent storage read failure", async () => {
		const cause = new Error("storage unavailable");
		const { environment, execute } = createEnvironment({
			persistentStorage: {
				get: async () => {
					throw cause;
				},
				set: async () => undefined,
				remove: async () => undefined,
			},
		});

		await expect(
			resolveFrontendOidcModeConfigProjection({
				clientKey: CLIENT_KEY,
				environment,
				sources: [
					{ kind: FrontendOidcModeConfigProjectionSourceKind.Persisted },
					{
						kind: FrontendOidcModeConfigProjectionSourceKind.Network,
						endpoint: "/api/auth/config",
					},
				],
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Storage,
			code: "frontend_oidc.config.persistence_read_failed",
			cause,
		});
		expect(execute).not.toHaveBeenCalled();
	});

	it("fails when all optional sources are unavailable", async () => {
		const { environment } = createEnvironment({});

		await expect(
			resolveFrontendOidcModeConfigProjection({
				clientKey: CLIENT_KEY,
				environment,
				sources: [
					{
						kind: FrontendOidcModeConfigProjectionSourceKind.Realm,
						realm: {},
					},
					{ kind: FrontendOidcModeConfigProjectionSourceKind.Persisted },
				],
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Configuration,
			code: "frontend_oidc.config.sources_exhausted",
		});
	});
});
