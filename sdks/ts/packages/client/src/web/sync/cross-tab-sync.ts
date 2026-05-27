import { filter, map } from "rxjs";
import { type EventStreamTrait } from "../../events";
import { eventStreamToObservable, observableToEventStream } from "../../rx";
import {
	fromStorageEvent,
	type StorageEventTarget,
} from "../events/from-storage";

// Cross-tab auth state sync — minimal baseline using storage events
//
// Provides a minimal, composable cross-tab sync mechanism for auth state.
// When another tab writes to the auth persistence key (via localStorage),
// this listener detects the change and notifies the current tab so it can
// reconcile its in-memory state.
//
// This is intentionally thin — it adapts the browser `storage` event into an
// event stream. The reconciliation subscriber is the adopter's responsibility
// (e.g. re-read from persistence, compare with in-memory state, and update).
//
// Architecture boundary:
//   - This module does NOT own the persistence store.
//   - It only publishes cross-tab mutations as a stream.
//   - The adopter wires this to their auth state owner.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event emitted when a cross-tab storage change is detected for the watched key. */
export interface CrossTabSyncEvent {
	/** The new value written by the other tab, or null if the key was removed. */
	newValue: string | null;
	/** The old value before the other tab's write. */
	oldValue: string | null;
}

/** Options for {@link createCrossTabSync}. */
export interface CreateCrossTabSyncOptions {
	/** The localStorage key to watch for cross-tab changes. */
	key: string;

	storageEventTarget: StorageEventTarget;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a cross-tab sync listener for a specific localStorage key.
 *
 * The browser `storage` event fires on ALL tabs EXCEPT the one that made the
 * change. This makes it a natural primitive for cross-tab state notification.
 *
 * @example
 * ```ts
 * const subscription = createCrossTabSync({
 *   key: "auth:v1",
 *   storageEventTarget: window,
 * }).subscribe({
 *   next: ({ newValue }) => {
 *     if (newValue) {
 *       // Another tab updated auth state — reconcile
 *       client.restorePersistedState();
 *     } else {
 *       // Another tab cleared auth state — log out
 *       controller.clearState({ persistPolicy: "skip" });
 *     }
 *   },
 * });
 * // Later:
 * subscription.unsubscribe();
 * ```
 */
export function createCrossTabSync(
	options: CreateCrossTabSyncOptions,
): EventStreamTrait<CrossTabSyncEvent> {
	return observableToEventStream(
		eventStreamToObservable(
			fromStorageEvent({
				storageEventTarget: options.storageEventTarget,
			}),
		).pipe(
			filter((storageEvent) => storageEvent.key === options.key),
			map((storageEvent) => ({
				newValue: storageEvent.newValue,
				oldValue: storageEvent.oldValue,
			})),
		),
	);
}
