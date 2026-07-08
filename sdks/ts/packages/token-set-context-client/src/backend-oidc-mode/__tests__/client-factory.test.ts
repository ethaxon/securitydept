import {
	createCancellationTokenSource,
	createFoundationEnvironment,
	UriReferenceString,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import { type TokenSetClientMeta } from "../../registry/contracts/types";
import { createBackendOidcModeClientFactory } from "../client/client-factory";
import { BackendOidcModeCompatFragmentKind } from "../contracts/callback";

const meta: TokenSetClientMeta = {
	clientKey: "backend-client",
	urlPatterns: [],
	requirementKind: "backend_oidc",
	initialization: "lazy",
};

describe("createBackendOidcModeClientFactory", () => {
	it("constructs and starts a client with the registry client key as routing key", async () => {
		const environment = createFoundationEnvironment({});
		const cancellation = createCancellationTokenSource();
		const factory = createBackendOidcModeClientFactory({
			config: { baseUrl: "https://api.example.com" },
		});

		using client = await factory({
			cancellationToken: cancellation.token,
			environment,
			meta,
		});

		expect(
			new URL(client.authorizeUrl()).searchParams.get("callback_routing_key"),
		).toBe(meta.clientKey);
	});

	it("allows callback routing and input resolution overrides", async () => {
		const environment = createFoundationEnvironment({});
		const cancellation = createCancellationTokenSource();
		const callbackInputResolver = vi.fn(async () => null);
		const factory = createBackendOidcModeClientFactory({
			config: { baseUrl: "https://api.example.com" },
			callbackRoutingKey: null,
			callbackInputResolver,
		});

		using client = await factory({
			cancellationToken: cancellation.token,
			environment,
			meta,
		});

		expect(callbackInputResolver).toHaveBeenCalledOnce();
		expect(
			new URL(client.authorizeUrl()).searchParams.has("callback_routing_key"),
		).toBe(false);
	});

	it("applies an async predicate before consuming the routed callback", async () => {
		const callbackUrl = UriReferenceString.parse(
			`https://app.example.com/callback#securitydept=v1&kind=${BackendOidcModeCompatFragmentKind.Callback}&callback_routing_key=${meta.clientKey}&access_token=at`,
		);
		const navigate = vi.fn();
		const environment = createFoundationEnvironment({
			router: { currentUrl: () => callbackUrl, navigate },
		});
		const cancellation = createCancellationTokenSource();
		const callbackInputPredicate = vi.fn(async ({ callbackInput }) => {
			expect(callbackInput).toEqual({ access_token: "at" });
			return false;
		});
		const factory = createBackendOidcModeClientFactory({
			config: { baseUrl: "https://api.example.com" },
			callbackInputPredicate,
		});

		using _client = await factory({
			cancellationToken: cancellation.token,
			environment,
			meta,
		});

		expect(callbackInputPredicate).toHaveBeenCalledOnce();
		expect(navigate).not.toHaveBeenCalled();
		expect(environment.router?.currentUrl()?.hash).toContain("access_token=at");
	});
});
