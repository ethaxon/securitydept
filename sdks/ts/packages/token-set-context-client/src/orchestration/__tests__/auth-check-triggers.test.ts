import { describe, expect, it, vi } from "vitest";
import {
	attachPageResumeAuthCheckTriggerSource,
	createPageResumeAuthCheckTriggerSource,
} from "../state/auth-check-triggers";

function createMockDocument(initialState: DocumentVisibilityState = "hidden") {
	let handler: EventListener | undefined;
	let visibilityState = initialState;
	const addEventListener = vi.fn(
		(_type: "visibilitychange", nextHandler: EventListener) => {
			handler = nextHandler;
		},
	);
	const removeEventListener = vi.fn(
		(_type: "visibilitychange", nextHandler: EventListener) => {
			if (handler === nextHandler) {
				handler = undefined;
			}
		},
	);

	return {
		addEventListener,
		removeEventListener,
		get visibilityState() {
			return visibilityState;
		},
		simulateChange(state: DocumentVisibilityState) {
			visibilityState = state;
			handler?.(new Event("visibilitychange"));
		},
	};
}

function createMockWindow() {
	const handlers = new Map<string, EventListener>();
	return {
		addEventListener: vi.fn((type: string, handler: EventListener) => {
			handlers.set(type, handler);
		}),
		removeEventListener: vi.fn((type: string, handler: EventListener) => {
			if (handlers.get(type) === handler) {
				handlers.delete(type);
			}
		}),
		dispatch(type: string, event: Event = new Event(type)) {
			handlers.get(type)?.(event);
		},
	};
}

describe("token-set auth-check trigger sources", () => {
	it("emits page-resume auth-check triggers from DOM lifecycle events", () => {
		const documentTarget = createMockDocument("hidden");
		const events: unknown[] = [];
		const source = createPageResumeAuthCheckTriggerSource({
			document: documentTarget,
			window: null,
			throttleMs: 0,
			clockSkewMs: 123,
			refreshWindowMs: 456,
		});

		const subscription = source.subscribe({
			next: (event) => events.push(event),
		});
		documentTarget.simulateChange("visible");

		expect(events).toEqual([
			{
				source: "resume",
				reason: "page_resume",
				forceRefreshWhenDue: true,
				clearStateWhenUnauthenticated: false,
				clockSkewMs: 123,
				refreshWindowMs: 456,
			},
		]);

		subscription.unsubscribe();
		documentTarget.simulateChange("hidden");
		documentTarget.simulateChange("visible");
		expect(events).toHaveLength(1);
		expect(documentTarget.removeEventListener).toHaveBeenCalledTimes(1);
	});

	it("uses fromEventPattern cleanup for all browser listeners", () => {
		const documentTarget = createMockDocument("hidden");
		const windowTarget = createMockWindow();
		const source = createPageResumeAuthCheckTriggerSource({
			document: documentTarget,
			window: windowTarget,
			throttleMs: 0,
		});

		const subscription = source.subscribe({ next: () => {} });
		subscription.unsubscribe();

		expect(documentTarget.removeEventListener).toHaveBeenCalledTimes(1);
		expect(windowTarget.removeEventListener).toHaveBeenCalledTimes(3);
	});

	it("attaches default page-resume source once and preserves custom sources", () => {
		const documentTarget = createMockDocument("hidden");
		const customSource = createPageResumeAuthCheckTriggerSource({
			document: null,
			window: null,
		});
		const addAuthCheckTriggerSource = vi.fn(() => ({
			unsubscribe: vi.fn(),
		}));
		const client = { addAuthCheckTriggerSource };

		attachPageResumeAuthCheckTriggerSource(client, {
			pageResumeAuthCheckOptions: {
				document: documentTarget,
				window: null,
				throttleMs: 0,
			},
			authCheckTriggerSources: [customSource],
		});
		attachPageResumeAuthCheckTriggerSource(client, {
			pageResumeAuthCheckOptions: {
				document: documentTarget,
				window: null,
				throttleMs: 0,
			},
			authCheckTriggerSources: [customSource],
		});

		expect(addAuthCheckTriggerSource).toHaveBeenCalledTimes(3);
	});
});
