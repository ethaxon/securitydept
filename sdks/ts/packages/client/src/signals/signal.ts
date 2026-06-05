import { SYMBOL_OBSERVABLE } from "../compat";
import { RxStateSignal } from "../rx/signal";
import {
	type ReadableSignalTrait,
	type SignalOptions,
	type WritableSignalTrait,
} from "./types";

/**
 * Minimal writable signal implementation.
 * `set()` always publishes a write. Equality-based value-version suppression is
 * handled by the underlying Rx signal for computed dependency validation.
 */
export function createSignal<T>(
	initial: T,
	options?: SignalOptions<T>,
): WritableSignalTrait<T> {
	return RxStateSignal.fromInitialValue(initial, options);
}

/**
 * Create a read-only view of a writable signal.
 */
export function readonlySignal<T>(
	signal: WritableSignalTrait<T>,
): ReadableSignalTrait<T> {
	return signal;
}

export function isSignalTrait<T>(obj: unknown): obj is ReadableSignalTrait<T> {
	return (
		typeof obj === "object" &&
		obj !== null &&
		typeof (obj as ReadableSignalTrait<T>).equals === "function" &&
		typeof (obj as ReadableSignalTrait<T>).get === "function" &&
		typeof (obj as ReadableSignalTrait<T>).watchStream === "function" &&
		typeof (obj as ReadableSignalTrait<T>)[SYMBOL_OBSERVABLE] === "function"
	);
}
