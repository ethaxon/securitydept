import { UserRecovery } from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	TokenSetCallbackResumeController,
	TokenSetCallbackResumeStatus,
} from "../callback-resume-controller";
import { createTokenSetAuthRegistry } from "../client-registry";

function createRegistry(handleCallback = vi.fn()) {
	const registry = createTokenSetAuthRegistry<unknown, { client: never }>({
		materialize: (client) => ({ client: client as never }),
	});
	registry.register({
		key: "frontend",
		callbackPath: "/auth/token-set/callback",
		clientFactory: () => ({ handleCallback }),
	});
	return registry;
}

describe("TokenSetCallbackResumeController", () => {
	it("resumes a callback through the registered client", async () => {
		const handleCallback = vi.fn(async () => ({
			snapshot: { tokens: { accessToken: "live-at" }, metadata: {} },
			postAuthRedirectUri: "/home",
		}));
		const registry = createRegistry(handleCallback);
		const controller = new TokenSetCallbackResumeController({
			registry,
			getCallbackClient: (service) => service.client,
		});

		await expect(
			controller.resume({
				currentUrl:
					"https://app.example.com/auth/token-set/callback?code=abc&state=def",
			}),
		).resolves.toMatchObject({
			clientKey: "frontend",
			postAuthRedirectUri: "/home",
		});
		expect(controller.getState()).toMatchObject({
			status: TokenSetCallbackResumeStatus.Resolved,
			clientKey: "frontend",
		});
		expect(handleCallback).toHaveBeenCalledTimes(1);
	});

	it("records failure details with a shared presenter", async () => {
		const callbackError = new Error("callback failed");
		const handleCallback = vi.fn(async () => {
			throw callbackError;
		});
		const describeError = vi.fn(({ errorDetails, clientKey }) => ({
			code: errorDetails.code,
			kind: errorDetails.kind,
			title: `Callback failed for ${clientKey}`,
			description: errorDetails.message,
			recovery: UserRecovery.RestartFlow,
			retryable: false,
			tone: "warning" as const,
			primaryAction: null,
		}));
		const controller = new TokenSetCallbackResumeController({
			registry: createRegistry(handleCallback),
			getCallbackClient: (service) => service.client,
		});

		await expect(
			controller.resume({
				currentUrl:
					"https://app.example.com/auth/token-set/callback?error=access_denied",
				describeError,
			}),
		).rejects.toBe(callbackError);

		expect(controller.getState()).toMatchObject({
			status: TokenSetCallbackResumeStatus.Error,
			error: callbackError,
			errorDetails: {
				presentation: { title: "Callback failed for frontend" },
			},
		});
	});

	it("dedupes the same callback URL until reset", async () => {
		const deferred = Promise.resolve({
			snapshot: { tokens: { accessToken: "live-at" }, metadata: {} },
			postAuthRedirectUri: "/home",
		});
		const handleCallback = vi.fn(() => deferred);
		const controller = new TokenSetCallbackResumeController({
			registry: createRegistry(handleCallback),
			getCallbackClient: (service) => service.client,
		});
		const currentUrl =
			"https://app.example.com/auth/token-set/callback?code=abc&state=def";

		const first = controller.resume({ currentUrl });
		const second = controller.resume({ currentUrl });

		expect(second).toBe(first);
		await first;
		await controller.resume({ currentUrl });
		expect(handleCallback).toHaveBeenCalledTimes(1);

		controller.reset();
		await controller.resume({ currentUrl });
		expect(handleCallback).toHaveBeenCalledTimes(2);
	});

	it("rejects resume after dispose without changing state or touching the registry", async () => {
		const handleCallback = vi.fn(async () => ({
			snapshot: { tokens: { accessToken: "live-at" }, metadata: {} },
			postAuthRedirectUri: "/home",
		}));
		const registry = createRegistry(handleCallback);
		const whenReady = vi.spyOn(registry, "whenReady");
		const controller = new TokenSetCallbackResumeController({
			registry,
			getCallbackClient: (service) => service.client,
		});
		const currentUrl =
			"https://app.example.com/auth/token-set/callback?code=abc&state=def";

		await controller.resume({ currentUrl });
		const settledState = controller.getState();
		controller.dispose();

		await expect(controller.resume({ currentUrl })).rejects.toThrow(
			/controller has been disposed/,
		);

		expect(controller.getState()).toBe(settledState);
		expect(whenReady).toHaveBeenCalledTimes(1);
		expect(handleCallback).toHaveBeenCalledTimes(1);
	});

	it("keeps reset after dispose as a no-op", async () => {
		const handleCallback = vi.fn(async () => ({
			snapshot: { tokens: { accessToken: "live-at" }, metadata: {} },
			postAuthRedirectUri: "/home",
		}));
		const controller = new TokenSetCallbackResumeController({
			registry: createRegistry(handleCallback),
			getCallbackClient: (service) => service.client,
		});

		await controller.resume({
			currentUrl:
				"https://app.example.com/auth/token-set/callback?code=abc&state=def",
		});
		const settledState = controller.getState();
		controller.dispose();
		controller.reset();

		expect(controller.getState()).toBe(settledState);
	});
});
