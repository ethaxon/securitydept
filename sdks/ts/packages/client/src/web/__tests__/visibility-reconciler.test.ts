// @vitest-environment jsdom
// Visibility reconciler — focused tests
//
// Tests for the cross-tab / visibility lifecycle hardening baseline.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createVisibilityReconciler } from "../visibility-reconciler";

function createMockDocument(initialState: DocumentVisibilityState = "visible") {
	let handler: (() => void) | undefined;
	let visibilityState: DocumentVisibilityState = initialState;

	return {
		addEventListener: (_type: string, h: EventListener) => {
			handler = h as () => void;
		},
		removeEventListener: vi.fn(),
		get visibilityState() {
			return visibilityState;
		},
		// Test helper: simulate a visibility change.
		simulateChange(state: DocumentVisibilityState) {
			visibilityState = state;
			handler?.();
		},
	};
}

describe("createVisibilityReconciler", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("fires onReconcile on hidden → visible transition", () => {
		const onReconcile = vi.fn();
		const doc = createMockDocument("visible");
		const now = 10000;

		createVisibilityReconciler({
			onReconcile,
			document: doc,
			throttleMs: 1000,
			now: () => now,
		});

		// hidden → visible should trigger.
		doc.simulateChange("hidden");
		doc.simulateChange("visible");
		expect(onReconcile).toHaveBeenCalledTimes(1);
	});

	it("does NOT fire on visible → visible (no edge)", () => {
		const onReconcile = vi.fn();
		const doc = createMockDocument("visible");

		createVisibilityReconciler({
			onReconcile,
			document: doc,
			throttleMs: 0,
			now: () => Date.now(),
		});

		doc.simulateChange("visible");
		doc.simulateChange("visible");
		expect(onReconcile).not.toHaveBeenCalled();
	});

	it("throttles rapid hidden→visible toggles", () => {
		const onReconcile = vi.fn();
		const doc = createMockDocument("visible");
		let now = 10000;

		createVisibilityReconciler({
			onReconcile,
			document: doc,
			throttleMs: 5000,
			now: () => now,
		});

		// First cycle — should fire.
		doc.simulateChange("hidden");
		doc.simulateChange("visible");
		expect(onReconcile).toHaveBeenCalledTimes(1);

		// Second cycle immediately — should NOT fire (throttled).
		now += 1000; // only 1s later
		doc.simulateChange("hidden");
		doc.simulateChange("visible");
		expect(onReconcile).toHaveBeenCalledTimes(1);

		// Third cycle after throttle window — should fire.
		now += 5000;
		doc.simulateChange("hidden");
		doc.simulateChange("visible");
		expect(onReconcile).toHaveBeenCalledTimes(2);
	});

	it("tracks reconcileCount", () => {
		const doc = createMockDocument("visible");
		let now = 10000;

		const reconciler = createVisibilityReconciler({
			onReconcile: () => {},
			document: doc,
			throttleMs: 0,
			now: () => now++,
		});

		expect(reconciler.reconcileCount).toBe(0);
		doc.simulateChange("hidden");
		doc.simulateChange("visible");
		expect(reconciler.reconcileCount).toBe(1);
	});

	it("stops listening after dispose", () => {
		const onReconcile = vi.fn();
		const doc = createMockDocument("visible");

		const reconciler = createVisibilityReconciler({
			onReconcile,
			document: doc,
			throttleMs: 0,
			now: () => Date.now(),
		});

		reconciler.dispose();
		expect(doc.removeEventListener).toHaveBeenCalled();
	});

	it("fires on first visible when tab opens in background (initial hidden)", () => {
		const onReconcile = vi.fn();
		// Tab opened in background — initial state is hidden.
		const doc = createMockDocument("hidden");
		let now = 10000;

		createVisibilityReconciler({
			onReconcile,
			document: doc,
			throttleMs: 0,
			now: () => now++,
		});

		// First time becoming visible — must fire because initial state was hidden.
		doc.simulateChange("visible");
		expect(onReconcile).toHaveBeenCalledTimes(1);
	});
});
