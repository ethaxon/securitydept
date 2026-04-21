import { fromEventPattern, type Subscription } from "../scheduling/helpers";

export interface AbortSignalSource {
	aborted: boolean;
	reason: unknown;
	addEventListener(type: string, listener: EventListener): void;
	removeEventListener(type: string, listener: EventListener): void;
}

export interface FromAbortSignalOptions {
	/** AbortSignal to observe. */
	signal?: AbortSignalSource;
	/** Callback invoked when the signal aborts. */
	callback: (reason: unknown) => void;
	/**
	 * Emit immediately when the signal is already aborted at subscribe time.
	 * Defaults to `false`.
	 */
	emitIfAborted?: boolean;
}

export interface StorageEventTarget {
	addEventListener(type: string, listener: EventListener): void;
	removeEventListener(type: string, listener: EventListener): void;
}

export interface FromStorageEventOptions {
	/**
	 * Storage-event target. Defaults to `globalThis`, which is appropriate for
	 * browser hosts and jsdom-based tests.
	 */
	target?: StorageEventTarget;
	/** Callback invoked for each browser `storage` event. */
	callback: (event: StorageEvent) => void;
}

/**
 * Adapt a browser AbortSignal into the shared Subscription model.
 */
export function fromAbortSignal(options: FromAbortSignalOptions): Subscription {
	const signal = options.signal;
	if (!signal) {
		return {
			unsubscribe() {},
		};
	}

	if (options.emitIfAborted && signal.aborted) {
		options.callback(signal.reason);
	}

	return fromEventPattern<Event>({
		addHandler: (handler) => {
			signal.addEventListener("abort", handler);
		},
		removeHandler: (handler) => {
			signal.removeEventListener("abort", handler);
		},
		callback: () => {
			options.callback(signal.reason);
		},
	});
}

/**
 * Adapt browser `storage` events into the shared Subscription model.
 */
export function fromStorageEvent(
	options: FromStorageEventOptions,
): Subscription {
	const target = options.target ?? (globalThis as StorageEventTarget);

	return fromEventPattern<Event>({
		addHandler: (handler) => {
			target.addEventListener("storage", handler);
		},
		removeHandler: (handler) => {
			target.removeEventListener("storage", handler);
		},
		callback: (event) => {
			options.callback(event as StorageEvent);
		},
	});
}
