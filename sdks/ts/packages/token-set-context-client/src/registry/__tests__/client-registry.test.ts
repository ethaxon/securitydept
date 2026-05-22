import { createSubject } from "@securitydept/client";
import { describe, expect, it } from "vitest";
import {
	createTokenSetAuthEvent,
	type TokenSetAuthEvent,
	TokenSetAuthEventType,
	TokenSetAuthFlowOutcome,
	TokenSetAuthFlowSource,
} from "../../orchestration";
import { createTokenSetAuthRegistry } from "../core/client-registry";

interface TestService {
	authEvents: ReturnType<typeof createSubject<TokenSetAuthEvent>>;
}

const TEST_IDLE_SCHEDULER = (callback: () => void): (() => void) => {
	const handle = setTimeout(callback, 0);
	return () => clearTimeout(handle);
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
			idleScheduler: TEST_IDLE_SCHEDULER,
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
