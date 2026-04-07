// @vitest-environment jsdom
// Browser visibility change adapter — focused tests
//
// Tests for fromVisibilityChange adapter.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fromVisibilityChange, VisibilityState } from "../visibility";

describe("fromVisibilityChange", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("subscribes to visibilitychange events", () => {
		const callback = vi.fn();
		const addSpy = vi.fn();
		const removeSpy = vi.fn();

		const mockDoc = {
			addEventListener: addSpy,
			removeEventListener: removeSpy,
			visibilityState: "visible" as DocumentVisibilityState,
		};

		fromVisibilityChange({ callback, document: mockDoc });

		expect(addSpy).toHaveBeenCalledWith(
			"visibilitychange",
			expect.any(Function),
		);
	});

	it("invokes callback with VisibilityState.Visible when document becomes visible", () => {
		const callback = vi.fn();
		let handler: (() => void) | undefined;

		const mockDoc = {
			addEventListener: (_type: string, h: EventListener) => {
				handler = h as () => void;
			},
			removeEventListener: vi.fn(),
			visibilityState: "visible" as DocumentVisibilityState,
		};

		fromVisibilityChange({ callback, document: mockDoc });

		// Simulate visibility change to visible.
		handler?.();
		expect(callback).toHaveBeenCalledWith(VisibilityState.Visible);
	});

	it("invokes callback with VisibilityState.Hidden when document becomes hidden", () => {
		const callback = vi.fn();
		let handler: (() => void) | undefined;

		const mockDoc = {
			addEventListener: (_type: string, h: EventListener) => {
				handler = h as () => void;
			},
			removeEventListener: vi.fn(),
			visibilityState: "hidden" as DocumentVisibilityState,
		};

		fromVisibilityChange({ callback, document: mockDoc });

		handler?.();
		expect(callback).toHaveBeenCalledWith(VisibilityState.Hidden);
	});

	it("removes listener on unsubscribe", () => {
		const callback = vi.fn();
		const removeSpy = vi.fn();

		const mockDoc = {
			addEventListener: vi.fn(),
			removeEventListener: removeSpy,
			visibilityState: "visible" as DocumentVisibilityState,
		};

		const sub = fromVisibilityChange({ callback, document: mockDoc });
		sub.unsubscribe();

		expect(removeSpy).toHaveBeenCalledWith(
			"visibilitychange",
			expect.any(Function),
		);
	});

	it("VisibilityState constants match expected values", () => {
		expect(VisibilityState.Visible).toBe("visible");
		expect(VisibilityState.Hidden).toBe("hidden");
	});
});
