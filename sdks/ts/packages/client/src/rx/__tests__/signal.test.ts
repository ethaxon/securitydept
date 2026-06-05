import { describe, expect, it } from "vitest";
import { RxComputedSignal, RxStateSignal } from "../signal";

describe("@securitydept/client/rx/signal", () => {
	it("dirtyObservable emits dirty events for state writes", () => {
		const signal = RxStateSignal.fromInitialValue(0);
		const events: unknown[] = [];
		const subscription = signal.dirtyObservable().subscribe((event) => {
			events.push(event);
		});

		signal.set(1);
		subscription.unsubscribe();

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ signal });
	});

	it("watchStream does not replay initial value and batches through scheduler", () => {
		const signal = RxStateSignal.fromInitialValue(0);
		const flushes: (() => void)[] = [];
		let count = 0;
		const subscription = signal
			.watchStream({
				schedule(flush) {
					flushes.push(flush);
					return flush;
				},
			})
			.subscribe({
				next() {
					count += 1;
				},
			});

		expect(count).toBe(0);
		signal.set(1);
		signal.set(2);
		expect(count).toBe(0);
		expect(flushes).toHaveLength(1);
		flushes[0]?.();

		expect(count).toBe(1);
		subscription.unsubscribe();
	});

	it("watchStream notifies for equal writes", () => {
		const signal = RxStateSignal.fromInitialValue(1);
		let count = 0;
		const subscription = signal
			.watchStream({
				schedule(flush) {
					flush();
					return undefined;
				},
			})
			.subscribe({
				next() {
					count += 1;
				},
			});

		signal.set(1);
		signal.set(2);
		subscription.unsubscribe();

		expect(count).toBe(2);
	});

	it("computed signals collect dependencies dynamically", () => {
		const useA = RxStateSignal.fromInitialValue(true);
		const a = RxStateSignal.fromInitialValue(1);
		const b = RxStateSignal.fromInitialValue(10);
		const current = RxComputedSignal.computed(() =>
			useA.get() ? a.get() : b.get(),
		);

		expect(current.get()).toBe(1);
		a.set(2);
		expect(current.get()).toBe(2);
		useA.set(false);
		expect(current.get()).toBe(10);
		a.set(3);
		expect(current.get()).toBe(10);
		b.set(11);
		expect(current.get()).toBe(11);
	});

	it("computed dirtyObservable dedupes diamond dependency notifications by epoch", () => {
		const source = RxStateSignal.fromInitialValue(1);
		const left = RxComputedSignal.computed(() => source.get() + 1);
		const right = RxComputedSignal.computed(() => source.get() + 2);
		const diamond = RxComputedSignal.computed(() => left.get() + right.get());
		const events: unknown[] = [];

		expect(diamond.get()).toBe(5);
		const subscription = diamond.dirtyObservable().subscribe((event) => {
			events.push(event);
		});
		source.set(2);
		subscription.unsubscribe();

		expect(events).toHaveLength(1);
	});

	it("computed equals suppresses downstream value changes when dependency value is equal", () => {
		const source = RxStateSignal.fromInitialValue(1);
		const rounded = RxComputedSignal.computed(() => source.get(), {
			equals: (left, right) => Math.floor(left) === Math.floor(right),
		});
		const doubled = RxComputedSignal.computed(() => rounded.get() * 2);

		expect(doubled.get()).toBe(2);
		source.set(1.5);
		expect(doubled.get()).toBe(2);
		source.set(2);
		expect(doubled.get()).toBe(4);
	});
});
