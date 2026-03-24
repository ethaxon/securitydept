import type { ComputedSignalTrait, ReadableSignalTrait } from "./types";

/**
 * Create a computed signal that derives its value from other signals.
 *
 * Semantics: lazy + cached.
 * - The compute function is NOT called at construction time.
 * - `get()` recomputes only when dirty (a dependency changed since last read).
 * - Subscribers are notified only when a dependency changes (dirty-flagged),
 *   and the next `get()` will produce the fresh value.
 *
 * Dependency subscriptions are permanent for the lifetime of the computed signal.
 */
export function createComputed<T>(
	compute: () => T,
	deps: ReadableSignalTrait<unknown>[],
): ComputedSignalTrait<T> {
	let cached: T | undefined;
	let dirty = true;
	const listeners = new Set<() => void>();

	const markDirty = () => {
		if (!dirty) {
			dirty = true;
			for (const listener of listeners) {
				listener();
			}
		}
	};

	// Dependency subscriptions are permanent.
	for (const dep of deps) {
		dep.subscribe(markDirty);
	}

	return {
		get() {
			if (dirty) {
				cached = compute();
				dirty = false;
			}
			return cached as T;
		},
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
