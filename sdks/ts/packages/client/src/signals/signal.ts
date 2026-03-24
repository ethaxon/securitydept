import type { ReadableSignalTrait, WritableSignalTrait } from "./types";

/**
 * Minimal writable signal implementation.
 * Snapshot-first: values are immutable snapshots, mutations go through `set()`.
 */
export function createSignal<T>(initial: T): WritableSignalTrait<T> {
	let current = initial;
	const listeners = new Set<() => void>();

	return {
		get() {
			return current;
		},
		set(value: T) {
			if (Object.is(current, value)) return;
			current = value;
			for (const listener of listeners) {
				listener();
			}
		},
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
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
	};
}
