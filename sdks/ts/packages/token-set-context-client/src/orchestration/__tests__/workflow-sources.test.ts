import { createSubject } from "@securitydept/client";
import { createPageResumeSource } from "@securitydept/client/web";
import { describe, expect, it, vi } from "vitest";
import {
	type AuthWorkflowSource,
	createPageResumeWorkflowSource,
	type TokenSetAuthWorkflowTriggerData,
} from "../client/workflows/source";
import { createAuthWorkflowSourceHub } from "../client/workflows/source/dispatcher";

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

function createNamedWorkflowSource(name: string): AuthWorkflowSource & {
	next(value: TokenSetAuthWorkflowTriggerData): void;
} {
	const subject = createSubject<TokenSetAuthWorkflowTriggerData>();
	return Object.assign(subject, { name });
}

describe("token-set workflow sources", () => {
	it("does not implicitly read global document/window targets", () => {
		const originalDocument = Object.getOwnPropertyDescriptor(
			globalThis,
			"document",
		);
		const originalWindow = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		const documentTarget = createMockDocument("hidden");
		const windowTarget = createMockWindow();
		Object.defineProperty(globalThis, "document", {
			value: documentTarget,
			configurable: true,
		});
		Object.defineProperty(globalThis, "window", {
			value: windowTarget,
			configurable: true,
		});
		try {
			const events: unknown[] = [];
			const source = createPageResumeWorkflowSource({
				pageLifecycle: null,
				throttleMs: 0,
				now: () => 10_000,
			});
			const subscription = source.subscribe({
				next: (event) => events.push(event),
			});

			documentTarget.simulateChange("visible");
			windowTarget.dispatch("focus");

			expect(events).toEqual([]);
			expect(documentTarget.addEventListener).not.toHaveBeenCalled();
			expect(windowTarget.addEventListener).not.toHaveBeenCalled();

			subscription.unsubscribe();
		} finally {
			restoreGlobalProperty("document", originalDocument);
			restoreGlobalProperty("window", originalWindow);
		}
	});

	it("emits page-resume workflow triggers from DOM lifecycle events", () => {
		const documentTarget = createMockDocument("hidden");
		const events: unknown[] = [];
		const source = createPageResumeWorkflowSource({
			pageLifecycle: {
				resume: createPageResumeSource({
					documentTarget,
					windowTarget: null,
				}),
			},
			throttleMs: 0,
			now: () => 10_000,
			clockSkewMs: 123,
			refreshWindowMs: 456,
		});

		const subscription = source.subscribe({
			next: (event) => events.push(event),
		});
		documentTarget.simulateChange("visible");

		expect(events).toEqual([
			{
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
		const source = createPageResumeWorkflowSource({
			pageLifecycle: {
				resume: createPageResumeSource({
					documentTarget,
					windowTarget,
				}),
			},
			throttleMs: 0,
			now: () => 10_000,
		});

		const subscription = source.subscribe({ next: () => {} });
		subscription.unsubscribe();

		expect(documentTarget.removeEventListener).toHaveBeenCalledTimes(1);
		expect(windowTarget.removeEventListener).toHaveBeenCalledTimes(3);
	});

	it("lets callers compose page-resume and custom sources explicitly", () => {
		const documentTarget = createMockDocument("hidden");
		const customSource = createPageResumeWorkflowSource({
			pageLifecycle: null,
			now: () => 10_000,
		});
		const addWorkflowSource = vi.fn(
			(_source: ReturnType<typeof createPageResumeWorkflowSource>) => ({
				unsubscribe: vi.fn(),
			}),
		);
		const client = { addWorkflowSource };

		client.addWorkflowSource(
			createPageResumeWorkflowSource({
				pageLifecycle: {
					resume: createPageResumeSource({
						documentTarget,
						windowTarget: null,
					}),
				},
				throttleMs: 0,
				now: () => 10_000,
			}),
		);
		client.addWorkflowSource(customSource);

		expect(addWorkflowSource).toHaveBeenCalledTimes(2);
	});

	it("removes runtime trigger sources by source reference", () => {
		const source = createNamedWorkflowSource("custom");
		const hub = createAuthWorkflowSourceHub();
		const next = vi.fn();
		hub.subscribe({ next });

		hub.addSource(source);
		source.next({
			clockSkewMs: 123,
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(next).toHaveBeenCalledWith({
			source: "custom",
			data: {
				clockSkewMs: 123,
			},
		});

		expect(hub.removeSource(source)).toBe(true);
		source.next({
			clockSkewMs: 456,
		});
		expect(next).toHaveBeenCalledTimes(1);
		expect(hub.removeSource(source)).toBe(false);
	});

	it("replaces an existing runtime trigger subscription with the same source reference", () => {
		const source = createNamedWorkflowSource("custom");
		const hub = createAuthWorkflowSourceHub();
		const next = vi.fn();
		hub.subscribe({ next });

		const firstSubscription = hub.addSource(source);
		const secondSubscription = hub.addSource(source);

		expect(firstSubscription).not.toBe(secondSubscription);
		source.next({
			refreshWindowMs: 2000,
		});

		expect(next).toHaveBeenCalledTimes(1);
		expect(next).toHaveBeenCalledWith({
			source: "custom",
			data: {
				refreshWindowMs: 2000,
			},
		});
	});
});

function restoreGlobalProperty(
	key: "document" | "window",
	descriptor: PropertyDescriptor | undefined,
): void {
	if (descriptor) {
		Object.defineProperty(globalThis, key, descriptor);
		return;
	}
	delete (globalThis as Record<string, unknown>)[key];
}
