import {
	createFoundationEnvironment,
	createInMemoryRecordStore,
} from "@securitydept/client";
import {
	FrontendOidcModeConfigProjectionSourceKind,
	injectConfigProjectionIntoRealm,
	resolveFrontendOidcModeConfigProjection,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { describe, expect, it, vi } from "vitest";

const CLIENT_KEY = "frontend-mode";
const STORAGE_KEY =
	"securitydept.frontend_oidc.config_projection:v1:frontend-mode";

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

describe("frontend OIDC config projection source precedence", () => {
	it("uses realm before persisted and network, then writes it to the cache", async () => {
		const realm = {};
		const persistentStorage = createInMemoryRecordStore();
		const execute = vi.fn(async () => ({
			status: 200,
			headers: {},
			body: createProjection("network"),
		}));
		injectConfigProjectionIntoRealm({
			clientKey: CLIENT_KEY,
			projection: createProjection("realm"),
			realm,
		});

		const resolved = await resolveFrontendOidcModeConfigProjection({
			clientKey: CLIENT_KEY,
			environment: createFoundationEnvironment({
				transport: { execute },
				persistentStorage,
			}),
			sources: [
				{
					kind: FrontendOidcModeConfigProjectionSourceKind.Realm,
					realm,
				},
				{ kind: FrontendOidcModeConfigProjectionSourceKind.Persisted },
				{
					kind: FrontendOidcModeConfigProjectionSourceKind.Network,
					endpoint: "https://app.example.com/api/auth/config",
				},
			],
		});

		expect(resolved.sourceKind).toBe(
			FrontendOidcModeConfigProjectionSourceKind.Realm,
		);
		expect(resolved.config.clientId).toBe("realm");
		expect(execute).not.toHaveBeenCalled();
		expect(
			JSON.parse((await persistentStorage.get(STORAGE_KEY)) ?? ""),
		).toEqual(resolved.projection);
	});

	it("uses a fresh persisted projection without requesting the network", async () => {
		const persistentStorage = createInMemoryRecordStore();
		await persistentStorage.set(
			STORAGE_KEY,
			JSON.stringify(createProjection("persisted")),
		);
		const execute = vi.fn(async () => ({
			status: 200,
			headers: {},
			body: createProjection("network"),
		}));

		const resolved = await resolveFrontendOidcModeConfigProjection({
			clientKey: CLIENT_KEY,
			environment: createFoundationEnvironment({
				transport: { execute },
				persistentStorage,
			}),
			sources: [
				{ kind: FrontendOidcModeConfigProjectionSourceKind.Persisted },
				{
					kind: FrontendOidcModeConfigProjectionSourceKind.Network,
					endpoint: "https://app.example.com/api/auth/config",
				},
			],
		});

		expect(resolved.sourceKind).toBe(
			FrontendOidcModeConfigProjectionSourceKind.Persisted,
		);
		expect(resolved.config.clientId).toBe("persisted");
		expect(execute).not.toHaveBeenCalled();
	});

	it("falls through stale persisted state and writes the network result back", async () => {
		const persistentStorage = createInMemoryRecordStore();
		await persistentStorage.set(
			STORAGE_KEY,
			JSON.stringify(createProjection("stale", Date.now() - 600_000)),
		);
		const execute = vi.fn(async () => ({
			status: 200,
			headers: {},
			body: createProjection("network"),
		}));

		const resolved = await resolveFrontendOidcModeConfigProjection({
			clientKey: CLIENT_KEY,
			environment: createFoundationEnvironment({
				transport: { execute },
				persistentStorage,
			}),
			sources: [
				{ kind: FrontendOidcModeConfigProjectionSourceKind.Persisted },
				{
					kind: FrontendOidcModeConfigProjectionSourceKind.Network,
					endpoint: "https://app.example.com/api/auth/config",
				},
			],
		});

		expect(resolved.sourceKind).toBe(
			FrontendOidcModeConfigProjectionSourceKind.Network,
		);
		expect(resolved.config.clientId).toBe("network");
		expect(
			JSON.parse((await persistentStorage.get(STORAGE_KEY)) ?? ""),
		).toEqual(resolved.projection);
	});
});
