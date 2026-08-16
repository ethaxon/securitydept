import {
	filter,
	from,
	map,
	Observable,
	Subject,
	Subscriber,
	type Subscription,
} from "rxjs";
import { describe, expect, it } from "vitest";
import {
	RxComputedSignal,
	RxSignal,
	type RxSignalDirtyEvent,
	RxStateSignal,
} from "../signal";

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

describe("RxSignal cold and observed transitions", () => {
	it("replays the latest raw value when a previously created observable is subscribed", () => {
		const signal = RxStateSignal.fromInitialValue(
			{ id: 1, label: "old" },
			{
				equals: (a, b) => a.id === b.id,
			},
		);
		const observable = from(signal);
		const latest = { id: 1, label: "latest" };
		signal.set(latest);
		const values: (typeof latest)[] = [];
		const subscription = observable.subscribe((value) => values.push(value));
		signal.set(latest);
		subscription.unsubscribe();
		expect(values).toEqual([latest, latest]);
		expect(signal.get()).toBe(latest);
	});

	it("replays writes made while all value subscribers were detached", () => {
		const signal = RxStateSignal.fromInitialValue(0);
		const observable = from(signal);
		const first: number[] = [];
		const second: number[] = [];
		const a = observable.subscribe((value) => first.push(value));
		const b = observable.subscribe((value) => second.push(value));
		a.unsubscribe();
		signal.set(1);
		b.unsubscribe();
		signal.set(2);
		const c = observable.subscribe((value) => first.push(value));
		signal.set(2);
		c.unsubscribe();
		expect(first).toEqual([0, 2, 2]);
		expect(second).toEqual([0, 1]);
	});

	it("preserves nested writes from an initial replay and from a value callback", () => {
		const signal = RxStateSignal.fromInitialValue(0);
		const values: number[] = [];
		const subscription = from(signal).subscribe((value) => {
			values.push(value);
			if (value < 2) {
				signal.set(value + 1);
			}
		});
		subscription.unsubscribe();
		expect(values).toEqual([0, 1, 2]);
		expect(signal.get()).toBe(2);
	});

	it("retains every equal source write through an equality-disabled computed", () => {
		const source = RxStateSignal.fromInitialValue(1, { equals: () => false });
		let runs = 0;
		const computed = RxComputedSignal.computed(
			() => {
				runs++;
				return source.get() * 2;
			},
			{ equals: () => false },
		);
		const values: number[] = [];
		const subscription = from(computed).subscribe((value) =>
			values.push(value),
		);
		source.set(1);
		source.set(1);
		source.set(2);
		subscription.unsubscribe();
		expect(values).toEqual([2, 2, 2, 4]);
		expect(runs).toBe(4);
	});

	it("preserves raw equal snapshots while suppressing downstream recomputation", () => {
		const source = RxStateSignal.fromInitialValue(
			{ id: 1, label: "old" },
			{
				equals: (a, b) => a.id === b.id,
			},
		);
		let runs = 0;
		const computed = RxComputedSignal.computed(() => {
			runs++;
			return source.get().label;
		});
		expect(computed.get()).toBe("old");
		source.set({ id: 1, label: "new" });
		expect(source.get().label).toBe("new");
		expect(computed.get()).toBe("old");
		expect(runs).toBe(1);
	});

	it("observes the current dependency set after cold recomputations and resubscription", () => {
		const select = RxStateSignal.fromInitialValue(true);
		const a = RxStateSignal.fromInitialValue(1);
		const b = RxStateSignal.fromInitialValue(10);
		const computed = RxComputedSignal.computed(() =>
			select.get() ? a.get() : b.get(),
		);
		for (let i = 0; i < 6; i++) {
			a.set(i);
			expect(computed.get()).toBe(i);
		}
		select.set(false);
		expect(computed.get()).toBe(10);
		const values: number[] = [];
		const observable = from(computed);
		const subscription = observable.subscribe((value) => values.push(value));
		a.set(100);
		b.set(11);
		select.set(true);
		b.set(12);
		a.set(101);
		subscription.unsubscribe();
		select.set(false);
		b.set(13);
		const nextSubscription = observable.subscribe((value) =>
			values.push(value),
		);
		b.set(14);
		nextSubscription.unsubscribe();
		expect(values).toEqual([10, 11, 100, 101, 13, 14]);
	});

	it("supports repeated, reordered, and removed dependencies", () => {
		const mode = RxStateSignal.fromInitialValue(0);
		const a = RxStateSignal.fromInitialValue(1);
		const b = RxStateSignal.fromInitialValue(2);
		const computed = RxComputedSignal.computed(() => {
			if (mode.get() === 0) {
				return a.get() + b.get() + a.get();
			}
			if (mode.get() === 1) {
				return b.get() + a.get() + b.get();
			}
			return 42;
		});
		expect(computed.get()).toBe(4);
		mode.set(1);
		expect(computed.get()).toBe(5);
		a.set(3);
		expect(computed.get()).toBe(7);
		mode.set(2);
		expect(computed.get()).toBe(42);
		a.set(5);
		b.set(6);
		expect(computed.get()).toBe(42);
		mode.set(0);
		expect(computed.get()).toBe(16);
	});

	it("retains dependencies read before a cached computation error and recovers", () => {
		const source = RxStateSignal.fromInitialValue(0);
		const failure = new Error("unavailable");
		let runs = 0;
		const computed = RxComputedSignal.computed(() => {
			runs++;
			const value = source.get();
			if (value === 0) {
				throw failure;
			}
			return value;
		});
		expect(() => computed.get()).toThrow(failure);
		expect(() => computed.get()).toThrow(failure);
		expect(runs).toBe(1);
		source.set(1);
		expect(computed.get()).toBe(1);
		source.set(0);
		expect(() => computed.get()).toThrow(failure);
		source.set(2);
		expect(computed.get()).toBe(2);
	});

	it("keeps a synchronously observed diamond coherent and deduplicated", () => {
		const source = RxStateSignal.fromInitialValue(0);
		const left = RxComputedSignal.computed(() => source.get() + 1);
		const right = RxComputedSignal.computed(() => source.get() + 2);
		const sink = RxComputedSignal.computed(() => left.get() + right.get());
		const values: number[] = [];
		const subscription = from(sink).subscribe((value) => values.push(value));
		source.set(1);
		source.set(2);
		subscription.unsubscribe();
		expect(values).toEqual([3, 5, 7]);
	});

	it("cancels a pending custom watch when the last observer detaches", () => {
		const source = RxStateSignal.fromInitialValue(0);
		let cancelled = 0;
		let calls = 0;
		const subscription = source
			.watchStream({
				schedule: () => 123,
				cancel: (handle) => {
					expect(handle).toBe(123);
					cancelled++;
				},
			})
			.subscribe(() => {
				calls++;
			});
		source.set(1);
		subscription.unsubscribe();
		expect(calls).toBe(0);
		expect(cancelled).toBe(1);
	});
});

it("observes new dependencies when equality attaches the first dirty observer", () => {
	const chooseA = RxStateSignal.fromInitialValue(true);
	const a = RxStateSignal.fromInitialValue(1);
	const b = RxStateSignal.fromInitialValue(10);
	let attach = false;
	let stop: (() => void) | undefined;
	const values: number[] = [];
	const computed: RxComputedSignal<number> = RxComputedSignal.computed(
		() => (chooseA.get() ? a.get() : b.get()),
		{
			equals: (left, right) => {
				if (attach) {
					attach = false;
					const subscription = computed
						.dirtyObservable()
						.subscribe(() => values.push(computed.get()));
					stop = () => subscription.unsubscribe();
				}
				return left === right;
			},
		},
	);
	expect(computed.get()).toBe(1);
	attach = true;
	chooseA.set(false);
	expect(computed.get()).toBe(10);
	b.set(11);
	stop?.();
	expect(values).toEqual([11]);
});

it("keeps a saved dirty observable usable after an unobserved interval", () => {
	const signal = RxStateSignal.fromInitialValue(0);
	const dirty = signal.dirtyObservable();
	let calls = 0;
	const first = dirty.subscribe(() => calls++);
	signal.set(1);
	first.unsubscribe();
	signal.set(2);
	const second = dirty.subscribe(() => calls++);
	expect(calls).toBe(1);
	signal.set(2);
	second.unsubscribe();
	expect(calls).toBe(2);
	expect(signal.get()).toBe(2);
});

// These are observable outcomes of synchronous RxJS delivery, including reentry.
describe("synchronous RxSignal propagation", () => {
	it("commits graph versions before a state value observer reads a cached computed", () => {
		const state = RxStateSignal.fromInitialValue(0);
		const computed = RxComputedSignal.computed(() => state.get() * 10);
		expect(computed.get()).toBe(0);
		const values: number[] = [];
		const subscription = from(state).subscribe(() =>
			values.push(computed.get()),
		);
		state.set(1);
		subscription.unsubscribe();
		expect(values).toEqual([0, 10]);
	});

	it("delivers reentrant state writes in RxJS depth-first observer order", () => {
		const state = RxStateSignal.fromInitialValue(0);
		const order: string[] = [];
		const first = from(state).subscribe((value) => {
			if (!value) {
				return;
			}
			order.push(`A${value}`);
			if (value === 1) {
				state.set(2);
			}
		});
		const second = from(state).subscribe((value) => {
			if (value) {
				order.push(`B${value}`);
			}
		});
		state.set(1);
		first.unsubscribe();
		second.unsubscribe();
		expect(order).toEqual(["A1", "A2", "B2", "B1"]);
	});

	it("observes writes made by the initial computed replay callback", () => {
		const state = RxStateSignal.fromInitialValue(0);
		const computed = RxComputedSignal.computed(() => state.get() * 10);
		const values: number[] = [];
		const subscription = from(computed).subscribe((value) => {
			values.push(value);
			if (value === 0) {
				state.set(1);
			}
		});
		subscription.unsubscribe();
		expect(values).toEqual([0, 10]);
	});

	it("deduplicates each diamond write independently when an observer writes again", () => {
		const state = RxStateSignal.fromInitialValue(0);
		const left = RxComputedSignal.computed(() => state.get() + 1);
		const right = RxComputedSignal.computed(() => state.get() + 2);
		const sink = RxComputedSignal.computed(() => left.get() + right.get());
		const order: string[] = [];
		const first = from(sink).subscribe((value) => {
			if (value === 3) {
				return;
			}
			order.push(`A${value}`);
			if (value === 5) {
				state.set(2);
			}
		});
		const second = from(sink).subscribe((value) => {
			if (value !== 3) {
				order.push(`B${value}`);
			}
		});
		state.set(1);
		first.unsubscribe();
		second.unsubscribe();
		// Match ordinary RxJS: each subscription reads the current snapshot.
		const dirty = new Subject<void>();
		let snapshot = 3;
		const referenceOrder: string[] = [];
		const values = dirty.pipe(map(() => snapshot));
		const referenceFirst = values.subscribe((value) => {
			referenceOrder.push(`A${value}`);
			if (value === 5) {
				snapshot = 7;
				dirty.next();
			}
		});
		const referenceSecond = values.subscribe((value) =>
			referenceOrder.push(`B${value}`),
		);
		snapshot = 5;
		dirty.next();
		referenceFirst.unsubscribe();
		referenceSecond.unsubscribe();
		expect(order).toEqual(referenceOrder);
		expect(order).toEqual(["A5", "A7", "B7", "B7"]);
	});

	it("preserves accepted equal writes on the computed event plane", () => {
		const state = RxStateSignal.fromInitialValue(1);
		let runs = 0;
		const computed = RxComputedSignal.computed(() => {
			runs++;
			return state.get() * 10;
		});
		const values: number[] = [];
		const subscription = from(computed).subscribe((value) =>
			values.push(value),
		);
		state.set(1);
		state.set(1);
		subscription.unsubscribe();
		expect(values).toEqual([10, 10, 10]);
		expect(runs).toBe(1);
	});
});

it("rewires an observed equal-valued intermediate computed to its new sources", () => {
	const select = RxStateSignal.fromInitialValue(true);
	const a = RxStateSignal.fromInitialValue(1);
	const b = RxStateSignal.fromInitialValue(1);
	const child = RxComputedSignal.computed(() =>
		select.get() ? a.get() : b.get(),
	);
	let runs = 0;
	const sink = RxComputedSignal.computed(() => {
		runs++;
		return child.get() * 10;
	});
	const values: number[] = [];
	const subscription = from(sink).subscribe((value) => values.push(value));
	select.set(false);
	a.set(2);
	b.set(2);
	subscription.unsubscribe();
	expect(values).toEqual([10, 10, 20]);
	expect(runs).toBe(2);
});

class ForeignSignal extends RxSignal<number> {
	private value = 0;
	private events = new Subject<RxSignalDirtyEvent<number>>();
	active = 0;
	throwOnListen = false;
	constructor() {
		super(undefined);
	}
	get(): number {
		RxSignal.currentContext?.markDependency(this);
		return this.value;
	}
	validateForEpoch(): void {}
	dirtyObservable(): Observable<RxSignalDirtyEvent<number>> {
		if (this.throwOnListen) {
			throw new Error("Cannot listen");
		}
		return new Observable((observer) => {
			this.active++;
			const subscription = this.events.subscribe(observer);
			return () => {
				this.active--;
				subscription.unsubscribe();
			};
		});
	}
	set(value: number): void {
		this.value = value;
		this.valueEqVersion++;
		const epoch = ++RxSignal.globalEpoch;
		RxSignal.dispatchDirty(epoch, () =>
			this.events.next({ epoch, signal: this }),
		);
	}
	fail(error: unknown): void {
		const previous = this.events;
		this.events = new Subject();
		previous.error(error);
	}
}

it("preserves the observable error protocol of an external RxSignal subclass", () => {
	const source = new ForeignSignal();
	const computed = RxComputedSignal.computed(() => source.get() * 10);
	const values: number[] = [];
	const errors: unknown[] = [];
	const subscription = from(computed).subscribe({
		next: (value) => values.push(value),
		error: (error) => errors.push(error),
	});
	const failure = new Error("Foreign dirty error");
	source.set(1);
	source.fail(failure);
	expect(values).toEqual([0, 10]);
	expect(errors).toEqual([failure]);
	expect(subscription.closed).toBe(true);
	expect(source.active).toBe(0);
});

it("releases already-attached dependencies when a later dirty source cannot attach", () => {
	const first = new ForeignSignal();
	const second = new ForeignSignal();
	second.throwOnListen = true;
	const computed = RxComputedSignal.computed(() => first.get() + second.get());
	const errors: unknown[] = [];
	const failed = computed
		.dirtyObservable()
		.subscribe({ error: (error) => errors.push(error) });
	expect(failed.closed).toBe(true);
	expect(errors).toHaveLength(1);
	expect(first.active).toBe(0);
	second.throwOnListen = false;
	const subscription = computed.dirtyObservable().subscribe();
	expect(first.active).toBe(1);
	subscription.unsubscribe();
	expect(first.active).toBe(0);
	expect(second.active).toBe(0);
});

it("retains two registrations of the same RxJS subscriber", () => {
	const state = RxStateSignal.fromInitialValue(0);
	let calls = 0;
	const observer = new Subscriber({
		next: () => {
			calls++;
		},
		error: () => {},
		complete: () => {},
	});
	const first = state.dirtyObservable().subscribe(observer);
	const second = state.dirtyObservable().subscribe(observer);
	state.set(1);
	first.unsubscribe();
	second.unsubscribe();
	expect(calls).toBe(2);
});

it("allows an error callback to synchronously reconnect to a replaced foreign dirty stream", () => {
	const source = new ForeignSignal();
	const computed = RxComputedSignal.computed(() => source.get() * 10);
	const values: number[] = [];
	let replacement: Subscription | undefined;
	const original = from(computed).subscribe({
		next: (value) => values.push(value),
		error: () => {
			replacement = from(computed).subscribe((value) => values.push(value));
		},
	});
	source.fail(new Error("Replace stream"));
	expect(original.closed).toBe(true);
	expect(source.active).toBe(1);
	source.set(1);
	replacement?.unsubscribe();
	expect(source.active).toBe(0);
	expect(values).toEqual([0, 0, 10]);
});

it("skips a captured dependency listener removed by an earlier synchronous callback", () => {
	const a = RxStateSignal.fromInitialValue(0);
	const b = RxStateSignal.fromInitialValue(10);
	const chooseB = RxStateSignal.fromInitialValue(false);
	const first = a.dirtyObservable().subscribe(() => chooseB.set(true));
	const computed = RxComputedSignal.computed(() =>
		chooseB.get() ? b.get() : a.get(),
	);
	const values: number[] = [];
	const subscription = from(computed).subscribe((value) => values.push(value));
	a.set(1);
	first.unsubscribe();
	subscription.unsubscribe();
	expect(values).toEqual([0, 10]);
});

it("honors a state subclass's public dirtyObservable override", () => {
	class FilteredState extends RxStateSignal<number> {
		constructor() {
			super(0, undefined);
		}
		override dirtyObservable() {
			return super
				.dirtyObservable()
				.pipe(filter((event) => event.signal.get() % 2 === 0));
		}
	}
	const source = new FilteredState();
	const computed = RxComputedSignal.computed(() => source.get() + 1);
	const values: number[] = [];
	const subscription = from(computed).subscribe((value) => values.push(value));
	source.set(1);
	source.set(2);
	source.set(3);
	source.set(4);
	subscription.unsubscribe();
	expect(values).toEqual([1, 3, 5]);
});

it("honors a computed subclass's public dirtyObservable override", () => {
	const source = RxStateSignal.fromInitialValue(0);
	class FilteredComputed extends RxComputedSignal<number> {
		constructor() {
			super(() => source.get() + 1, undefined);
		}
		override dirtyObservable() {
			return super
				.dirtyObservable()
				.pipe(filter((event) => event.signal.get() % 2 === 0));
		}
	}
	const child = new FilteredComputed();
	const computed = RxComputedSignal.computed(() => child.get() * 10);
	const values: number[] = [];
	const subscription = from(computed).subscribe((value) => values.push(value));
	source.set(1);
	source.set(2);
	source.set(3);
	subscription.unsubscribe();
	expect(values).toEqual([10, 20, 40]);
});

it("keeps snapshot reads usable when an observed dependency's dirty plane fails to attach", () => {
	const chooseForeign = RxStateSignal.fromInitialValue(false);
	const local = RxStateSignal.fromInitialValue(0);
	const foreign = new ForeignSignal();
	foreign.throwOnListen = true;
	const computed = RxComputedSignal.computed(() =>
		chooseForeign.get() ? foreign.get() : local.get(),
	);
	const errors: unknown[] = [];
	const subscription = computed
		.dirtyObservable()
		.subscribe({ error: (error) => errors.push(error) });
	chooseForeign.set(true);
	expect(computed.get()).toBe(0);
	expect(errors).toHaveLength(1);
	expect(subscription.closed).toBe(true);
	foreign.set(2);
	expect(computed.get()).toBe(2);
});
