import {
	createCancellationTokenSource,
	createFoundationEnvironment,
	UriReferenceString,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import { type TokenSetClientMeta } from "../../registry/contracts/types";
import { createFrontendOidcModeClientFactory } from "../client/client-factory";
import { type FrontendOidcModeClientConfig } from "../client/types";

const config: FrontendOidcModeClientConfig = {
	issuer: "https://auth.example.com",
	clientId: "frontend-client",
	redirectUri: "https://app.example.com/config-callback",
	authorizationEndpoint: "https://auth.example.com/authorize",
	tokenEndpoint: "https://auth.example.com/token",
};

const meta: TokenSetClientMeta = {
	clientKey: "frontend-client",
	urlPatterns: [],
	callbackUrl: ["/metadata-callback", "/alternate-callback"],
	requirementKind: "frontend_oidc",
	initialization: "lazy",
};

describe("createFrontendOidcModeClientFactory", () => {
	it("uses registry callback URL metadata when no resolver override is provided", async () => {
		let currentUrl = UriReferenceString.parse(
			"https://app.example.com/metadata-callback?error=access_denied",
		);
		const environment = createFoundationEnvironment({
			router: {
				currentUrl: () => currentUrl,
				navigate: vi.fn(async (request) => {
					currentUrl = request.url;
				}),
			},
		});
		const cancellation = createCancellationTokenSource();
		const factory = createFrontendOidcModeClientFactory({ config });

		await expect(
			factory({
				cancellationToken: cancellation.token,
				environment,
				meta,
			}),
		).rejects.toBeDefined();
		expect(currentUrl.pathname).toBe("/metadata-callback");
		expect(currentUrl.searchParams.has("error")).toBe(false);
	});

	it("allows explicit null to disable metadata-based callback resolution", async () => {
		const environment = createFoundationEnvironment({
			router: {
				currentUrl: () =>
					UriReferenceString.parse(
						"https://app.example.com/metadata-callback?error=access_denied",
					),
				navigate: vi.fn(),
			},
		});
		const cancellation = createCancellationTokenSource();
		const factory = createFrontendOidcModeClientFactory({
			config: (options) => {
				expect(options.environment).toBe(environment);
				expect(options.meta).toBe(meta);
				return config;
			},
			callbackInputResolver: null,
		});

		using client = await factory({
			cancellationToken: cancellation.token,
			environment,
			meta,
		});

		expect(client.authResource.value.get()).toBeNull();
	});

	it("applies an async predicate before consuming metadata callback input", async () => {
		let currentUrl = UriReferenceString.parse(
			"https://app.example.com/metadata-callback?error=access_denied",
		);
		const navigate = vi.fn(async (request) => {
			currentUrl = request.url;
		});
		const environment = createFoundationEnvironment({
			router: { currentUrl: () => currentUrl, navigate },
		});
		const cancellation = createCancellationTokenSource();
		const callbackInputPredicate = vi.fn(async ({ callbackUrl }) => {
			expect(callbackUrl.pathname).toBe("/metadata-callback");
			return false;
		});
		const factory = createFrontendOidcModeClientFactory({
			config,
			callbackInputPredicate,
		});

		using _client = await factory({
			cancellationToken: cancellation.token,
			environment,
			meta,
		});

		expect(callbackInputPredicate).toHaveBeenCalledOnce();
		expect(navigate).not.toHaveBeenCalled();
		expect(currentUrl.searchParams.get("error")).toBe("access_denied");
	});
});
