import { OnceAsyncLockState, SYMBOL_DISPOSE } from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import { BackendOidcModeClient } from "../../backend-oidc-mode";
import { FrontendOidcModeClient } from "../../frontend-oidc-mode";
import { type BaseOidcModeClient } from "../../orchestration";
import { BackendOidcModeCallbackController } from "../controller/backend-mode-callback-controller";
import { FrontendOidcModeCallbackController } from "../controller/frontend-mode-callback-controller";
import { createClientRegistry } from "../core/client-registry";
import { ClientRegistryError, ClientRegistryErrorCode } from "../core/error";

function createRegistry(
	handleCallback = vi.fn(),
): ReturnType<typeof createClientRegistry<BaseOidcModeClient>> {
	const registry = createClientRegistry<BaseOidcModeClient>({
		environment: {},
	});
	const dispose = vi.fn();
	const client = {
		handleCallback,
		dispose,
		[SYMBOL_DISPOSE]: dispose,
	} as unknown as FrontendOidcModeClient;
	Object.setPrototypeOf(client, FrontendOidcModeClient.prototype);
	registry.register({
		clientFactory: () => client,
		meta: {
			clientKey: "frontend",
			urlPatterns: [],
			callbackPath: "/auth/token-set/callback",
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: "immediate",
		},
	});
	return registry;
}

function createBackendRegistry(
	handleCallback = vi.fn(),
): ReturnType<typeof createClientRegistry<BaseOidcModeClient>> {
	const registry = createClientRegistry<BaseOidcModeClient>({
		environment: {},
	});
	const dispose = vi.fn();
	const client = {
		handleCallback,
		dispose,
		[SYMBOL_DISPOSE]: dispose,
	} as unknown as BackendOidcModeClient;
	Object.setPrototypeOf(client, BackendOidcModeClient.prototype);
	registry.register({
		clientFactory: () => client,
		meta: {
			clientKey: "backend",
			urlPatterns: [],
			callbackPath: undefined,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: "immediate",
		},
	});
	return registry;
}

describe("FrontendOidcModeCallbackController", () => {
	it("handles a callback through the matched frontend client", async () => {
		const handleCallback = vi.fn(async () => ({
			snapshot: { tokens: { accessToken: "live-at" }, metadata: {} },
			postAuthRedirectUri: "/home",
		}));
		const registry = createRegistry(handleCallback);
		const registryFactory = vi.fn(() => registry);
		const currentUrl =
			"https://app.example.com/auth/token-set/callback?code=abc&state=def";
		const currentUrlFactory = vi.fn(() => currentUrl);
		const clientQueryFactory = vi.fn(() => undefined);
		const controller = new FrontendOidcModeCallbackController({
			registry: registryFactory,
			currentUrl: currentUrlFactory,
			clientQuery: clientQueryFactory,
		});

		await expect(controller.handle()).resolves.toMatchObject({
			clientRecord: { meta: { clientKey: "frontend" } },
			postAuthRedirectUri: "/home",
		});
		expect(controller.state.get()).toMatchObject({
			state: OnceAsyncLockState.Success,
			data: { clientRecord: { meta: { clientKey: "frontend" } } },
		});
		expect(handleCallback).toHaveBeenCalledTimes(1);
		expect(registryFactory).toHaveBeenCalledTimes(1);
		expect(currentUrlFactory).toHaveBeenCalledTimes(1);
		expect(clientQueryFactory).toHaveBeenCalledTimes(1);
	});

	it("uses clientQuery as the callback query override path", async () => {
		const handleCallback = vi.fn(async () => ({
			snapshot: { tokens: { accessToken: "live-at" }, metadata: {} },
			postAuthRedirectUri: "/home",
		}));
		const controller = new FrontendOidcModeCallbackController({
			registry: () => createRegistry(handleCallback),
			currentUrl: () =>
				"https://app.example.com/not-callback?code=abc&state=def",
			clientQuery: () => ({
				clientKey: "frontend",
				callbackUrl:
					"https://app.example.com/auth/token-set/callback?code=abc&state=def",
			}),
		});

		await expect(controller.handle()).resolves.toMatchObject({
			clientRecord: { meta: { clientKey: "frontend" } },
		});
	});

	it("records the failed state when callback handling fails", async () => {
		const callbackError = new Error("callback failed");
		const handleCallback = vi.fn(async () => {
			throw callbackError;
		});
		const controller = new FrontendOidcModeCallbackController({
			registry: () => createRegistry(handleCallback),
			currentUrl: () =>
				"https://app.example.com/auth/token-set/callback?error=access_denied",
		});

		await expect(controller.handle()).rejects.toBe(callbackError);

		expect(controller.state.get()).toMatchObject({
			state: OnceAsyncLockState.Error,
			error: callbackError,
		});
	});

	it("uses structured errors when no frontend callback client matches", async () => {
		const controller = new FrontendOidcModeCallbackController({
			registry: () => createRegistry(),
			currentUrl: () => "https://app.example.com/not-callback?code=abc",
		});

		await expect(controller.handle()).rejects.toMatchObject({
			name: "ClientRegistryError",
			code: ClientRegistryErrorCode.CallbackClientNotFound,
		});
		expect(controller.state.get()).toMatchObject({
			state: OnceAsyncLockState.Error,
			error: expect.any(ClientRegistryError),
		});
	});
});

describe("BackendOidcModeCallbackController", () => {
	it("handles a callback through the matched backend client", async () => {
		const handleCallback = vi.fn(async () => ({
			tokens: { accessToken: "live-at" },
			metadata: {},
		}));
		const registry = createBackendRegistry(handleCallback);
		const registryFactory = vi.fn(() => registry);
		const clientQueryFactory = vi.fn(() => ({ clientKey: "backend" }));
		const payloadFactory = vi.fn(() => ({ id_token: "id-token" }));
		const controller = new BackendOidcModeCallbackController({
			registry: registryFactory,
			clientQuery: clientQueryFactory,
			payload: payloadFactory,
		});

		await expect(controller.handle()).resolves.toMatchObject({
			clientRecord: { meta: { clientKey: "backend" } },
			snapshot: { tokens: { accessToken: "live-at" } },
		});
		expect(controller.state.get()).toMatchObject({
			state: OnceAsyncLockState.Success,
			data: { clientRecord: { meta: { clientKey: "backend" } } },
		});
		expect(handleCallback).toHaveBeenCalledWith({ id_token: "id-token" });
		expect(registryFactory).toHaveBeenCalledTimes(1);
		expect(clientQueryFactory).toHaveBeenCalledTimes(1);
		expect(payloadFactory).toHaveBeenCalledTimes(1);
	});

	it("records the failed state when backend callback handling fails", async () => {
		const callbackError = new Error("backend callback failed");
		const handleCallback = vi.fn(async () => {
			throw callbackError;
		});
		const controller = new BackendOidcModeCallbackController({
			registry: () => createBackendRegistry(handleCallback),
			clientQuery: () => ({ clientKey: "backend" }),
			payload: () => ({ error: "access_denied" }),
		});

		await expect(controller.handle()).rejects.toBe(callbackError);

		expect(controller.state.get()).toMatchObject({
			state: OnceAsyncLockState.Error,
			error: callbackError,
		});
	});

	it("uses structured errors when the matched backend client has the wrong mode", async () => {
		const controller = new BackendOidcModeCallbackController({
			registry: () => createRegistry(),
			clientQuery: () => ({ clientKey: "frontend" }),
			payload: () => ({ id_token: "id-token" }),
		});

		await expect(controller.handle()).rejects.toMatchObject({
			name: "ClientRegistryError",
			code: ClientRegistryErrorCode.CallbackClientModeMismatch,
			clientKey: "frontend",
		});
		expect(controller.state.get()).toMatchObject({
			state: OnceAsyncLockState.Error,
			error: expect.any(ClientRegistryError),
		});
	});
});
