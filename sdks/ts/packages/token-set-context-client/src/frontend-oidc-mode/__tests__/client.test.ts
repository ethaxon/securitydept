import { createInMemoryRecordStore, createRuntime } from "@securitydept/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const oauthMocks = vi.hoisted(() => ({
	authorizationCodeGrantRequest: vi.fn(),
	calculatePKCECodeChallenge: vi.fn(),
	generateRandomCodeVerifier: vi.fn(),
	generateRandomState: vi.fn(),
	nopkce: Symbol("nopkce"),
	processAuthorizationCodeResponse: vi.fn(),
	validateAuthResponse: vi.fn(),
}));

vi.mock("oauth4webapi", () => ({
	authorizationCodeGrantRequest: oauthMocks.authorizationCodeGrantRequest,
	calculatePKCECodeChallenge: oauthMocks.calculatePKCECodeChallenge,
	ClientNone: vi.fn(() => ({ type: "none" })),
	ClientSecretPost: vi.fn(() => ({ type: "client_secret_post" })),
	discoveryRequest: vi.fn(),
	generateRandomCodeVerifier: oauthMocks.generateRandomCodeVerifier,
	generateRandomState: oauthMocks.generateRandomState,
	nopkce: oauthMocks.nopkce,
	None: vi.fn(() => ({ type: "none" })),
	openPopupWindow: vi.fn(),
	processAuthorizationCodeResponse: oauthMocks.processAuthorizationCodeResponse,
	processDiscoveryResponse: vi.fn(),
	processRefreshTokenResponse: vi.fn(),
	processUserInfoResponse: vi.fn(),
	refreshTokenGrantRequest: vi.fn(),
	relayPopupCallback: vi.fn(),
	userInfoRequest: vi.fn(),
	validateAuthResponse: oauthMocks.validateAuthResponse,
}));

import { FrontendOidcModeClient } from "../client";

describe("FrontendOidcModeClient", () => {
	beforeEach(() => {
		oauthMocks.authorizationCodeGrantRequest.mockReset();
		oauthMocks.calculatePKCECodeChallenge.mockReset();
		oauthMocks.generateRandomCodeVerifier.mockReset();
		oauthMocks.generateRandomState.mockReset();
		oauthMocks.processAuthorizationCodeResponse.mockReset();
		oauthMocks.validateAuthResponse.mockReset();

		oauthMocks.generateRandomState
			.mockReturnValueOnce("state-value")
			.mockReturnValueOnce("nonce-value");
		oauthMocks.generateRandomCodeVerifier.mockReturnValue("pkce-verifier");
		oauthMocks.calculatePKCECodeChallenge.mockResolvedValue("pkce-challenge");
		oauthMocks.validateAuthResponse.mockReturnValue({ code: "auth-code" });
		oauthMocks.authorizationCodeGrantRequest.mockResolvedValue({ ok: true });
		oauthMocks.processAuthorizationCodeResponse.mockResolvedValue({
			access_token: "access-token",
		});
	});

	it("does not pass an empty codeVerifier when pkce is disabled", async () => {
		const runtime = createRuntime({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStore: createInMemoryRecordStore(),
		});

		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
				pkceEnabled: false,
			},
			runtime,
		);

		await client.authorizeUrl("/playground/token-set/frontend-mode");
		await client.handleCallback(
			"https://app.example.com/auth/callback?code=auth-code&state=state-value",
		);

		expect(oauthMocks.authorizationCodeGrantRequest).toHaveBeenCalledTimes(1);
		expect(oauthMocks.authorizationCodeGrantRequest.mock.calls[0]?.[5]).toBe(
			oauthMocks.nopkce,
		);
	});
});
