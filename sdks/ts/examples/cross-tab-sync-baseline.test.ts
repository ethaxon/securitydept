// @vitest-environment jsdom
// Cross-tab sync baseline — adopter-facing evidence
//
// Proves the cross-tab state sync baseline:
//   1. Fires callback when another tab modifies the watched key
//   2. Ignores changes to other keys
//   3. Tracks sync count
//   4. Dispose stops listening
//   5. Composable with AuthMaterialController for state reconciliation

import { createCrossTabSync } from "@securitydept/client/web";
import { createAuthMaterialController } from "@securitydept/token-set-context-client/orchestration";
import { describe, expect, it, vi } from "vitest";

function createMockTarget() {
	let handler: ((event: Event) => void) | undefined;
	return {
		addEventListener: (_type: string, h: EventListener) => {
			handler = h as (event: Event) => void;
		},
		removeEventListener: vi.fn(),
		// Test helper: simulate a storage event.
		simulateStorageEvent(
			key: string,
			newValue: string | null,
			oldValue: string | null,
		) {
			const event = new Event("storage") as Event & {
				key: string | null;
				newValue: string | null;
				oldValue: string | null;
			};
			Object.defineProperties(event, {
				key: { value: key },
				newValue: { value: newValue },
				oldValue: { value: oldValue },
			});
			handler?.(event);
		},
	};
}

describe("cross-tab sync baseline", () => {
	it("fires onSync when watched key changes", () => {
		const onSync = vi.fn();
		const target = createMockTarget();

		createCrossTabSync({
			key: "auth:v1",
			onSync,
			target,
		});

		target.simulateStorageEvent("auth:v1", '{"tokens":{}}', null);
		expect(onSync).toHaveBeenCalledTimes(1);
		expect(onSync).toHaveBeenCalledWith({
			newValue: '{"tokens":{}}',
			oldValue: null,
		});
	});

	it("ignores changes to unrelated keys", () => {
		const onSync = vi.fn();
		const target = createMockTarget();

		createCrossTabSync({
			key: "auth:v1",
			onSync,
			target,
		});

		target.simulateStorageEvent("other-key", "value", null);
		expect(onSync).not.toHaveBeenCalled();
	});

	it("tracks syncCount", () => {
		const target = createMockTarget();

		const sync = createCrossTabSync({
			key: "auth:v1",
			onSync: () => {},
			target,
		});

		expect(sync.syncCount).toBe(0);
		target.simulateStorageEvent("auth:v1", "a", null);
		expect(sync.syncCount).toBe(1);
		target.simulateStorageEvent("auth:v1", "b", "a");
		expect(sync.syncCount).toBe(2);
	});

	it("stops listening after dispose", () => {
		const target = createMockTarget();

		const sync = createCrossTabSync({
			key: "auth:v1",
			onSync: () => {},
			target,
		});

		sync.dispose();
		expect(target.removeEventListener).toHaveBeenCalledWith(
			"storage",
			expect.any(Function),
		);
	});

	it("composes with AuthMaterialController for state reconciliation", () => {
		const controller = createAuthMaterialController();
		const target = createMockTarget();
		const restoredTokens: string[] = [];

		createCrossTabSync({
			key: "auth:v1",
			onSync: ({ newValue }) => {
				if (newValue) {
					// In a real app, parse and inject the snapshot.
					// Here we verify the controller is reachable from the callback.
					controller.injectSnapshot({
						tokens: { accessToken: `synced-${newValue}` },
						metadata: {},
					});
					const token = controller.snapshot?.tokens.accessToken;
					if (token) restoredTokens.push(token);
				}
			},
			target,
		});

		target.simulateStorageEvent("auth:v1", "token-data", null);
		expect(restoredTokens).toEqual(["synced-token-data"]);
		expect(controller.authorizationHeader).toBe("Bearer synced-token-data");
	});
});
