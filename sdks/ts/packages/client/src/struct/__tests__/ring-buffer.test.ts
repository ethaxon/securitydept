import { describe, expect, it } from "vitest";
import { FixedCapacityRingBuffer } from "../ring-buffer";

describe("FixedCapacityRingBuffer", () => {
	it("preserves insertion order before reaching capacity", () => {
		const buffer = new FixedCapacityRingBuffer<number>(4);

		buffer.append(1);
		buffer.append(2);
		buffer.append(3);

		expect(buffer.size).toBe(3);
		expect(buffer.toArray()).toEqual([1, 2, 3]);
	});

	it("wraps and overwrites the oldest entry at capacity", () => {
		const buffer = new FixedCapacityRingBuffer<number>(3);

		for (const value of [1, 2, 3, 4, 5]) {
			buffer.append(value);
		}

		expect(buffer.size).toBe(3);
		expect(buffer.toArray()).toEqual([3, 4, 5]);
	});

	it("supports capacity one", () => {
		const buffer = new FixedCapacityRingBuffer<string>(1);

		buffer.append("first");
		buffer.append("second");

		expect(buffer.size).toBe(1);
		expect(buffer.toArray()).toEqual(["second"]);
	});

	it("clears entries and can be reused", () => {
		const buffer = new FixedCapacityRingBuffer<object>(2);
		buffer.append({ id: 1 });
		buffer.append({ id: 2 });

		buffer.clear();
		expect(buffer.size).toBe(0);
		expect(buffer.toArray()).toEqual([]);

		const next = { id: 3 };
		buffer.append(next);
		expect(buffer.toArray()).toEqual([next]);
	});
});
