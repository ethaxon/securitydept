// Browser visibility change adapter — built on fromEventPattern.
//
// Adapts the browser `visibilitychange` event into the SDK's Subscription
// model, built on the foundation fromEventPattern helper.

import { fromEventPattern, type Subscription } from "../scheduling/helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Visibility state snapshot passed to the callback. */
export const VisibilityState = {
	Visible: "visible",
	Hidden: "hidden",
} as const;

export type VisibilityState =
	(typeof VisibilityState)[keyof typeof VisibilityState];

/** Options for {@link fromVisibilityChange}. */
export interface FromVisibilityChangeOptions {
	/**
	 * Callback invoked when the document visibility state changes.
	 *
	 * The callback receives the new visibility state ("visible" or "hidden").
	 */
	callback: (state: VisibilityState) => void;
	/**
	 * Override the document target (primarily for testing).
	 * Defaults to `globalThis.document`.
	 */
	document?: Pick<
		Document,
		"addEventListener" | "removeEventListener" | "visibilityState"
	>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Subscribe to browser document visibility changes.
 *
 * Built on {@link fromEventPattern} so it follows the same Subscription
 * contract. Returns a {@link Subscription} handle for cleanup.
 *
 * @example
 * ```ts
 * const sub = fromVisibilityChange({
 *   callback: (state) => {
 *     if (state === VisibilityState.Visible) {
 *       scheduleRefresh();
 *     }
 *   },
 * });
 * // Cleanup:
 * sub.unsubscribe();
 * ```
 */
export function fromVisibilityChange(
	options: FromVisibilityChangeOptions,
): Subscription {
	const doc = options.document ?? globalThis.document;

	return fromEventPattern<Event>({
		addHandler: (handler) => {
			doc.addEventListener("visibilitychange", handler);
		},
		removeHandler: (handler) => {
			doc.removeEventListener("visibilitychange", handler);
		},
		callback: () => {
			const state: VisibilityState =
				doc.visibilityState === "visible"
					? VisibilityState.Visible
					: VisibilityState.Hidden;
			options.callback(state);
		},
	});
}
