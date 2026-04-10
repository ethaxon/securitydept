// Visibility reconciler — cross-tab / visibility lifecycle hardening baseline
//
// Provides a minimal, composable integration between the browser visibility
// change adapter and the auth material lifecycle. When a tab transitions from
// hidden → visible, the reconciler triggers a user-supplied reconciliation
// callback (e.g. check token freshness, re-validate with server, or sync
// cross-tab state).
//
// This is the SDK-side baseline that real projects (e.g. outposts) can wire
// directly to their mode client's refresh or state-check logic.

import type { Subscription } from "../scheduling/helpers";
import type { FromVisibilityChangeOptions } from "./visibility";
import { fromVisibilityChange, VisibilityState } from "./visibility";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback invoked when the page becomes visible and reconciliation is needed. */
export type ReconcileCallback = () => void | Promise<void>;

/** Options for {@link createVisibilityReconciler}. */
export interface CreateVisibilityReconcilerOptions {
	/**
	 * Called when the document transitions from hidden → visible.
	 * The reconciler only fires on the hidden→visible edge; repeated
	 * visible→visible events are suppressed.
	 */
	onReconcile: ReconcileCallback;

	/**
	 * Minimum interval (ms) between reconciliation triggers.
	 * Prevents rapid-fire reconciliation when the user toggles tabs quickly.
	 * Defaults to 5000ms (5 seconds).
	 */
	throttleMs?: number;

	/**
	 * Override the document target (primarily for testing).
	 * Defaults to `globalThis.document`.
	 */
	document?: FromVisibilityChangeOptions["document"];

	/**
	 * Clock override for testing.
	 */
	now?: () => number;
}

/** Handle returned by {@link createVisibilityReconciler}. */
export interface VisibilityReconciler {
	/** Stop listening for visibility changes. */
	dispose(): void;
	/** Number of times reconciliation has been triggered. */
	readonly reconcileCount: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a visibility reconciler that triggers a callback when the page
 * transitions from hidden → visible.
 *
 * @example
 * ```ts
 * const reconciler = createVisibilityReconciler({
 *   onReconcile: () => {
 *     // Re-check token freshness or sync cross-tab state
 *     if (controller.snapshot?.tokens.accessTokenExpiresAt) {
 *       scheduleRefreshIfExpired();
 *     }
 *   },
 * });
 * // Later:
 * reconciler.dispose();
 * ```
 */
export function createVisibilityReconciler(
	options: CreateVisibilityReconcilerOptions,
): VisibilityReconciler {
	const throttleMs = options.throttleMs ?? 5000;
	const getNow = options.now ?? (() => Date.now());

	let lastReconcileAt = 0;
	let reconcileCount = 0;
	// Initialize from the real document state so that tabs opened in background
	// (initial hidden) will correctly trigger on their first visible transition.
	const doc = options.document ?? globalThis.document;
	let previousState: VisibilityState =
		doc.visibilityState === "visible"
			? VisibilityState.Visible
			: VisibilityState.Hidden;

	const subscription: Subscription = fromVisibilityChange({
		callback: (state) => {
			// Only fire on the hidden → visible edge.
			if (
				state === VisibilityState.Visible &&
				previousState === VisibilityState.Hidden
			) {
				const now = getNow();
				if (now - lastReconcileAt >= throttleMs) {
					lastReconcileAt = now;
					reconcileCount++;
					options.onReconcile();
				}
			}
			previousState = state;
		},
		document: doc,
	});

	return {
		dispose() {
			subscription.unsubscribe();
		},
		get reconcileCount() {
			return reconcileCount;
		},
	};
}
