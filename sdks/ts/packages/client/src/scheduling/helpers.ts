// Scheduling helpers — foundation-owned convenience over raw Scheduler.
//
// These helpers sit above the injectable Scheduler / Clock and provide
// reusable, cancelable wrappers for common scheduling patterns.

import type { CancelableHandle, Clock, Scheduler } from "./types";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Subscription handle returned by input-source adapters. */
export interface Subscription {
	/** Unsubscribe and release resources. */
	unsubscribe(): void;
}

// ---------------------------------------------------------------------------
// timer
// ---------------------------------------------------------------------------

/** Options for {@link timer}. */
export interface TimerOptions {
	/** Scheduler to use (platform default if omitted). */
	scheduler: Scheduler;
	/** Delay in milliseconds. */
	delayMs: number;
	/** Callback to invoke after the delay. */
	callback: () => void;
}

/**
 * Schedule a one-shot callback after a delay.
 *
 * Returns a {@link CancelableHandle} that can cancel the pending timer.
 *
 * @example
 * ```ts
 * const handle = timer({
 *   scheduler: runtime.scheduler,
 *   delayMs: 5000,
 *   callback: () => console.log("fired"),
 * });
 * // Cancel before it fires:
 * handle.cancel();
 * ```
 */
export function timer(options: TimerOptions): CancelableHandle {
	return options.scheduler.setTimeout(options.delayMs, options.callback);
}

// ---------------------------------------------------------------------------
// interval
// ---------------------------------------------------------------------------

/** Options for {@link interval}. */
export interface IntervalOptions {
	/** Scheduler to use. */
	scheduler: Scheduler;
	/** Interval period in milliseconds. */
	periodMs: number;
	/** Callback to invoke on each tick. */
	callback: () => void;
}

/**
 * Schedule a repeating callback at a fixed interval.
 *
 * Built on top of `Scheduler.setTimeout` so it works with deterministic
 * test schedulers. Returns a {@link CancelableHandle} to stop the interval.
 *
 * @example
 * ```ts
 * const handle = interval({
 *   scheduler: runtime.scheduler,
 *   periodMs: 30_000,
 *   callback: () => refreshTokens(),
 * });
 * // Stop:
 * handle.cancel();
 * ```
 */
export function interval(options: IntervalOptions): CancelableHandle {
	let canceled = false;
	let currentHandle: CancelableHandle | null = null;

	function tick(): void {
		if (canceled) return;
		options.callback();
		scheduleNext();
	}

	function scheduleNext(): void {
		if (canceled) return;
		currentHandle = options.scheduler.setTimeout(options.periodMs, tick);
	}

	// Start the first tick.
	scheduleNext();

	return {
		cancel() {
			canceled = true;
			currentHandle?.cancel();
			currentHandle = null;
		},
	};
}

// ---------------------------------------------------------------------------
// scheduleAt
// ---------------------------------------------------------------------------

/** Options for {@link scheduleAt}. */
export interface ScheduleAtOptions {
	/** Scheduler to use. */
	scheduler: Scheduler;
	/** Clock to use for computing the delay. */
	clock: Clock;
	/** Target epoch milliseconds at which the callback should fire. */
	atMs: number;
	/** Callback to invoke at (or after) the target time. */
	callback: () => void;
}

/**
 * Schedule a callback at a specific wall-clock time.
 *
 * Computes the delay from `clock.now()` to `atMs` and delegates to
 * `Scheduler.setTimeout`. If the target time is already in the past,
 * the callback fires on the next scheduler tick (delay 0).
 *
 * @example
 * ```ts
 * const handle = scheduleAt({
 *   scheduler: runtime.scheduler,
 *   clock: runtime.clock,
 *   atMs: tokenExpiresAtMs - 30_000,
 *   callback: () => refreshToken(),
 * });
 * ```
 */
export function scheduleAt(options: ScheduleAtOptions): CancelableHandle {
	const delay = Math.max(0, options.atMs - options.clock.now());
	return options.scheduler.setTimeout(delay, options.callback);
}

// ---------------------------------------------------------------------------
// fromEventPattern
// ---------------------------------------------------------------------------

/** Options for {@link fromEventPattern}. */
export interface FromEventPatternOptions<T> {
	/**
	 * Called to install the event listener. Should return whatever handle
	 * is needed by `removeHandler` to unsubscribe.
	 */
	addHandler: (handler: (value: T) => void) => void;
	/**
	 * Called to uninstall the event listener.
	 */
	removeHandler: (handler: (value: T) => void) => void;
	/** Callback invoked each time the event fires. */
	callback: (value: T) => void;
}

/**
 * Adapt an arbitrary add/remove event pattern into a {@link Subscription}.
 *
 * This is a thin bridge between imperative event APIs (e.g. `addEventListener`
 * / `removeEventListener`) and the SDK's subscription model.
 *
 * @example
 * ```ts
 * const sub = fromEventPattern<Event>({
 *   addHandler: (h) => document.addEventListener("visibilitychange", h),
 *   removeHandler: (h) => document.removeEventListener("visibilitychange", h),
 *   callback: () => onVisibilityChange(),
 * });
 * // Cleanup:
 * sub.unsubscribe();
 * ```
 */
export function fromEventPattern<T>(
	options: FromEventPatternOptions<T>,
): Subscription {
	const handler = (value: T): void => {
		options.callback(value);
	};
	options.addHandler(handler);
	return {
		unsubscribe() {
			options.removeHandler(handler);
		},
	};
}
