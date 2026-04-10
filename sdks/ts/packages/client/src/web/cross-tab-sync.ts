// Cross-tab auth state sync — minimal baseline using storage events
//
// Provides a minimal, composable cross-tab sync mechanism for auth state.
// When another tab writes to the auth persistence key (via localStorage),
// this listener detects the change and notifies the current tab so it can
// reconcile its in-memory state.
//
// This is intentionally thin — it uses the browser `storage` event which
// fires on OTHER tabs when localStorage is modified. The reconciliation
// callback is the adopter's responsibility (e.g. re-read from persistence,
// compare with in-memory state, and update).
//
// Architecture boundary:
//   - This module does NOT own the persistence store.
//   - It only listens for cross-tab mutations and notifies via callback.
//   - The adopter wires this to their AuthMaterialController.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback invoked when a cross-tab storage change is detected for the watched key. */
export type CrossTabSyncCallback = (event: {
	/** The new value written by the other tab, or null if the key was removed. */
	newValue: string | null;
	/** The old value before the other tab's write. */
	oldValue: string | null;
}) => void;

/** Options for {@link createCrossTabSync}. */
export interface CreateCrossTabSyncOptions {
	/** The localStorage key to watch for cross-tab changes. */
	key: string;

	/** Called when another tab modifies the watched key. */
	onSync: CrossTabSyncCallback;

	/**
	 * Override the window target (primarily for testing).
	 * Defaults to `globalThis`.
	 */
	target?: {
		addEventListener(type: string, listener: EventListener): void;
		removeEventListener(type: string, listener: EventListener): void;
	};
}

/** Handle returned by {@link createCrossTabSync}. */
export interface CrossTabSync {
	/** Stop listening for cross-tab storage events. */
	dispose(): void;
	/** Number of times a sync event has been received. */
	readonly syncCount: number;
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
 * const sync = createCrossTabSync({
 *   key: "auth:v1",
 *   onSync: ({ newValue }) => {
 *     if (newValue) {
 *       // Another tab updated auth state — reconcile
 *       controller.restoreFromPersistence();
 *     } else {
 *       // Another tab cleared auth state — log out
 *       controller.clearState({ clearPersisted: false });
 *     }
 *   },
 * });
 * // Later:
 * sync.dispose();
 * ```
 */
export function createCrossTabSync(
	options: CreateCrossTabSyncOptions,
): CrossTabSync {
	const target = options.target ?? globalThis;
	let syncCount = 0;

	function handleStorageEvent(event: Event): void {
		const storageEvent = event as StorageEvent;
		// Only react to changes on our watched key.
		if (storageEvent.key !== options.key) return;
		syncCount++;
		options.onSync({
			newValue: storageEvent.newValue,
			oldValue: storageEvent.oldValue,
		});
	}

	target.addEventListener("storage", handleStorageEvent as EventListener);

	return {
		dispose() {
			target.removeEventListener(
				"storage",
				handleStorageEvent as EventListener,
			);
		},
		get syncCount() {
			return syncCount;
		},
	};
}
