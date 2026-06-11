import { SYMBOL_DISPOSE } from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	BackendOidcModeClient,
	BackendOidcModeCompatFragmentKind,
} from "../../backend-oidc-mode";
import { FrontendOidcModeClient } from "../../frontend-oidc-mode";
import { type BaseOidcModeClient } from "../../orchestration";
import {
	selectTokenSetBackendCallbackClientFromRegistry,
	selectTokenSetFrontendCallbackClientFromRegistry,
	TokenSetCallbackClientSelectionKind,
	TokenSetRegistryCallbackErrorCode,
} from "../callback";
import {
	createTokenSetClientRegistry,
	type TokenSetClientRegistry,
} from "../core/client-registry";

function createClient<TClient extends BaseOidcModeClient>(Client: {
	readonly prototype: TClient;
}): TClient {
	const dispose = vi.fn();
	const client = {
		dispose,
		[SYMBOL_DISPOSE]: dispose,
	} as unknown as TClient;
	Object.setPrototypeOf(client, Client.prototype);
	return client;
}

function createRegistry(
	clientKey: string,
	client: BaseOidcModeClient,
	callbackPath?: string,
) {
	const registry = createTokenSetClientRegistry<BaseOidcModeClient>({
		environment: {},
	});
	registerClient(registry, clientKey, client, callbackPath);
	return registry;
}

function registerClient(
	registry: TokenSetClientRegistry<BaseOidcModeClient>,
	clientKey: string,
	client: BaseOidcModeClient,
	callbackPath?: string,
): void {
	registry.register({
		clientFactory: () => client,
		meta: {
			clientKey,
			urlPatterns: [],
			callbackPath,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: "lazy",
		},
	});
}

function backendCallbackUrl(clientKey?: string): string {
	const routingKey = clientKey
		? `&callback_routing_key=${encodeURIComponent(clientKey)}`
		: "";
	return `https://app.example.com/callback#securitydept=v1&kind=${BackendOidcModeCompatFragmentKind.Callback}${routingKey}&access_token=at`;
}

describe("token-set registry callback client selection", () => {
	it("returns a synchronous frontend record and fixed-record client resolver", async () => {
		const client = createClient(FrontendOidcModeClient);
		const registry = createRegistry(
			"frontend",
			client,
			"/auth/token-set/callback",
		);

		const selection = selectTokenSetFrontendCallbackClientFromRegistry({
			registry,
			callbackUrl: "https://app.example.com/auth/token-set/callback?code=ok",
		});

		expect(selection.kind).toBe(TokenSetCallbackClientSelectionKind.Selected);
		if (selection.kind !== TokenSetCallbackClientSelectionKind.Selected) {
			throw new Error("Expected a selected frontend callback client.");
		}
		expect(selection.clientRecord.get().meta.clientKey).toBe("frontend");
		await expect(selection.clientResolver()).resolves.toBe(client);
	});

	it("selects a backend client from the compat-fragment routing key", async () => {
		const client = createClient(BackendOidcModeClient);
		const registry = createRegistry("backend", client);

		const selection = selectTokenSetBackendCallbackClientFromRegistry({
			registry,
			callbackUrl: backendCallbackUrl("backend"),
		});

		expect(selection.kind).toBe(TokenSetCallbackClientSelectionKind.Selected);
		if (selection.kind !== TokenSetCallbackClientSelectionKind.Selected) {
			throw new Error("Expected a selected backend callback client.");
		}
		expect(selection.clientRecord.get().meta.clientKey).toBe("backend");
		await expect(selection.clientResolver()).resolves.toBe(client);
	});

	it("returns not applicable when a frontend callback path does not match", () => {
		const registry = createRegistry(
			"frontend",
			createClient(FrontendOidcModeClient),
			"/auth/token-set/callback",
		);

		expect(
			selectTokenSetFrontendCallbackClientFromRegistry({
				registry,
				callbackUrl: "https://app.example.com/not-a-callback",
			}),
		).toEqual({ kind: TokenSetCallbackClientSelectionKind.NotApplicable });
	});

	it("does not resolve a replacement record with the same client key", async () => {
		const registry = createRegistry(
			"frontend",
			createClient(FrontendOidcModeClient),
			"/auth/token-set/callback",
		);
		const selection = selectTokenSetFrontendCallbackClientFromRegistry({
			registry,
			callbackUrl: "https://app.example.com/auth/token-set/callback?code=ok",
		});
		if (selection.kind !== TokenSetCallbackClientSelectionKind.Selected) {
			throw new Error("Expected a selected frontend callback client.");
		}

		registry.unregister("frontend");
		registerClient(
			registry,
			"frontend",
			createClient(FrontendOidcModeClient),
			"/auth/token-set/callback",
		);

		await expect(selection.clientResolver()).rejects.toMatchObject({
			code: TokenSetRegistryCallbackErrorCode.ClientNotFound,
		});
	});

	it("reports backend callback routing and mode failures", async () => {
		const registry = createRegistry(
			"frontend",
			createClient(FrontendOidcModeClient),
		);

		expect(() =>
			selectTokenSetBackendCallbackClientFromRegistry({
				registry,
				callbackUrl: backendCallbackUrl(),
			}),
		).toThrowError(
			expect.objectContaining({
				code: TokenSetRegistryCallbackErrorCode.RoutingKeyMissing,
			}),
		);

		const selection = selectTokenSetBackendCallbackClientFromRegistry({
			registry,
			callbackUrl: backendCallbackUrl("frontend"),
		});
		if (selection.kind !== TokenSetCallbackClientSelectionKind.Selected) {
			throw new Error("Expected a selected backend callback client.");
		}
		await expect(selection.clientResolver()).rejects.toMatchObject({
			code: TokenSetRegistryCallbackErrorCode.ClientModeMismatch,
		});
	});

	it("rejects ambiguous frontend callback metadata", () => {
		const registry = createRegistry(
			"frontend-a",
			createClient(FrontendOidcModeClient),
			"/callback",
		);
		registerClient(
			registry,
			"frontend-b",
			createClient(FrontendOidcModeClient),
			"/callback",
		);

		expect(() =>
			selectTokenSetFrontendCallbackClientFromRegistry({
				registry,
				callbackUrl: "https://app.example.com/callback?code=ok",
			}),
		).toThrowError(
			expect.objectContaining({
				code: TokenSetRegistryCallbackErrorCode.ClientSelectionAmbiguous,
			}),
		);
	});
});
