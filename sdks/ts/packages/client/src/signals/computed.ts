import { RxComputedSignal } from "../rx/signal";
import { type ComputedSignalTrait, type SignalOptions } from "./types";

/**
 * Create a lazy computed signal.
 *
 * Dependencies are collected dynamically while `compute()` runs.
 */
export function createComputed<T>(
	compute: () => T,
	options?: SignalOptions<T>,
): ComputedSignalTrait<T> {
	return RxComputedSignal.computed(compute, options);
}
