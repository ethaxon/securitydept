import { BehaviorSubject } from "rxjs";
import { isInteropObservableTrait, SYMBOL_OBSERVABLE } from "../compat";
import { behaviorSubjectToSignal } from "../rx/interop";
import { type ReadableSignalTrait, type WritableSignalTrait } from "./types";

/**
 * Minimal writable signal implementation.
 * `set()` always publishes a write. Equality-based suppression belongs in
 * higher-level operators, not in the base signal primitive.
 */
export function createSignal<T>(initial: T): WritableSignalTrait<T> {
	return behaviorSubjectToSignal(() => new BehaviorSubject(initial));
}

/**
 * Create a read-only view of a writable signal.
 */
export function readonlySignal<T>(
	signal: WritableSignalTrait<T>,
): ReadableSignalTrait<T> {
	return {
		get: () => signal.get(),
		subscribe: (listener) => signal.subscribe(listener),
		[SYMBOL_OBSERVABLE]: () => signal[SYMBOL_OBSERVABLE](),
	};
}

export function isSignalTrait<T>(obj: unknown): obj is ReadableSignalTrait<T> {
	return (
		typeof obj === "object" &&
		obj !== null &&
		typeof (obj as ReadableSignalTrait<T>).get === "function" &&
		typeof (obj as ReadableSignalTrait<T>).subscribe === "function" &&
		isInteropObservableTrait(obj)
	);
}
