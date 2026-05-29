import { describe, expect, it } from "vitest";
import { createCancellationTokenSource } from "../../cancellation/index";
import { ClientErrorKind } from "../../errors/index";
import {
	createAndThenComputedReplaySignal,
	createComputed,
	createComputedReplaySignal,
	createReplaySignal,
	createSignal,
	isReplaySignalTrait,
	readonlyReplaySignal,
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
		signal.notify(() => {
			notified = true;
		});
		signal.set("b");
		expect(notified).toBe(true);
	});

	it("should notify on every set, including same-value writes", () => {
		const signal = createSignal(1);
		let count = 0;
		signal.notify(() => {
			count++;
		});
		signal.set(1);
		expect(count).toBe(1);
	});

	it("should support unsubscribe", () => {
		const signal = createSignal(0);
		let count = 0;
		const unsub = signal.notify(() => {
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

describe("createReplaySignal", () => {
	it("starts empty and emits last available values", async () => {
		const signal = createReplaySignal<string>();
		expect(signal.get()).toEqual({ kind: "empty" });
		expect(signal.hasValue()).toBe(false);

		let notified = 0;
		signal.notify(() => {
			notified += 1;
		});
		signal.setValue("ready");

		expect(notified).toBe(1);
		expect(signal.get()).toEqual({ kind: "value", value: "ready" });
		expect(signal.hasValue()).toBe(true);
		await expect(signal.whenValue()).resolves.toBe("ready");
	});

	it("waits for the first value", async () => {
		const signal = createReplaySignal<string>();
		const pending = signal.whenValue();

		signal.setValue("ready");

		await expect(pending).resolves.toBe("ready");
	});

	it("supports cancelling whenValue while empty", async () => {
		const signal = createReplaySignal<string>();
		const cancellation = createCancellationTokenSource();
		const pending = signal.whenValue({ cancellationToken: cancellation.token });

		cancellation.cancel("stop");

		await expect(pending).rejects.toMatchObject({
			kind: ClientErrorKind.Cancelled,
		});
	});

	it("creates readonly replay signal views", async () => {
		const writable = createReplaySignal<number>();
		const readonly = readonlyReplaySignal(writable);
		writable.setValue(1);

		await expect(readonly.whenValue()).resolves.toBe(1);
		expect("emit" in readonly).toBe(false);
		expect(isReplaySignalTrait(readonly)).toBe(true);
	});
});

describe("createComputedReplaySignal", () => {
	it("stays empty until its replay dependency has a value", async () => {
		const source = createReplaySignal<number>();
		const doubled = createComputedReplaySignal(() => {
			const slot = source.get();
			return slot.kind === "value"
				? { kind: "value", value: slot.value * 2 }
				: { kind: "empty" };
		}, [source]);

		expect(doubled.hasValue()).toBe(false);
		expect(doubled.get()).toEqual({ kind: "empty" });

		source.setValue(21);

		expect(doubled.hasValue()).toBe(true);
		await expect(doubled.whenValue()).resolves.toBe(42);
		expect(isReplaySignalTrait(doubled)).toBe(true);
		expect("emit" in doubled).toBe(false);
	});

	it("notifies subscribers through derived replay updates", () => {
		const source = createReplaySignal<string>();
		const upper = createComputedReplaySignal(() => {
			const slot = source.get();
			return slot.kind === "value"
				? { kind: "value", value: slot.value.toUpperCase() }
				: { kind: "empty" };
		}, [source]);
		let notified = 0;
		upper.notify(() => {
			notified += 1;
		});

		source.setValue("ready");

		expect(notified).toBe(1);
		expect(upper.get()).toEqual({ kind: "value", value: "READY" });
	});
});

describe("createAndThenComputedReplaySignal", () => {
	it("propagates source empty and computes only the value branch", async () => {
		const source = createReplaySignal<number>();
		const doubled = createAndThenComputedReplaySignal(source, (value) => ({
			kind: "value",
			value: value * 2,
		}));

		expect(doubled.get()).toEqual({ kind: "empty" });

		source.setValue(21);

		await expect(doubled.whenValue()).resolves.toBe(42);
	});

	it("allows the value branch to suppress output", async () => {
		const source = createReplaySignal<number>();
		const evenOnly = createAndThenComputedReplaySignal(source, (value) =>
			value % 2 === 0 ? { kind: "value", value } : { kind: "empty" },
		);

		source.setValue(1);
		expect(evenOnly.get()).toEqual({ kind: "empty" });

		source.setValue(2);
		await expect(evenOnly.whenValue()).resolves.toBe(2);
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
		c.notify(() => {
			notified = true;
		});
		a.set(2);
		expect(notified).toBe(true);
		expect(c.get()).toBe(3);
	});
});
