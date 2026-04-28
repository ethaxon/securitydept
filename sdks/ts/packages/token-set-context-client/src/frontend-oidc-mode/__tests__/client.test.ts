import {
	ClientErrorKind,
	createInMemoryRecordStore,
	createRuntime,
	OperationTraceEventType,
} from "@securitydept/client";
import { InMemoryTraceCollector } from "@securitydept/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type TokenSetAuthEvent,
	TokenSetAuthEventType,
	TokenSetAuthFlowSource,
} from "../../orchestration";
import { FrontendOidcModeCallbackErrorCode } from "../callback-error-codes";
import { FrontendOidcModeTraceEventType } from "../trace-events";

const webMocks = vi.hoisted(() => ({
	openPopupWindow: vi.fn(),
	relayPopupCallback: vi.fn(),
	waitForPopupRelay: vi.fn(),
}));

vi.mock("@securitydept/client/web", async () => {
	const actual = await vi.importActual<object>("@securitydept/client/web");
	return {
		...actual,
		openPopupWindow: webMocks.openPopupWindow,
		relayPopupCallback: webMocks.relayPopupCallback,
		waitForPopupRelay: webMocks.waitForPopupRelay,
	};
});

const oauthMocks = vi.hoisted(() => ({
	allowInsecureRequests: Symbol("allowInsecureRequests"),
	authorizationCodeGrantRequest: vi.fn(),
	calculatePKCECodeChallenge: vi.fn(),
	discoveryRequest: vi.fn(),
	generateRandomCodeVerifier: vi.fn(),
	generateRandomState: vi.fn(),
	nopkce: Symbol("nopkce"),
	processAuthorizationCodeResponse: vi.fn(),
	processRefreshTokenResponse: vi.fn(),
	processDiscoveryResponse: vi.fn(),
	processUserInfoResponse: vi.fn(),
	refreshTokenGrantRequest: vi.fn(),
	userInfoRequest: vi.fn(),
	validateAuthResponse: vi.fn(),
}));

vi.mock("oauth4webapi", () => ({
	allowInsecureRequests: oauthMocks.allowInsecureRequests,
	authorizationCodeGrantRequest: oauthMocks.authorizationCodeGrantRequest,
	calculatePKCECodeChallenge: oauthMocks.calculatePKCECodeChallenge,
	ClientNone: vi.fn(() => ({ type: "none" })),
	ClientSecretPost: vi.fn(() => ({ type: "client_secret_post" })),
	discoveryRequest: oauthMocks.discoveryRequest,
	generateRandomCodeVerifier: oauthMocks.generateRandomCodeVerifier,
	generateRandomState: oauthMocks.generateRandomState,
	nopkce: oauthMocks.nopkce,
	None: vi.fn(() => ({ type: "none" })),
	openPopupWindow: vi.fn(),
	processAuthorizationCodeResponse: oauthMocks.processAuthorizationCodeResponse,
	processDiscoveryResponse: oauthMocks.processDiscoveryResponse,
	processRefreshTokenResponse: oauthMocks.processRefreshTokenResponse,
	processUserInfoResponse: oauthMocks.processUserInfoResponse,
	refreshTokenGrantRequest: oauthMocks.refreshTokenGrantRequest,
	relayPopupCallback: vi.fn(),
	userInfoRequest: oauthMocks.userInfoRequest,
	validateAuthResponse: oauthMocks.validateAuthResponse,
}));

import { FrontendOidcModeClient } from "../client";

describe("FrontendOidcModeClient", () => {
	beforeEach(() => {
		oauthMocks.authorizationCodeGrantRequest.mockReset();
		oauthMocks.calculatePKCECodeChallenge.mockReset();
		oauthMocks.discoveryRequest.mockReset();
		oauthMocks.generateRandomCodeVerifier.mockReset();
		oauthMocks.generateRandomState.mockReset();
		oauthMocks.processAuthorizationCodeResponse.mockReset();
		oauthMocks.processRefreshTokenResponse.mockReset();
		oauthMocks.processDiscoveryResponse.mockReset();
		oauthMocks.processUserInfoResponse.mockReset();
		oauthMocks.refreshTokenGrantRequest.mockReset();
		oauthMocks.userInfoRequest.mockReset();
		oauthMocks.validateAuthResponse.mockReset();
		webMocks.openPopupWindow.mockReset();
		webMocks.relayPopupCallback.mockReset();
		webMocks.waitForPopupRelay.mockReset();

		oauthMocks.generateRandomState
			.mockReturnValueOnce("state-value")
			.mockReturnValueOnce("nonce-value");
		oauthMocks.generateRandomCodeVerifier.mockReturnValue("pkce-verifier");
		oauthMocks.calculatePKCECodeChallenge.mockResolvedValue("pkce-challenge");
		oauthMocks.validateAuthResponse.mockReturnValue({ code: "auth-code" });
		oauthMocks.authorizationCodeGrantRequest.mockResolvedValue({ ok: true });
		oauthMocks.discoveryRequest.mockResolvedValue({ ok: true });
		oauthMocks.processAuthorizationCodeResponse.mockResolvedValue({
			access_token: "access-token",
		});
		oauthMocks.userInfoRequest.mockResolvedValue({ ok: true });
		oauthMocks.processUserInfoResponse.mockResolvedValue({
			sub: "oidc-user-1",
			name: "Alice",
			picture: "https://example.com/alice.png",
		});
		oauthMocks.refreshTokenGrantRequest.mockResolvedValue({ ok: true });
		oauthMocks.processRefreshTokenResponse.mockResolvedValue({
			access_token: "refresh-access-token",
			refresh_token: "refresh-token-next",
			expires_in: 300,
		});
		webMocks.openPopupWindow.mockReturnValue({
			close: vi.fn(),
			window: { closed: false },
		});
		webMocks.waitForPopupRelay.mockResolvedValue(
			"https://app.example.com/auth/popup-callback?code=auth-code&state=state-value",
		);
		oauthMocks.processDiscoveryResponse.mockReturnValue({
			authorization_endpoint: "https://auth.example.com/authorize",
			issuer: "https://auth.example.com",
			token_endpoint: "https://auth.example.com/token",
		});
	});

	it("normalizes raw userInfo into the shared authenticated principal contract", async () => {
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
			},
			runtime,
		);

		await client.discover();
		oauthMocks.processUserInfoResponse.mockResolvedValueOnce({
			sub: "oidc-user-2",
			picture: "https://example.com/alice.png",
			locale: "en-US",
		});

		await expect(client.fetchUserInfoRaw("access-token")).resolves.toEqual({
			subject: "oidc-user-2",
			displayName: "oidc-user-2",
			picture: "https://example.com/alice.png",
			email: undefined,
			emailVerified: undefined,
			claims: {
				sub: "oidc-user-2",
				picture: "https://example.com/alice.png",
				locale: "en-US",
			},
		});
	});

	it("rejects raw userInfo payloads without a stable subject", async () => {
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
			},
			runtime,
		);

		await client.discover();
		oauthMocks.processUserInfoResponse.mockResolvedValueOnce({
			name: "Alice",
		});

		await expect(client.fetchUserInfoRaw("access-token")).rejects.toMatchObject(
			{
				name: "ClientError",
				kind: ClientErrorKind.Protocol,
				code: "frontend_oidc.invalid_user_info_payload",
			},
		);
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

	it("keeps pending states isolated by OAuth state", async () => {
		oauthMocks.generateRandomState
			.mockReset()
			.mockReturnValueOnce("state-a")
			.mockReturnValueOnce("nonce-a")
			.mockReturnValueOnce("state-b")
			.mockReturnValueOnce("nonce-b");

		const sessionStore = createInMemoryRecordStore();
		const runtime = createRuntime({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStore,
		});

		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			runtime,
		);

		await client.authorizeUrl("/after-a");
		await client.authorizeUrl("/after-b");

		await expect(
			sessionStore.get("securitydept.frontend_oidc.pending:state-a"),
		).resolves.not.toBeNull();
		await expect(
			sessionStore.get("securitydept.frontend_oidc.pending:state-b"),
		).resolves.not.toBeNull();

		await expect(
			client.handleCallback(
				"https://app.example.com/auth/callback?code=auth-code&state=state-a",
			),
		).resolves.toMatchObject({ postAuthRedirectUri: "/after-a" });

		await expect(
			sessionStore.get("securitydept.frontend_oidc.pending:state-a"),
		).resolves.toBeNull();
		await expect(
			sessionStore.get("securitydept.frontend_oidc.pending:state-b"),
		).resolves.not.toBeNull();

		await expect(
			client.handleCallback(
				"https://app.example.com/auth/callback?code=auth-code&state=state-b",
			),
		).resolves.toMatchObject({ postAuthRedirectUri: "/after-b" });
	});

	it("rejects duplicate callbacks after a state has already been consumed", async () => {
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
			},
			runtime,
		);

		await client.authorizeUrl("/after-login");
		await client.handleCallback(
			"https://app.example.com/auth/callback?code=auth-code&state=state-value",
		);

		await expect(
			client.handleCallback(
				"https://app.example.com/auth/callback?code=auth-code&state=state-value",
			),
		).rejects.toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.DuplicateState,
			recovery: "restart_flow",
		});
	});

	it("rejects callbacks whose state was never started in this browser", async () => {
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
			},
			runtime,
		);

		await expect(
			client.handleCallback(
				"https://app.example.com/auth/callback?code=auth-code&state=unknown-state",
			),
		).rejects.toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.UnknownState,
			recovery: "restart_flow",
		});
	});

	it("rejects callbacks whose pending state has expired", async () => {
		const sessionStore = createInMemoryRecordStore();
		const runtime = createRuntime({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStore,
		});

		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			runtime,
		);

		await sessionStore.set(
			"securitydept.frontend_oidc.pending:state-stale",
			JSON.stringify({
				codeVerifier: "code-verifier",
				state: "state-stale",
				contextSource: "client",
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				nonce: "nonce-stale",
				postAuthRedirectUri: "/after-login",
				createdAt: Date.now() - 11 * 60 * 1000,
			}),
		);

		await expect(
			client.handleCallback(
				"https://app.example.com/auth/callback?code=auth-code&state=state-stale",
			),
		).rejects.toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.PendingStale,
			recovery: "restart_flow",
		});
	});

	it("rejects callbacks whose pending state belongs to another frontend client", async () => {
		const sessionStore = createInMemoryRecordStore();
		const runtime = createRuntime({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStore,
		});

		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			runtime,
		);

		await sessionStore.set(
			"securitydept.frontend_oidc.pending:state-mismatch",
			JSON.stringify({
				codeVerifier: "code-verifier",
				state: "state-mismatch",
				contextSource: "client",
				issuer: "https://auth.example.com",
				clientId: "other-client",
				redirectUri: "https://app.example.com/auth/callback",
				nonce: "nonce-mismatch",
				postAuthRedirectUri: "/after-login",
				createdAt: Date.now(),
			}),
		);

		await expect(
			client.handleCallback(
				"https://app.example.com/auth/callback?code=auth-code&state=state-mismatch",
			),
		).rejects.toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.PendingClientMismatch,
			recovery: "restart_flow",
		});
	});

	it("keeps callback state single-consume even when token exchange fails", async () => {
		oauthMocks.authorizationCodeGrantRequest.mockRejectedValueOnce(
			new Error("token exchange failed"),
		);

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
			},
			runtime,
		);

		await client.authorizeUrl("/after-login");

		await expect(
			client.handleCallback(
				"https://app.example.com/auth/callback?code=auth-code&state=state-value",
			),
		).rejects.toThrow(/token exchange failed/i);

		await expect(
			client.handleCallback(
				"https://app.example.com/auth/callback?code=auth-code&state=state-value",
			),
		).rejects.toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.DuplicateState,
			recovery: "restart_flow",
		});
	});

	it("allows loopback http issuers for local browser harnesses only", async () => {
		oauthMocks.processDiscoveryResponse.mockReturnValueOnce({
			authorization_endpoint: "http://localhost:4710/auth",
			issuer: "http://localhost:4710",
			token_endpoint: "http://localhost:4710/token",
		});

		const runtime = createRuntime({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStore: createInMemoryRecordStore(),
		});

		const client = new FrontendOidcModeClient(
			{
				issuer: "http://localhost:4710",
				clientId: "spa-client",
				redirectUri: "http://localhost:4722/auth/callback",
			},
			runtime,
		);

		await client.authorizeUrl("/after-login");
		await client.handleCallback(
			"http://localhost:4722/auth/callback?code=auth-code&state=state-value",
		);

		expect(oauthMocks.discoveryRequest).toHaveBeenCalledWith(
			expect.any(URL),
			expect.objectContaining({
				[oauthMocks.allowInsecureRequests]: true,
			}),
		);
		expect(oauthMocks.authorizationCodeGrantRequest.mock.calls[0]?.[6]).toEqual(
			expect.objectContaining({
				[oauthMocks.allowInsecureRequests]: true,
			}),
		);
	});

	it("records popup relay trace events for the browser-owned popup path", async () => {
		const trace = new InMemoryTraceCollector();
		const runtime = createRuntime({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStore: createInMemoryRecordStore(),
			traceSink: trace,
		});

		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			runtime,
		);

		await client.popupLogin({
			popupCallbackUrl: "https://app.example.com/auth/popup-callback",
			postAuthRedirectUri: "/playground/token-set/frontend-mode",
		});

		expect(
			trace.ofType(FrontendOidcModeTraceEventType.PopupOpened),
		).toHaveLength(1);
		expect(
			trace.ofType(FrontendOidcModeTraceEventType.PopupRelaySucceeded),
		).toHaveLength(1);
		expect(
			trace.ofType(FrontendOidcModeTraceEventType.CallbackSucceeded),
		).toHaveLength(1);
	});

	it("records callback failure details as structured trace attributes", async () => {
		const trace = new InMemoryTraceCollector();
		const runtime = createRuntime({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStore: createInMemoryRecordStore(),
			traceSink: trace,
		});

		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			runtime,
		);

		await expect(
			client.handleCallback(
				"https://app.example.com/auth/callback?code=auth-code&state=missing-state",
			),
		).rejects.toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.UnknownState,
		});

		expect(trace.ofType(FrontendOidcModeTraceEventType.CallbackFailed)).toEqual(
			[
				expect.objectContaining({
					attributes: expect.objectContaining({
						errorCode: FrontendOidcModeCallbackErrorCode.UnknownState,
						recovery: "restart_flow",
					}),
				}),
			],
		);
	});

	it("correlates callback lifecycle events with frontend callback traces", async () => {
		const trace = new InMemoryTraceCollector();
		const runtime = createRuntime({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStore: createInMemoryRecordStore(),
			traceSink: trace,
		});

		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			runtime,
		);

		await client.authorizeUrl("/after-login");
		await client.handleCallback(
			"https://app.example.com/auth/callback?code=auth-code&state=state-value",
		);

		const callbackStarted = trace.ofType(
			FrontendOidcModeTraceEventType.CallbackStarted,
		)[0];
		const callbackSucceeded = trace.ofType(
			FrontendOidcModeTraceEventType.CallbackSucceeded,
		)[0];
		const operationId = callbackStarted?.operationId;

		expect(operationId).toBeTruthy();
		expect(callbackSucceeded?.operationId).toBe(operationId);
		expect(
			trace.assertOperationLifecycle(operationId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					attributes: expect.objectContaining({
						operationName: "frontend_oidc.callback",
					}),
				}),
			]),
		);
	});

	it("correlates refresh lifecycle events with frontend refresh traces", async () => {
		const trace = new InMemoryTraceCollector();
		const runtime = createRuntime({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStore: createInMemoryRecordStore(),
			traceSink: trace,
		});

		const client = new FrontendOidcModeClient(
			{
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			runtime,
		);

		client.restoreState({
			tokens: {
				accessToken: "seed-at",
				idToken: "seed-idt",
				refreshMaterial: "seed-rt",
				accessTokenExpiresAt: "2027-01-01T00:05:00.000Z",
			},
			metadata: {},
		});

		await client.refresh();

		const refreshStarted = trace.ofType(
			FrontendOidcModeTraceEventType.RefreshStarted,
		)[0];
		const refreshSucceeded = trace.ofType(
			FrontendOidcModeTraceEventType.RefreshSucceeded,
		)[0];
		const operationId = refreshStarted?.operationId;

		expect(operationId).toBeTruthy();
		expect(refreshSucceeded?.operationId).toBe(operationId);
		expect(
			trace.assertOperationLifecycle(operationId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					attributes: expect.objectContaining({
						operationName: "frontend_oidc.refresh",
					}),
				}),
			]),
		);
	});

	it("attributes auth.authenticated to the refresh caller instead of callback", async () => {
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
			},
			runtime,
		);
		const events: TokenSetAuthEvent[] = [];
		client.authEvents.subscribe({ next: (event) => events.push(event) });

		client.restoreState({
			tokens: {
				accessToken: "seed-at",
				idToken: "seed-idt",
				refreshMaterial: "seed-rt",
				accessTokenExpiresAt: "2020-01-01T00:05:00.000Z",
			},
			metadata: {},
		});

		await client.ensureAuthForResource({
			source: TokenSetAuthFlowSource.RouteGuard,
			forceRefreshWhenDue: true,
		});

		const authenticatedEvents = events.filter(
			(event) => event.type === TokenSetAuthEventType.AuthAuthenticated,
		);
		const refreshAuthenticatedEvent =
			authenticatedEvents[authenticatedEvents.length - 1];

		expect(refreshAuthenticatedEvent?.payload).toEqual(
			expect.objectContaining({
				source: TokenSetAuthFlowSource.RouteGuard,
				hasRefreshMaterial: true,
			}),
		);
		expect(refreshAuthenticatedEvent?.payload.source).not.toBe(
			TokenSetAuthFlowSource.Callback,
		);
	});

	it("preserves existing refresh material when refresh responses omit refresh_token", async () => {
		oauthMocks.processRefreshTokenResponse.mockResolvedValue({
			access_token: "refresh-access-token",
			expires_in: 300,
		});

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
			},
			runtime,
		);

		client.restoreState({
			tokens: {
				accessToken: "seed-at",
				idToken: "seed-idt",
				refreshMaterial: "seed-rt",
				accessTokenExpiresAt: "2026-01-01T00:05:00.000Z",
			},
			metadata: {},
		});

		const refreshed = await client.refresh();

		expect(refreshed?.tokens.refreshMaterial).toBe("seed-rt");
		expect(client.state.get()?.tokens.refreshMaterial).toBe("seed-rt");
	});
});
