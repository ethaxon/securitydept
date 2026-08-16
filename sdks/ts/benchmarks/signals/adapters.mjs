import * as preact from "@preact/signals-core";
import * as alien from "alien-signals";
import { from } from "rxjs";
import { Signal } from "signal-polyfill";

// Deliberately expose the same get/set shape; wrapper overhead is included.
export async function createAdapter(name, rxModule) {
	if (name === "baseline" || name === "working") {
		const { RxStateSignal, RxComputedSignal } = await import(rxModule);
		return {
			state: (value, options) => RxStateSignal.fromInitialValue(value, options),
			computed: (fn, options) => RxComputedSignal.computed(fn, options),
			observe(signal, callback, mode, schedule) {
				const observable =
					mode === "rx" ? from(signal) : signal.watchStream({ schedule });
				const subscription = observable.subscribe(() => callback(signal.get()));
				return () => subscription.unsubscribe();
			},
			rx: true,
		};
	}
	if (name === "alien") {
		return {
			state(value) {
				const signal = alien.signal(value);
				return { get: () => signal(), set: (next) => signal(next) };
			},
			computed(fn) {
				const signal = alien.computed(fn);
				return { get: () => signal() };
			},
			observe: (signal, callback) => alien.effect(() => callback(signal.get())),
		};
	}
	if (name === "preact") {
		return {
			state(value) {
				const signal = preact.signal(value);
				return {
					get: () => signal.value,
					set: (next) => {
						signal.value = next;
					},
				};
			},
			computed(fn) {
				const signal = preact.computed(fn);
				return { get: () => signal.value };
			},
			observe: (signal, callback) =>
				preact.effect(() => callback(signal.get())),
		};
	}
	if (name === "polyfill") {
		return {
			state: (value) => new Signal.State(value),
			computed: (fn) => new Signal.Computed(fn),
		};
	}
	throw new Error(`Unknown adapter: ${name}`);
}
