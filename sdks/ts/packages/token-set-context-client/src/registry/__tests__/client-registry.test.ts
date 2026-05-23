import {
	createSubject,
	type FoundationEnvironment,
} from "@securitydept/client";
import { describe, expect, it } from "vitest";
import {
	createTokenSetAuthEvent,
	type TokenSetAuthEvent,
	TokenSetAuthEventType,
	TokenSetAuthFlowOutcome,
} from "../../orchestration";
import { createTokenSetAuthRegistry } from "../core/client-registry";

interface TestService {
	authEvents: ReturnType<typeof createSubject<TokenSetAuthEvent>>;
}

const TEST_IDLE_CALLBACK = {
	requestIdleCallback: (callback: () => void) => setTimeout(callback, 0),
	cancelIdleCallback: (handle: unknown) =>
		clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const TEST_ENVIRONMENT: FoundationEnvironment = {
	transport: { execute: async () => ({ status: 204, headers: {} }) },
	time: {
		now: () => Date.now(),
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimeout: (handle) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>),
	},
	idleCallback: TEST_IDLE_CALLBACK,
};

function createService(): TestService {
	return {
		authEvents: createSubject<TokenSetAuthEvent>(),
	};
}

describe("TokenSetAuthRegistry auth flow", () => {
	it("aggregates auth events and fills missing client keys", () => {
		const service = createService();
		const registry = createTokenSetAuthRegistry<TestService, TestService>({
			materialize: (client) => client,
			dispose: () => undefined,
			authEventsOf: (service) => service.authEvents,
			environment: TEST_ENVIRONMENT,
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

	it("passes the registry environment to clientFactory", () => {
		const service = createService();
		let receivedEnvironment: FoundationEnvironment | undefined;
		const registry = createTokenSetAuthRegistry<TestService, TestService>({
			materialize: (client) => client,
			dispose: () => undefined,
			authEventsOf: (service) => service.authEvents,
			environment: TEST_ENVIRONMENT,
		});

		registry.register({
			key: "main",
			clientFactory: (environment) => {
				receivedEnvironment = environment;
				return service;
			},
		});

		expect(receivedEnvironment).toBe(TEST_ENVIRONMENT);
	});
});
