import {
	createFoundationEnvironment,
	ResourceStatus,
	SYMBOL_DISPOSE,
	UriReferenceString,
} from "@securitydept/client";
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

const testEnvironment = createFoundationEnvironment({});

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
	callbackUrl?: string | readonly string[],
) {
	const registry = createTokenSetClientRegistry<BaseOidcModeClient>({
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
	registry.register({
		clientFactory: () => client,
		meta: {
			clientKey,
			urlPatterns: [],
			callbackUrl,
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
	it("returns a frontend client selection snapshot signal", async () => {
		const client = createClient(FrontendOidcModeClient);
		const registry = createRegistry(
			"frontend",
			client,
			"/auth/token-set/callback",
		);

		const selection = selectTokenSetFrontendCallbackClientFromRegistry({
			registry,
			callbackUrl: "https://app.example.com/auth/token-set/callback?code=ok",
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

	it("lets a custom query derive client selection from a normalized callback URL", async () => {
		const client = createClient(FrontendOidcModeClient);
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
			createClient(FrontendOidcModeClient),
			"/callback",
		);

		expect(
			selectTokenSetFrontendCallbackClientFromRegistry({
				registry,
				callbackUrl: "/callback?code=ok",
				clientQuery: () => null,
			}).get(),
		).toEqual({
			status: ResourceStatus.Resolved,
			value: { kind: TokenSetCallbackClientSelectionKind.NotApplicable },
		});
	});

	it("selects a backend client from the compat-fragment routing key", async () => {
		const client = createClient(BackendOidcModeClient);
		const registry = createRegistry("backend", client);

		const selection = selectTokenSetBackendCallbackClientFromRegistry({
			registry,
			callbackUrl: backendCallbackUrl("backend"),
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
			createClient(FrontendOidcModeClient),
			"/auth/token-set/callback",
		);

		expect(
			selectTokenSetFrontendCallbackClientFromRegistry({
				registry,
				callbackUrl: "https://app.example.com/not-a-callback",
			}).get(),
		).toEqual({
			status: ResourceStatus.Resolved,
			value: { kind: TokenSetCallbackClientSelectionKind.NotApplicable },
		});
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
		registry.unregister("frontend");
		registerClient(
			registry,
			"frontend",
			createClient(FrontendOidcModeClient),
			"/auth/token-set/callback",
		);

		expect(selection.get()).toMatchObject({
			status: ResourceStatus.LoadingError,
			error: { code: TokenSetRegistryCallbackErrorCode.ClientNotFound },
		});
	});

	it("reports backend callback routing and mode failures", async () => {
		const registry = createRegistry(
			"frontend",
			createClient(FrontendOidcModeClient),
		);

		expect(
			selectTokenSetBackendCallbackClientFromRegistry({
				registry,
				callbackUrl: backendCallbackUrl(),
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
		const registry = createRegistry(
			"frontend",
			createClient(FrontendOidcModeClient),
		);
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
		const registry = createRegistry(
			"frontend",
			createClient(FrontendOidcModeClient),
		);
		const mapperError = new Error("mapped client not found");
		const selection = selectTokenSetBackendCallbackClientFromRegistry({
			registry,
			callbackUrl: backendCallbackUrl("missing"),
			mapClientNotFound: () => {
				throw mapperError;
			},
		});

		expect(() => selection.get()).toThrow(mapperError);
	});

	it("rejects ambiguous frontend callback metadata", () => {
		const registry = createRegistry(
			"frontend-a",
			createClient(FrontendOidcModeClient),
			["/callback", "/alternate-callback"],
		);
		registerClient(
			registry,
			"frontend-b",
			createClient(FrontendOidcModeClient),
			["/callback", "/second-alternate-callback"],
		);

		expect(
			selectTokenSetFrontendCallbackClientFromRegistry({
				registry,
				callbackUrl: "https://app.example.com/callback?code=ok",
			}).get(),
		).toMatchObject({
			status: ResourceStatus.LoadingError,
			error: {
				code: TokenSetRegistryCallbackErrorCode.ClientSelectionAmbiguous,
			},
		});
	});
});
