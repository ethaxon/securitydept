import { from } from "rxjs";
import { describe, expect, it } from "vitest";
import {
	createComputed,
	createSignal,
	readonlySignal,
} from "../../signals/index";

describe("createSignal", () => {
	it("should return the initial value", () => {
		const signal = createSignal(42);
		expect(signal.get()).toBe(42);
	});

	it("should update via set()", () => {
		const signal = createSignal(0);
		signal.set(10);
		expect(signal.get()).toBe(10);
	});

	it("should expose the configured equals function", () => {
		const equals = (left: number, right: number) =>
			Math.floor(left) === Math.floor(right);
		const signal = createSignal<number>(1.1, { equals });

		expect(signal.equals).toBe(equals);
		expect(signal.equals(1.1, 1.9)).toBe(true);
	});

	it("should publish invalidations through watchStream", async () => {
		const signal = createSignal("a");
		let notified = false;
		const subscription = signal.watchStream().subscribe({
			next() {
				notified = true;
			},
		});
		signal.set("b");
		await Promise.resolve();
		subscription.unsubscribe();
		expect(notified).toBe(true);
	});

	it("should publish values on every set, including same-value writes", () => {
		const signal = createSignal(1);
		const values: number[] = [];
		const subscription = from(signal).subscribe((value) => {
			values.push(value);
		});
		signal.set(1);
		subscription.unsubscribe();
		expect(values).toEqual([1, 1]);
	});

	it("should support watchStream unsubscribe", async () => {
		const signal = createSignal(0);
		let count = 0;
		const subscription = signal.watchStream().subscribe({
			next() {
				count++;
			},
		});
		signal.set(1);
		await Promise.resolve();
		expect(count).toBe(1);
		subscription.unsubscribe();
		signal.set(2);
		await Promise.resolve();
		expect(count).toBe(1);
	});

	it("should expose watchStream without replaying the current value", () => {
		const signal = createSignal(0);
		let count = 0;
		const subscription = signal.watchStream().subscribe({
			next: () => {
				count += 1;
			},
		});

		expect(count).toBe(0);
		signal.set(1);
		subscription.unsubscribe();
	});

	it("should expose current and future values through observable interop", () => {
		const signal = createSignal("initial");
		const values: string[] = [];
		const subscription = from(signal).subscribe((value) => {
			values.push(value);
		});

		signal.set("next");
		subscription.unsubscribe();

		expect(values).toEqual(["initial", "next"]);
	});
});

describe("readonlySignal", () => {
	it("should expose get() but not set()", () => {
		const writable = createSignal(5);
		const ro = readonlySignal(writable);
		expect(ro.get()).toBe(5);
	});
});

describe("createComputed", () => {
	it("should derive value from dependencies", () => {
		const a = createSignal(2);
		const b = createSignal(3);
		const sum = createComputed(() => a.get() + b.get());
		expect(sum.get()).toBe(5);
	});

	it("should update when dependencies change", () => {
		const a = createSignal(1);
		const c = createComputed(() => a.get() * 10);
		expect(c.get()).toBe(10);
		a.set(3);
		expect(c.get()).toBe(30);
	});

	it("should publish computed watch events on change", async () => {
		const a = createSignal(1);
		const c = createComputed(() => a.get() + 1);
		// Lazy: must read first to initialize cached value.
		expect(c.get()).toBe(2);
		let notified = false;
		const subscription = c.watchStream().subscribe({
			next() {
				notified = true;
			},
		});
		a.set(2);
		await Promise.resolve();
		subscription.unsubscribe();
		expect(notified).toBe(true);
		expect(c.get()).toBe(3);
	});

	it("should expose the configured computed equals function", () => {
		const equals = (left: number, right: number) =>
			Math.floor(left) === Math.floor(right);
		const c = createComputed(() => 1.1, { equals });

		expect(c.equals).toBe(equals);
		expect(c.equals(1.1, 1.9)).toBe(true);
	});
});
