import { describe, expect, it, vi } from "vitest";
import { createTimeForStd } from "../time";

describe("createTimeForStd", () => {
	it("adapts explicit std host time primitives", () => {
		const scheduled = vi.fn((_handler: () => void, _delayMs: number) => 123);
		const cleared = vi.fn((handle: unknown) => handle);
		const time = createTimeForStd({
			host: {
				Date: { now: () => 42 },
				setTimeout: scheduled,
				clearTimeout: cleared,
			},
		});

		expect(time.now()).toBe(42);
		expect(time.setTimeout(() => {}, 5)).toBe(123);
		time.clearTimeout(123);

		expect(scheduled).toHaveBeenCalledOnce();
		expect(cleared).toHaveBeenCalledWith(123);
	});

	it("rejects incomplete std hosts", () => {
		expect(() =>
			createTimeForStd({
				host: {
					Date: { now: () => 42 },
					setTimeout: undefined as never,
					clearTimeout: globalThis.clearTimeout,
				},
			}),
		).toThrow(/createTimeForStd could not validate timeForStdCreateOptions/);
	});
});
