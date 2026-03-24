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

	it("should notify subscribers on change", () => {
		const signal = createSignal("a");
		let notified = false;
		signal.subscribe(() => {
			notified = true;
		});
		signal.set("b");
		expect(notified).toBe(true);
	});

	it("should not notify on same value (Object.is)", () => {
		const signal = createSignal(1);
		let count = 0;
		signal.subscribe(() => {
			count++;
		});
		signal.set(1);
		expect(count).toBe(0);
	});

	it("should support unsubscribe", () => {
		const signal = createSignal(0);
		let count = 0;
		const unsub = signal.subscribe(() => {
			count++;
		});
		signal.set(1);
		expect(count).toBe(1);
		unsub();
		signal.set(2);
		expect(count).toBe(1);
	});
});

describe("readonlySignal", () => {
	it("should expose get() but not set()", () => {
		const writable = createSignal(5);
		const ro = readonlySignal(writable);
		expect(ro.get()).toBe(5);
		expect("set" in ro).toBe(false);
	});
});

describe("createComputed", () => {
	it("should derive value from dependencies", () => {
		const a = createSignal(2);
		const b = createSignal(3);
		const sum = createComputed(() => a.get() + b.get(), [a, b]);
		expect(sum.get()).toBe(5);
	});

	it("should update when dependencies change", () => {
		const a = createSignal(1);
		const c = createComputed(() => a.get() * 10, [a]);
		expect(c.get()).toBe(10);
		a.set(3);
		expect(c.get()).toBe(30);
	});

	it("should notify subscribers on change", () => {
		const a = createSignal(1);
		const c = createComputed(() => a.get() + 1, [a]);
		// Lazy: must read first to initialize cached value.
		expect(c.get()).toBe(2);
		let notified = false;
		c.subscribe(() => {
			notified = true;
		});
		a.set(2);
		expect(notified).toBe(true);
		expect(c.get()).toBe(3);
	});
});
