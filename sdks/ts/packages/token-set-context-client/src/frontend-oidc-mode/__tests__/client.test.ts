import {
	ClientErrorKind,
	createEventSubject,
	createInMemoryRecordStore,
	createRootSpan,
	createSignal,
	createTracing,
	type JsonRpcMessage,
	type JsonRpcNotificationEvent,
	type JsonRpcRequestEvent,
	OperationTraceEventType,
	type ReadableSignalTrait,
	type ResourceSnapshot,
	type RouterNavigationRequest,
	type RouterTrait,
	type StorageTrait,
	SYMBOL_DISPOSE,
	UriReferenceString,
} from "@securitydept/client";
import {
	createEnvironmentForTest as createFoundationEnvironment,
	createTimeForTest,
} from "@securitydept/client/test";
import { InMemoryTraceCollector } from "@securitydept/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type TokenSetAuthEvent,
	TokenSetAuthEventType,
} from "../../orchestration";
import { FrontendOidcModeOperationEventName } from "../client/trace-events";
import { FrontendOidcModeCallbackErrorCode } from "../errors/callback-error-codes";

const popupMocks = vi.hoisted(() => ({
	open: vi.fn(),
}));

const popupRelayMocks = vi.hoisted(() => ({
	relayTokenSetPopupCallback: vi.fn(),
	waitForTokenSetPopupRelay: vi.fn(),
}));

vi.mock("../../orchestration/client/popup/relay", async () => {
	const actual = await vi.importActual<object>(
		"../../orchestration/client/popup/relay",
	);
	return {
		...actual,
		relayTokenSetPopupCallback: popupRelayMocks.relayTokenSetPopupCallback,
		waitForTokenSetPopupRelay: popupRelayMocks.waitForTokenSetPopupRelay,
	};
});

function createMockPopupTrait() {
	const onNotification = createEventSubject<JsonRpcNotificationEvent>();
	const onRequest = createEventSubject<JsonRpcRequestEvent>();
	const outgoing = createEventSubject<JsonRpcMessage>();
	const incoming = createEventSubject<unknown>();

	return {
		open: popupMocks.open,
		attach: vi.fn(() => ({
			kind: "success" as const,
			handle: {
				onNotification,
				onRequest,
				failure: createSignal(null),
				isActive: createSignal(false),
				notify: vi.fn(async () => undefined),
				close: vi.fn(),
				messaging: {
					outgoing,
					incoming,
				},
				dispose: vi.fn(),
				[SYMBOL_DISPOSE]: vi.fn(),
			},
		})),
	};
}

function createFailingStorage() {
	const fail = async () => {
		throw new Error("storage unavailable");
	};
	return {
		get: vi.fn(fail),
		set: vi.fn(fail),
		take: vi.fn(fail),
		remove: vi.fn(fail),
	};
}

function expectSnapshotValue<T>(
	signal: ReadableSignalTrait<ResourceSnapshot<T>>,
): T {
	const snapshot = signal.get();
	if (
		snapshot.status !== "reloading" &&
		snapshot.status !== "resolved" &&
		snapshot.status !== "error"
	) {
		throw new Error("Expected resource snapshot value.");
	}
	return snapshot.value;
}

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

vi.mock("oauth4webapi", async (importOriginal) => {
	const actual = await importOriginal<typeof import("oauth4webapi")>();
	return {
		...actual,
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
		processAuthorizationCodeResponse:
			oauthMocks.processAuthorizationCodeResponse,
		processDiscoveryResponse: oauthMocks.processDiscoveryResponse,
		processRefreshTokenResponse: oauthMocks.processRefreshTokenResponse,
		processUserInfoResponse: oauthMocks.processUserInfoResponse,
		refreshTokenGrantRequest: oauthMocks.refreshTokenGrantRequest,
		userInfoRequest: oauthMocks.userInfoRequest,
		validateAuthResponse: oauthMocks.validateAuthResponse,
	};
});

import { createDefaultFrontendOidcModeCallbackInputResolver } from "../client/callback-input-resolver";
import { FrontendOidcModeClient } from "../client/client";
import { FrontendOidcModeErrorCode } from "../client/error-codes";
import {
	type FrontendOidcModeClientOptions,
	type FrontendOidcModeFlowStores,
} from "../client/types";

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
		popupMocks.open.mockReset();
		popupRelayMocks.relayTokenSetPopupCallback.mockReset();
		popupRelayMocks.waitForTokenSetPopupRelay.mockReset();

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
		popupMocks.open.mockReturnValue({
			close: vi.fn(),
		});
		popupRelayMocks.waitForTokenSetPopupRelay.mockResolvedValue(
			"https://app.example.com/auth/popup-callback?code=auth-code&state=state-value",
		);
		oauthMocks.processDiscoveryResponse.mockReturnValue({
			authorization_endpoint: "https://auth.example.com/authorize",
			issuer: "https://auth.example.com",
			token_endpoint: "https://auth.example.com/token",
		});
	});

	it("allows subclasses to override flow-store creation", () => {
		const realmStorage = createInMemoryRecordStore();
		const sessionStorage = createInMemoryRecordStore();
		const createFlowStores = vi.fn();
		class CustomFrontendOidcModeClient extends FrontendOidcModeClient {
			static create(
				options: FrontendOidcModeClientOptions,
			): CustomFrontendOidcModeClient {
				return new CustomFrontendOidcModeClient(options);
			}

			protected override createFrontendOidcModeFlowStores(
				storage: StorageTrait,
			): FrontendOidcModeFlowStores {
				createFlowStores(storage);
				return super.createFrontendOidcModeFlowStores(storage);
			}
		}
		const environment = createFoundationEnvironment({
			realmStorage,
			sessionStorage,
		});

		const client = CustomFrontendOidcModeClient.create({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
			},
			environment,
		});

		expect(createFlowStores.mock.calls).toEqual([
			[realmStorage],
			[sessionStorage],
		]);
		client.dispose();
	});

	it("restores a matching callback before persistence during start", async () => {
		let currentUrl = UriReferenceString.parse("https://app.example.com/login");
		const navigate = vi.fn(async (request: RouterNavigationRequest) => {
			currentUrl = request.url;
		});
		const router: RouterTrait = {
			currentUrl: () => currentUrl,
			navigate,
		};
		const runtime = createFoundationEnvironment({
			router,
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStorage: createInMemoryRecordStore(),
		});
		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await client.authorizeUrl({ postAuthRedirectUri: "/after-login" });
		currentUrl = UriReferenceString.parse(
			"https://app.example.com/auth/callback?code=auth-code&state=state-value&tab=security",
		);

		await expect(client.start()).resolves.toMatchObject({
			tokens: { accessToken: "access-token" },
		});
		expect(client.callback.resource.value.get()).toMatchObject({
			kind: "handled",
			result: { postAuthRedirectUri: "/after-login" },
		});
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				url: UriReferenceString.parse(
					"https://app.example.com/auth/callback?tab=security",
				),
			}),
		);
	});

	it("restores a callback using an overridden redirect URI candidate", async () => {
		let currentUrl = UriReferenceString.parse("https://app.example.com/login");
		const router: RouterTrait = {
			currentUrl: () => currentUrl,
			navigate: async (request) => {
				currentUrl = request.url;
			},
		};
		const runtime = createFoundationEnvironment({
			router,
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStorage: createInMemoryRecordStore(),
		});
		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/default-callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
			callbackInputResolver: createDefaultFrontendOidcModeCallbackInputResolver(
				{
					redirectUriCandidates: [
						"/auth/default-callback",
						UriReferenceString.parse("/auth/override-callback"),
					],
				},
			),
		});

		await client.loginWithRedirect({
			redirectUri: "https://app.example.com/auth/override-callback",
			postAuthRedirectUri: "/after-login",
		});
		const state = new URL(currentUrl.toString()).searchParams.get("state");
		expect(state).toBeTruthy();
		currentUrl = UriReferenceString.parse(
			`https://app.example.com/auth/override-callback?code=auth-code&state=${state}`,
		);

		await expect(client.start()).resolves.toMatchObject({
			tokens: { accessToken: "access-token" },
		});
	});

	it("serializes metadata refresh and reschedules after completion", async () => {
		const time = createTimeForTest();
		const runtime = createFoundationEnvironment({
			time,
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
		});
		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				metadataRefreshInterval: "1s",
			},
			environment: runtime,
		});

		await client.discover();
		expect(time.pendingCount).toBe(1);

		let resolveRefresh!: (response: { ok: boolean }) => void;
		oauthMocks.discoveryRequest.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveRefresh = resolve;
				}),
		);
		time.advanceAndFlush(1_000);
		expect(oauthMocks.discoveryRequest).toHaveBeenCalledTimes(2);

		time.advanceAndFlush(5_000);
		expect(oauthMocks.discoveryRequest).toHaveBeenCalledTimes(2);

		resolveRefresh({ ok: true });
		await vi.waitFor(() => {
			expect(time.pendingCount).toBe(1);
		});

		oauthMocks.discoveryRequest.mockRejectedValueOnce(
			new Error("metadata refresh failed"),
		);
		time.advanceAndFlush(1_000);
		await vi.waitFor(() => {
			expect(oauthMocks.discoveryRequest).toHaveBeenCalledTimes(3);
			expect(time.pendingCount).toBe(1);
		});

		client.dispose();
		expect(time.pendingCount).toBe(0);
	});

	it("normalizes raw userInfo into the shared authenticated principal contract", async () => {
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage: createInMemoryRecordStore(),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

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
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage: createInMemoryRecordStore(),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await client.discover();
		oauthMocks.processUserInfoResponse.mockResolvedValueOnce({
			name: "Alice",
		});

		await expect(client.fetchUserInfoRaw("access-token")).rejects.toMatchObject(
			{
				name: "ClientError",
				kind: ClientErrorKind.Protocol,
				code: "identity.invalid_principal",
			},
		);
	});

	it("does not pass an empty codeVerifier when pkce is disabled", async () => {
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage: createInMemoryRecordStore(),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
				pkceEnabled: false,
			},
			environment: runtime,
		});

		await client.authorizeUrl({
			postAuthRedirectUri: "/playground/token-set/frontend-mode",
		});
		await client.handleCallback(
			new URLSearchParams({ code: "auth-code", state: "state-value" }),
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

		const sessionStorage = createInMemoryRecordStore();
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage,
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await client.authorizeUrl({ postAuthRedirectUri: "/after-a" });
		await client.authorizeUrl({ postAuthRedirectUri: "/after-b" });

		expect(
			sessionStorage.get("securitydept.frontend_oidc.pending:state-a"),
		).not.toBeNull();
		expect(
			sessionStorage.get("securitydept.frontend_oidc.pending:state-b"),
		).not.toBeNull();
		expect(
			runtime.realmStorage.get("securitydept.frontend_oidc.pending:state-a"),
		).toBeNull();

		await expect(
			client.handleCallback({ code: "auth-code", state: "state-a" }),
		).resolves.toMatchObject({ postAuthRedirectUri: "/after-a" });

		expect(
			sessionStorage.get("securitydept.frontend_oidc.pending:state-a"),
		).toBeNull();
		expect(
			sessionStorage.get("securitydept.frontend_oidc.pending:state-b"),
		).not.toBeNull();
		expect(
			runtime.realmStorage.get("securitydept.frontend_oidc.consumed:state-a"),
		).toBeNull();

		await expect(
			client.handleCallback({
				searchParams: new URLSearchParams({
					code: "auth-code",
					state: "state-b",
				}),
			}),
		).resolves.toMatchObject({ postAuthRedirectUri: "/after-b" });
	});

	it("rejects duplicate callbacks after a state has already been consumed", async () => {
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage: createInMemoryRecordStore(),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await client.authorizeUrl({ postAuthRedirectUri: "/after-login" });
		await client.handleCallback([
			["code", "auth-code"],
			["state", "state-value"],
		]);

		await expect(
			client.handleCallback("?code=auth-code&state=state-value"),
		).rejects.toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.DuplicateState,
			recovery: "restart_flow",
		});
	});

	it("rejects callbacks whose state was never started in this browser", async () => {
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage: createInMemoryRecordStore(),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await expect(
			client.handleCallback("?code=auth-code&state=unknown-state"),
		).rejects.toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.UnknownState,
			recovery: "restart_flow",
		});
	});

	it("rejects callbacks whose pending state has expired", async () => {
		const sessionStorage = createInMemoryRecordStore();
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage,
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await sessionStorage.set(
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
			client.handleCallback("?code=auth-code&state=state-stale"),
		).rejects.toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.PendingStale,
			recovery: "restart_flow",
		});
	});

	it("rejects callbacks whose pending state belongs to another frontend client", async () => {
		const sessionStorage = createInMemoryRecordStore();
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage,
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await sessionStorage.set(
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
			client.handleCallback("?code=auth-code&state=state-mismatch"),
		).rejects.toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.PendingClientMismatch,
			recovery: "restart_flow",
		});
	});

	it("keeps callback state single-consume even when token exchange fails", async () => {
		oauthMocks.authorizationCodeGrantRequest.mockRejectedValueOnce(
			new Error("token exchange failed"),
		);

		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage: createInMemoryRecordStore(),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await client.authorizeUrl({ postAuthRedirectUri: "/after-login" });

		await expect(
			client.handleCallback("?code=auth-code&state=state-value"),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Internal,
			code: "frontend_oidc.operation_failed",
			cause: expect.objectContaining({ message: "token exchange failed" }),
		});

		await expect(
			client.handleCallback("?code=auth-code&state=state-value"),
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

		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage: createInMemoryRecordStore(),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "http://localhost:4710",
				clientId: "spa-client",
				redirectUri: "http://localhost:4722/auth/callback",
			},
			environment: runtime,
		});

		await client.authorizeUrl({ postAuthRedirectUri: "/after-login" });
		await client.handleCallback("?code=auth-code&state=state-value");

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
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			tracing: createTracing({ subscribers: [trace] }),
			popup: createMockPopupTrait(),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await client.loginWithPopup({
			popupCallbackUrl: "https://app.example.com/auth/popup-callback",
		});
		expect(
			runtime.realmStorage.get(
				"securitydept.frontend_oidc.pending:state-value",
			),
		).toBeNull();
		expect(
			runtime.realmStorage.get(
				"securitydept.frontend_oidc.consumed:state-value",
			),
		).not.toBeNull();

		expect(
			trace
				.ofType(OperationTraceEventType.Event)
				.filter(
					(event) =>
						event.fields?.eventName ===
						FrontendOidcModeOperationEventName.PopupOpened,
				),
		).toHaveLength(1);
		expect(
			trace
				.ofType(OperationTraceEventType.Event)
				.filter(
					(event) =>
						event.fields?.eventName ===
						FrontendOidcModeOperationEventName.PopupRelaySucceeded,
				),
		).toHaveLength(1);
		expect(
			trace
				.ofType(OperationTraceEventType.Ended)
				.filter(
					(event) =>
						event.fields?.operationName === "frontend_oidc.callback" &&
						event.fields?.outcome === "succeeded",
				),
		).toHaveLength(1);
	});

	it("does not access session storage during popup login", async () => {
		const sessionStorage = createFailingStorage();
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStorage,
			popup: createMockPopupTrait(),
		});
		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await expect(
			client.loginWithPopup({
				popupCallbackUrl: "https://app.example.com/auth/popup-callback",
			}),
		).resolves.toMatchObject({
			snapshot: { tokens: { accessToken: "access-token" } },
		});
		expect(sessionStorage.get).not.toHaveBeenCalled();
		expect(sessionStorage.set).not.toHaveBeenCalled();
		expect(sessionStorage.take).not.toHaveBeenCalled();
		expect(sessionStorage.remove).not.toHaveBeenCalled();
	});

	it("does not fall back to session storage when realm storage fails", async () => {
		const fail = () => {
			throw new Error("storage unavailable");
		};
		const realmStorage = {
			get: vi.fn(fail),
			set: vi.fn(fail),
			take: vi.fn(fail),
			remove: vi.fn(fail),
		};
		const sessionStorage = createInMemoryRecordStore();
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			realmStorage,
			sessionStorage,
			popup: createMockPopupTrait(),
		});
		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await expect(
			client.loginWithPopup({
				popupCallbackUrl: "https://app.example.com/auth/popup-callback",
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Storage,
			code: "storage.ephemeral.io_failed",
		});
		expect(popupMocks.open).not.toHaveBeenCalled();
		expect(
			sessionStorage.get("securitydept.frontend_oidc.pending:state-value"),
		).toBeNull();
	});

	it("does not fall back to realm storage when session storage fails", async () => {
		const sessionStorage = createFailingStorage();
		const navigate = vi.fn(async () => undefined);
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			sessionStorage,
			router: {
				currentUrl: () =>
					UriReferenceString.parse("https://app.example.com/login"),
				navigate,
			},
		});
		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await expect(client.loginWithRedirect()).rejects.toMatchObject({
			kind: ClientErrorKind.Storage,
			code: "storage.ephemeral.io_failed",
		});
		expect(
			runtime.realmStorage.get(
				"securitydept.frontend_oidc.pending:state-value",
			),
		).toBeNull();
		expect(navigate).not.toHaveBeenCalled();
	});

	it("requires session storage for redirect and direct callback flows", async () => {
		const navigate = vi.fn(async () => undefined);
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			router: {
				currentUrl: () =>
					UriReferenceString.parse("https://app.example.com/login"),
				navigate,
			},
		});
		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await expect(client.loginWithRedirect()).rejects.toMatchObject({
			kind: ClientErrorKind.Configuration,
			code: FrontendOidcModeErrorCode.SessionStorageUnavailable,
		});
		await expect(
			client.handleCallback({ code: "auth-code", state: "state-value" }),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Configuration,
			code: FrontendOidcModeErrorCode.SessionStorageUnavailable,
		});
		expect(navigate).not.toHaveBeenCalled();
	});

	it("fails page helpers without explicit environment instead of reading a global window", async () => {
		const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		let windowRead = false;

		Object.defineProperty(globalThis, "window", {
			configurable: true,
			get() {
				windowRead = true;
				return {
					location: {
						href: "https://app.example.com/auth/callback?code=auth-code",
						hash: "",
					},
				};
			},
		});

		try {
			const runtime = createFoundationEnvironment({
				transport: {
					execute: vi.fn(async () => ({
						status: 200,
						headers: {},
						body: null,
					})),
				},
				span: createRootSpan(),
				sessionStorage: createInMemoryRecordStore(),
			});

			const client = FrontendOidcModeClient.fromEnvironmentConfig({
				config: {
					issuer: "https://auth.example.com",
					clientId: "spa-client",
					redirectUri: "https://app.example.com/auth/callback",
					authorizationEndpoint: "https://auth.example.com/authorize",
					tokenEndpoint: "https://auth.example.com/token",
				},
				environment: runtime,
			});

			await expect(client.loginWithRedirect()).rejects.toMatchObject({
				code: "frontend_oidc.redirect.router_unavailable",
			});
			await expect(client.loginWithRedirect({})).rejects.toMatchObject({
				code: "frontend_oidc.redirect.router_unavailable",
			});
			expect(windowRead).toBe(false);
		} finally {
			if (originalWindowDescriptor) {
				Object.defineProperty(globalThis, "window", originalWindowDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "window");
			}
		}
	});

	it("records callback failure details as structured trace attributes", async () => {
		const trace = new InMemoryTraceCollector();
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage: createInMemoryRecordStore(),
			tracing: createTracing({ subscribers: [trace] }),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await expect(
			client.handleCallback("?code=auth-code&state=missing-state"),
		).rejects.toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.UnknownState,
		});

		expect(
			trace
				.ofType(OperationTraceEventType.Error)
				.filter(
					(event) => event.fields?.operationName === "frontend_oidc.callback",
				),
		).toEqual([
			expect.objectContaining({
				fields: expect.objectContaining({
					errorCode: FrontendOidcModeCallbackErrorCode.UnknownState,
					recovery: "restart_flow",
				}),
			}),
		]);
	});

	it("correlates callback lifecycle events with frontend callback traces", async () => {
		const trace = new InMemoryTraceCollector();
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage: createInMemoryRecordStore(),
			tracing: createTracing({ subscribers: [trace] }),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await client.authorizeUrl({ postAuthRedirectUri: "/after-login" });
		await client.handleCallback("?code=auth-code&state=state-value");

		const callbackStarted = trace
			.ofType(OperationTraceEventType.Started)
			.find(
				(event) => event.fields?.operationName === "frontend_oidc.callback",
			);
		const callbackSucceeded = trace
			.ofType(OperationTraceEventType.Ended)
			.find(
				(event) =>
					event.fields?.operationName === "frontend_oidc.callback" &&
					event.fields?.outcome === "succeeded",
			);
		const operationSpanId = callbackStarted?.span?.id;

		expect(operationSpanId).toBeTruthy();
		expect(callbackSucceeded?.span?.id).toBe(operationSpanId);
		expect(
			trace.assertOperationLifecycle(operationSpanId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fields: expect.objectContaining({
						operationName: "frontend_oidc.callback",
					}),
				}),
			]),
		);
	});

	it("correlates refresh lifecycle events with frontend refresh traces", async () => {
		const trace = new InMemoryTraceCollector();
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage: createInMemoryRecordStore(),
			tracing: createTracing({ subscribers: [trace] }),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		await client.restoreState({
			tokens: {
				accessToken: "seed-at",
				idToken: "seed-idt",
				refreshMaterial: "seed-rt",
				accessTokenExpiresAt: "2020-01-01T00:05:00.000Z",
			},
			metadata: {},
		});

		await client.refreshState();

		const refreshStarted = trace
			.ofType(OperationTraceEventType.Started)
			.find((event) => event.fields?.operationName === "frontend_oidc.refresh");
		const refreshSucceeded = trace
			.ofType(OperationTraceEventType.Ended)
			.find(
				(event) =>
					event.fields?.operationName === "frontend_oidc.refresh" &&
					event.fields?.outcome === "succeeded",
			);
		const operationSpanId = refreshStarted?.span?.id;

		expect(operationSpanId).toBeTruthy();
		expect(refreshSucceeded?.span?.id).toBe(operationSpanId);
		expect(
			trace.assertOperationLifecycle(operationSpanId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fields: expect.objectContaining({
						operationName: "frontend_oidc.refresh",
					}),
				}),
			]),
		);
	});

	it("emits callback auth.authenticated with minimal terminal payload", async () => {
		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage: createInMemoryRecordStore(),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});
		const events: TokenSetAuthEvent[] = [];
		client.authEvents.subscribe({ next: (event) => events.push(event) });

		await client.authorizeUrl({ postAuthRedirectUri: "/after-login" });
		await client.handleCallback("?code=auth-code&state=state-value");

		const authenticatedEvents = events.filter(
			(event) => event.type === TokenSetAuthEventType.AuthAuthenticated,
		);
		const callbackAuthenticatedEvent =
			authenticatedEvents[authenticatedEvents.length - 1];

		expect(callbackAuthenticatedEvent?.payload).toEqual({
			type: TokenSetAuthEventType.AuthAuthenticated,
			client: { id: expect.any(String) },
		});
		expect(callbackAuthenticatedEvent?.payload).not.toHaveProperty("freshness");
		expect(callbackAuthenticatedEvent?.payload).not.toHaveProperty(
			"hasRefreshMaterial",
		);
	});

	it("preserves existing refresh material when refresh responses omit refresh_token", async () => {
		oauthMocks.processRefreshTokenResponse.mockResolvedValue({
			access_token: "refresh-access-token",
			expires_in: 300,
		});

		const runtime = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 200, headers: {}, body: null })),
			},
			span: createRootSpan(),
			sessionStorage: createInMemoryRecordStore(),
		});

		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config: {
				issuer: "https://auth.example.com",
				clientId: "spa-client",
				redirectUri: "https://app.example.com/auth/callback",
				authorizationEndpoint: "https://auth.example.com/authorize",
				tokenEndpoint: "https://auth.example.com/token",
			},
			environment: runtime,
		});

		client.restoreState({
			tokens: {
				accessToken: "seed-at",
				idToken: "seed-idt",
				refreshMaterial: "seed-rt",
				accessTokenExpiresAt: "2026-01-01T00:05:00.000Z",
			},
			metadata: {},
		});

		const refreshed = await client.refreshState();

		expect(refreshed?.tokens.refreshMaterial).toBe("seed-rt");
		expect(
			expectSnapshotValue(client.authSnapshot)?.tokens.refreshMaterial,
		).toBe("seed-rt");
	});
});
