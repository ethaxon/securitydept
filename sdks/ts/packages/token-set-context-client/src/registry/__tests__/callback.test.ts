import { ResourceStatus, UriReferenceString } from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { describe, expect, it, vi } from "vitest";
import {
	BackendOidcModeClient,
	BackendOidcModeCompatFragmentKind,
} from "../../backend-oidc-mode";
import {
	type FrontendOidcModeCallbackResult,
	FrontendOidcModeClient,
} from "../../frontend-oidc-mode";
import {
	type BaseOidcModeClient,
	type TokenSetAuthSnapshot,
} from "../../orchestration";
import {
	createTokenSetClientForTest,
	createTokenSetClientRegistryEntryForTest,
	createTokenSetClientRegistryForTest,
	TokenSetClientForTest,
} from "../../test";
import {
	selectTokenSetBackendCallbackClientFromRegistry,
	selectTokenSetFrontendCallbackClientFromRegistry,
	type TokenSetBackendCallbackClient,
	type TokenSetCallbackClientGuard,
	TokenSetCallbackClientSelectionKind,
	type TokenSetFrontendCallbackClient,
	TokenSetRegistryCallbackErrorCode,
} from "../callback";
import { type TokenSetClientRegistry } from "../core/client-registry";

const testEnvironment = createEnvironmentForTest();

function createFrontendClient(): TokenSetClientForTest<FrontendOidcModeCallbackResult> {
	return createTokenSetClientForTest<FrontendOidcModeCallbackResult>();
}

function createBackendClient(): TokenSetClientForTest<TokenSetAuthSnapshot> {
	return createTokenSetClientForTest<TokenSetAuthSnapshot>();
}

const frontendClientGuard: TokenSetCallbackClientGuard<
	TokenSetFrontendCallbackClient
> = (client): client is TokenSetFrontendCallbackClient =>
	client instanceof TokenSetClientForTest;

const backendClientGuard: TokenSetCallbackClientGuard<
	TokenSetBackendCallbackClient
> = (client): client is TokenSetBackendCallbackClient =>
	client instanceof TokenSetClientForTest;

function createRegistry(
	clientKey: string,
	client: BaseOidcModeClient,
	callbackUrl?: string | readonly string[],
) {
	const registry = createTokenSetClientRegistryForTest<BaseOidcModeClient>({
		environment: testEnvironment,
	});
	registerClient(registry, clientKey, client, callbackUrl);
	return registry;
}

function registerClient(
	registry: TokenSetClientRegistry<BaseOidcModeClient>,
	clientKey: string,
	client: BaseOidcModeClient,
	callbackUrl?: string | readonly string[],
): void {
	registry.register(
		createTokenSetClientRegistryEntryForTest({
			clientKey,
			client,
			callbackUrl,
		}),
	);
}

function backendCallbackUrl(clientKey?: string): string {
	const routingKey = clientKey
		? `&callback_routing_key=${encodeURIComponent(clientKey)}`
		: "";
	return `https://app.example.com/callback#securitydept=v1&kind=${BackendOidcModeCompatFragmentKind.Callback}${routingKey}&access_token=at`;
}

describe("token-set registry callback client selection", () => {
	it("returns a frontend client selection snapshot signal", async () => {
		const client = createFrontendClient();
		const registry = createRegistry(
			"frontend",
			client,
			"/auth/token-set/callback",
		);

		const selection = selectTokenSetFrontendCallbackClientFromRegistry({
			registry,
			callbackUrl: "https://app.example.com/auth/token-set/callback?code=ok",
			clientGuard: frontendClientGuard,
			initialize: true,
		});

		await vi.waitFor(() => {
			expect(selection.get()).toEqual({
				status: ResourceStatus.Resolved,
				value: {
					kind: TokenSetCallbackClientSelectionKind.Selected,
					client,
				},
			});
		});
	});

	it("uses nominal mode guards when no custom client guard is provided", async () => {
		const frontendClient = FrontendOidcModeClient.fromEnvironmentConfig({
			environment: testEnvironment,
			config: {
				issuer: "https://issuer.example.com",
				clientId: "frontend",
				redirectUri: "https://app.example.com/frontend-callback",
			},
			callbackInputResolver: null,
		});
		const frontendRegistry = createRegistry(
			"frontend",
			frontendClient,
			"/frontend-callback",
		);
		const frontendSelection = selectTokenSetFrontendCallbackClientFromRegistry({
			registry: frontendRegistry,
			callbackUrl: "https://app.example.com/frontend-callback?code=ok",
			initialize: true,
		});

		await vi.waitFor(() => {
			expect(frontendSelection.get()).toMatchObject({
				status: ResourceStatus.Resolved,
				value: { kind: TokenSetCallbackClientSelectionKind.Selected },
			});
		});

		const backendClient = BackendOidcModeClient.fromEnvironmentConfig({
			environment: testEnvironment,
			config: { baseUrl: "https://api.example.com" },
			callbackInputResolver: null,
		});
		const backendRegistry = createRegistry("backend", backendClient);
		const backendSelection = selectTokenSetBackendCallbackClientFromRegistry({
			registry: backendRegistry,
			callbackUrl: backendCallbackUrl("backend"),
			initialize: true,
		});

		await vi.waitFor(() => {
			expect(backendSelection.get()).toMatchObject({
				status: ResourceStatus.Resolved,
				value: { kind: TokenSetCallbackClientSelectionKind.Selected },
			});
		});

		const modeMismatch = selectTokenSetBackendCallbackClientFromRegistry({
			registry: frontendRegistry,
			callbackUrl: backendCallbackUrl("frontend"),
			initialize: true,
		});
		await vi.waitFor(() => {
			expect(modeMismatch.get()).toMatchObject({
				status: ResourceStatus.LoadingError,
				error: { code: TokenSetRegistryCallbackErrorCode.ClientModeMismatch },
			});
		});
	});

	it("lets a custom query derive client selection from a normalized callback URL", async () => {
		const client = createFrontendClient();
		const registry = createRegistry("frontend", client, "/ignored");
		const clientQuery = vi.fn(({ callbackUrl }) => {
			expect(callbackUrl).toBeInstanceOf(UriReferenceString);
			expect(callbackUrl.pathname).toBe("/custom-callback");
			return { clientKey: "frontend" };
		});
		const selection = selectTokenSetFrontendCallbackClientFromRegistry({
			registry,
			callbackUrl: new URL("https://app.example.com/custom-callback?code=ok"),
			clientQuery,
			clientGuard: frontendClientGuard,
			initialize: true,
		});

		await vi.waitFor(() => {
			expect(selection.get()).toMatchObject({
				status: ResourceStatus.Resolved,
				value: { kind: TokenSetCallbackClientSelectionKind.Selected, client },
			});
		});
		expect(clientQuery).toHaveBeenCalledOnce();
	});

	it("treats a null custom query as not applicable", () => {
		const registry = createRegistry(
			"frontend",
			createFrontendClient(),
			"/callback",
		);

		expect(
			selectTokenSetFrontendCallbackClientFromRegistry({
				registry,
				callbackUrl: "/callback?code=ok",
				clientQuery: () => null,
				clientGuard: frontendClientGuard,
			}).get(),
		).toEqual({
			status: ResourceStatus.Resolved,
			value: { kind: TokenSetCallbackClientSelectionKind.NotApplicable },
		});
	});

	it("selects a backend client from the compat-fragment routing key", async () => {
		const client = createBackendClient();
		const registry = createRegistry("backend", client);

		const selection = selectTokenSetBackendCallbackClientFromRegistry({
			registry,
			callbackUrl: backendCallbackUrl("backend"),
			clientGuard: backendClientGuard,
			initialize: true,
		});

		await vi.waitFor(() => {
			expect(selection.get()).toEqual({
				status: ResourceStatus.Resolved,
				value: {
					kind: TokenSetCallbackClientSelectionKind.Selected,
					client,
				},
			});
		});
	});

	it("returns not applicable when a frontend callback path does not match", () => {
		const registry = createRegistry(
			"frontend",
			createFrontendClient(),
			"/auth/token-set/callback",
		);

		expect(
			selectTokenSetFrontendCallbackClientFromRegistry({
				registry,
				callbackUrl: "https://app.example.com/not-a-callback",
				clientGuard: frontendClientGuard,
			}).get(),
		).toEqual({
			status: ResourceStatus.Resolved,
			value: { kind: TokenSetCallbackClientSelectionKind.NotApplicable },
		});
	});

	it("does not resolve a replacement record with the same client key", async () => {
		const registry = createRegistry(
			"frontend",
			createFrontendClient(),
			"/auth/token-set/callback",
		);
		const selection = selectTokenSetFrontendCallbackClientFromRegistry({
			registry,
			callbackUrl: "https://app.example.com/auth/token-set/callback?code=ok",
			clientGuard: frontendClientGuard,
		});
		registry.unregister("frontend");
		registerClient(
			registry,
			"frontend",
			createFrontendClient(),
			"/auth/token-set/callback",
		);

		expect(selection.get()).toMatchObject({
			status: ResourceStatus.LoadingError,
			error: { code: TokenSetRegistryCallbackErrorCode.ClientNotFound },
		});
	});

	it("reports backend callback routing and mode failures", async () => {
		const registry = createRegistry("frontend", createFrontendClient());

		expect(
			selectTokenSetBackendCallbackClientFromRegistry({
				registry,
				callbackUrl: backendCallbackUrl(),
				clientGuard: backendClientGuard,
			}).get(),
		).toMatchObject({
			status: ResourceStatus.LoadingError,
			error: {
				code: TokenSetRegistryCallbackErrorCode.RoutingKeyMissing,
			},
		});

		const selection = selectTokenSetBackendCallbackClientFromRegistry({
			registry,
			callbackUrl: backendCallbackUrl("frontend"),
			clientGuard: (_client): _client is TokenSetBackendCallbackClient => false,
			initialize: true,
		});
		await vi.waitFor(() => {
			expect(selection.get()).toMatchObject({
				status: ResourceStatus.LoadingError,
				error: { code: TokenSetRegistryCallbackErrorCode.ClientModeMismatch },
			});
		});
	});

	it("lets backend callers map an initial missing client", () => {
		const registry = createRegistry("frontend", createFrontendClient());
		const mapClientNotFound = vi.fn(
			() =>
				({
					status: ResourceStatus.Resolved,
					value: { kind: TokenSetCallbackClientSelectionKind.NotApplicable },
				}) as const,
		);

		expect(
			selectTokenSetBackendCallbackClientFromRegistry({
				registry,
				callbackUrl: backendCallbackUrl("missing"),
				mapClientNotFound,
				clientGuard: backendClientGuard,
			}).get(),
		).toEqual({
			status: ResourceStatus.Resolved,
			value: { kind: TokenSetCallbackClientSelectionKind.NotApplicable },
		});
		expect(mapClientNotFound).toHaveBeenCalledWith({
			status: ResourceStatus.LoadingError,
			error: expect.objectContaining({
				code: TokenSetRegistryCallbackErrorCode.ClientNotFound,
			}),
		});
	});

	it("lets a client-not-found mapper throw from the selection signal", () => {
		const registry = createRegistry("frontend", createFrontendClient());
		const mapperError = new Error("mapped client not found");
		const selection = selectTokenSetBackendCallbackClientFromRegistry({
			registry,
			callbackUrl: backendCallbackUrl("missing"),
			mapClientNotFound: () => {
				throw mapperError;
			},
			clientGuard: backendClientGuard,
		});

		expect(() => selection.get()).toThrow(mapperError);
	});

	it("rejects ambiguous frontend callback metadata", () => {
		const registry = createRegistry("frontend-a", createFrontendClient(), [
			"/callback",
			"/alternate-callback",
		]);
		registerClient(registry, "frontend-b", createFrontendClient(), [
			"/callback",
			"/second-alternate-callback",
		]);

		expect(
			selectTokenSetFrontendCallbackClientFromRegistry({
				registry,
				callbackUrl: "https://app.example.com/callback?code=ok",
				clientGuard: frontendClientGuard,
			}).get(),
		).toMatchObject({
			status: ResourceStatus.LoadingError,
			error: {
				code: TokenSetRegistryCallbackErrorCode.ClientSelectionAmbiguous,
			},
		});
	});
});
