import { BehaviorSubject } from "rxjs";
import { isInteropObservableTrait, SYMBOL_OBSERVABLE } from "../compat";
import type { ReadableSignalTrait, WritableSignalTrait } from "./types";

/**
 * Minimal writable signal implementation.
 * Snapshot-first: values are immutable snapshots, mutations go through `set()`.
 */
export function createSignal<T>(initial: T): WritableSignalTrait<T> {
	const current = new BehaviorSubject(initial);

	return {
		get() {
			return current.getValue();
		},
		set(value: T) {
			current.next(value);
		},
		subscribe(listener: () => void): () => void {
			const subscription = current.subscribe(listener);
			return () => subscription.unsubscribe();
		},
		[SYMBOL_OBSERVABLE]() {
			return current.asObservable();
		},
	};
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
