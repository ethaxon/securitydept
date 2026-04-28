import { createSubject } from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	createTokenSetAuthEvent,
	type EnsureAuthForResourceOptions,
	type EnsureAuthForResourceResult,
	EnsureAuthForResourceStatus,
	type TokenSetAuthEvent,
	TokenSetAuthEventType,
	TokenSetAuthFlowOutcome,
	TokenSetAuthFlowSource,
} from "../../orchestration";
import { createTokenSetAuthRegistry } from "../client-registry";
import { ClientInitializationPriority } from "../types";

interface TestService {
	authEvents: ReturnType<typeof createSubject<TokenSetAuthEvent>>;
	ensureAuthForResource: (
		options?: EnsureAuthForResourceOptions,
	) => Promise<EnsureAuthForResourceResult>;
}

function createAuthenticatedResult(): EnsureAuthForResourceResult {
	return {
		status: EnsureAuthForResourceStatus.Authenticated,
		snapshot: {
			tokens: {
				accessToken: "access-token",
			},
			metadata: {},
		},
		freshness: "fresh",
	};
}

function createService(): TestService {
	return {
		authEvents: createSubject<TokenSetAuthEvent>(),
		ensureAuthForResource: vi
			.fn<
				(
					options?: EnsureAuthForResourceOptions,
				) => Promise<EnsureAuthForResourceResult>
			>()
			.mockResolvedValue(createAuthenticatedResult()),
	};
}

describe("TokenSetAuthRegistry auth flow", () => {
	it("waits for lazy clients and forwards ensureAuthForResource with the registry key", async () => {
		const service = createService();
		const factory = vi.fn().mockResolvedValue(service);
		const registry = createTokenSetAuthRegistry<TestService, TestService>({
			materialize: (client) => client,
		});

		registry.register({
			key: "confluence",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: factory,
		});

		const result = await registry.ensureAuthForResource({
			key: "confluence",
			source: TokenSetAuthFlowSource.RouteGuard,
			requirement: { kind: "wiki" },
		});

		expect(result?.status).toBe(EnsureAuthForResourceStatus.Authenticated);
		expect(factory).toHaveBeenCalledTimes(1);
		expect(service.ensureAuthForResource).toHaveBeenCalledWith({
			source: TokenSetAuthFlowSource.RouteGuard,
			requirement: { kind: "wiki" },
			clientKey: "confluence",
		});
	});

	it("does not materialize lazy clients when waitForReady is false", async () => {
		const factory = vi.fn().mockResolvedValue(createService());
		const registry = createTokenSetAuthRegistry<TestService, TestService>({
			materialize: (client) => client,
		});

		registry.register({
			key: "confluence",
			priority: ClientInitializationPriority.Lazy,
			clientFactory: factory,
		});

		await expect(
			registry.ensureAuthForResource({
				key: "confluence",
				waitForReady: false,
			}),
		).resolves.toBeNull();
		expect(factory).not.toHaveBeenCalled();
	});

	it("aggregates auth events and fills missing client keys", () => {
		const service = createService();
		const registry = createTokenSetAuthRegistry<TestService, TestService>({
			materialize: (client) => client,
		});
		const events: TokenSetAuthEvent[] = [];
		registry.authEvents.subscribe({ next: (event) => events.push(event) });

		registry.register({
			key: "confluence",
			clientFactory: () => service,
		});
		service.authEvents.next(
			createTokenSetAuthEvent({
				id: "event-1",
				type: TokenSetAuthEventType.AuthAuthenticated,
				at: 1,
				payload: {
					source: TokenSetAuthFlowSource.RouteGuard,
					outcome: TokenSetAuthFlowOutcome.Authenticated,
				},
			}),
		);

		expect(events).toEqual([
			expect.objectContaining({
				id: "event-1",
				payload: expect.objectContaining({ clientKey: "confluence" }),
			}),
		]);
	});
});
