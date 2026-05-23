import { describe, expect, it, vi } from "vitest";
import {
	createPageResumeSource,
	type PageResumeDocumentTarget,
	PageResumeTriggerKind,
	type PageResumeWindowTarget,
} from "../events/page-resume";

function createMockDocument(
	initialState: DocumentVisibilityState = "visible",
): PageResumeDocumentTarget & {
	simulateChange(state: DocumentVisibilityState): void;
	removeEventListener: ReturnType<typeof vi.fn>;
} {
	let handler: EventListener | undefined;
	let visibilityState = initialState;
	const removeEventListener = vi.fn(
		(_type: "visibilitychange", _handler: EventListener) => {},
	);

	return {
		addEventListener: (_type, nextHandler) => {
			handler = nextHandler;
		},
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

function createMockWindow(): PageResumeWindowTarget & {
	dispatch(type: "pageshow" | "focus" | "online", event?: Event): void;
	removeEventListener: ReturnType<typeof vi.fn>;
} {
	const handlers = new Map<string, EventListener>();
	const removeEventListener = vi.fn(
		(_type: "pageshow" | "focus" | "online", _handler: EventListener) => {},
	);

	return {
		addEventListener: (type, handler) => {
			handlers.set(type, handler);
		},
		removeEventListener,
		dispatch(type, event = new Event(type)) {
			handlers.get(type)?.(event);
		},
	};
}

describe("createPageResumeSource", () => {
	it("emits visibility, pageshow, focus, and online resume events", () => {
		const doc = createMockDocument("visible");
		const win = createMockWindow();
		const events: unknown[] = [];

		const subscription = createPageResumeSource({
			documentTarget: doc,
			windowTarget: win,
		}).subscribe({
			next: (event) => events.push(event),
		});

		doc.simulateChange("hidden");
		doc.simulateChange("visible");
		win.dispatch("pageshow");
		win.dispatch("focus");
		win.dispatch("online");

		expect(events).toEqual([
			{ trigger: PageResumeTriggerKind.Visibility },
			{ trigger: PageResumeTriggerKind.PageShow, persisted: false },
			{ trigger: PageResumeTriggerKind.Focus },
			{ trigger: PageResumeTriggerKind.Online },
		]);

		subscription.unsubscribe();
	});

	it("does not implicitly read global document/window targets", () => {
		const events: unknown[] = [];
		const subscription = createPageResumeSource({
			documentTarget: null,
			windowTarget: null,
		}).subscribe({
			next: (event) => events.push(event),
		});

		subscription.unsubscribe();
		expect(events).toEqual([]);
	});

	it("removes registered listeners on unsubscribe", () => {
		const doc = createMockDocument("visible");
		const win = createMockWindow();

		const subscription = createPageResumeSource({
			documentTarget: doc,
			windowTarget: win,
		}).subscribe({ next: () => {} });

		subscription.unsubscribe();

		expect(doc.removeEventListener).toHaveBeenCalledTimes(1);
		expect(win.removeEventListener).toHaveBeenCalledTimes(3);
	});
});
