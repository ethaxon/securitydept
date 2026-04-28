import { describe, expect, it, vi } from "vitest";
import {
	createPageResumeReconciler,
	type PageResumeDocumentTarget,
	PageResumeTriggerKind,
	type PageResumeWindowTarget,
} from "../page-resume-reconciler";

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

describe("createPageResumeReconciler", () => {
	it("reconciles visibility, pageshow, focus, and online resume triggers", () => {
		const doc = createMockDocument("visible");
		const win = createMockWindow();
		const onReconcile = vi.fn();

		createPageResumeReconciler({
			document: doc,
			window: win,
			onReconcile,
			throttleMs: 0,
			now: () => 10_000,
		});

		doc.simulateChange("hidden");
		doc.simulateChange("visible");
		win.dispatch("pageshow");
		win.dispatch("focus");
		win.dispatch("online");

		expect(onReconcile).toHaveBeenCalledTimes(4);
		expect(onReconcile).toHaveBeenNthCalledWith(1, {
			trigger: PageResumeTriggerKind.Visibility,
		});
		expect(onReconcile).toHaveBeenNthCalledWith(2, {
			trigger: PageResumeTriggerKind.PageShow,
			persisted: false,
		});
		expect(onReconcile).toHaveBeenNthCalledWith(3, {
			trigger: PageResumeTriggerKind.Focus,
		});
		expect(onReconcile).toHaveBeenNthCalledWith(4, {
			trigger: PageResumeTriggerKind.Online,
		});
	});

	it("throttles rapid resume triggers and tracks reconcile count", () => {
		const win = createMockWindow();
		const onReconcile = vi.fn();
		let now = 10_000;

		const reconciler = createPageResumeReconciler({
			document: null,
			window: win,
			onReconcile,
			throttleMs: 5_000,
			now: () => now,
		});

		win.dispatch("focus");
		now += 1_000;
		win.dispatch("online");
		now += 5_000;
		win.dispatch("pageshow");

		expect(onReconcile).toHaveBeenCalledTimes(2);
		expect(reconciler.reconcileCount).toBe(2);
	});

	it("removes registered listeners on dispose", () => {
		const doc = createMockDocument("visible");
		const win = createMockWindow();

		const reconciler = createPageResumeReconciler({
			document: doc,
			window: win,
			onReconcile: () => {},
			throttleMs: 0,
		});

		reconciler.dispose();

		expect(doc.removeEventListener).toHaveBeenCalledTimes(1);
		expect(win.removeEventListener).toHaveBeenCalledTimes(3);
	});
});
