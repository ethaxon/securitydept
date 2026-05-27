import { Observable, Subject } from "rxjs";
import { SYMBOL_OBSERVABLE } from "../compat";
import { type ComputedSignalTrait, type ReadableSignalTrait } from "./types";

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
	const changes = new Subject<void>();

	const markDirty = () => {
		if (!dirty) {
			dirty = true;
			changes.next();
		}
	};

	// Dependency subscriptions are permanent.
	for (const dep of deps) {
		dep.subscribe(markDirty);
	}

	const signal = {
		get() {
			if (dirty) {
				cached = compute();
				dirty = false;
			}
			return cached as T;
		},
		subscribe(listener: () => void): () => void {
			const subscription = changes.subscribe(() => {
				listener();
			});
			return () => {
				subscription.unsubscribe();
			};
		},
	};

	return Object.assign(signal, {
		[SYMBOL_OBSERVABLE]() {
			return new Observable<T>((subscriber) => {
				subscriber.next(signal.get());
				const unsubscribe = signal.subscribe(() => {
					subscriber.next(signal.get());
				});
				return () => {
					unsubscribe();
					subscriber.complete();
				};
			});
		},
	});
}
