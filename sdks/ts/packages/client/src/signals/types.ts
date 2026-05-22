// --- Signal trait types ---

import type { CancellationTokenTrait } from "../cancellation/types";

/**
 * Read-only signal interface.
 * Semantics align with TC39 Signals proposal, but uses an SDK-owned thin protocol
 * to avoid coupling to any specific polyfill or standard implementation.
 */
export interface ReadableSignalTrait<T> {
	/** Return the current snapshot value. */
	get(): T;
	/**
	 * Subscribe to value changes.
	 * The listener is called whenever the value changes (not on subscribe).
	 * @returns An unsubscribe function.
	 */
	subscribe(listener: () => void): () => void;
}

/**
 * Writable signal interface.
 * State transitions should be controlled by the client / service layer;
 * external consumers typically only see the read-only projection.
 */
export interface WritableSignalTrait<T> extends ReadableSignalTrait<T> {
	set(value: T): void;
}

/**
 * Computed (derived) signal — always read-only, value is derived from
 * other signals automatically.
 */
export interface ComputedSignalTrait<T> extends ReadableSignalTrait<T> {}

export type ReplaySignalSlot<T> =
	| { kind: "empty" }
	| { kind: "value"; value: T };

export interface ReplaySignalWhenValueOptions {
	cancellationToken?: CancellationTokenTrait;
}

export interface ReadableReplaySignalTrait<T>
	extends ReadableSignalTrait<ReplaySignalSlot<T>> {
	hasValue(): boolean;
	whenValue(options?: ReplaySignalWhenValueOptions): Promise<T>;
}

export interface ComputedReplaySignalTrait<T>
	extends ReadableReplaySignalTrait<T> {}

export interface WritableReplaySignalTrait<T>
	extends ReadableReplaySignalTrait<T> {
	emit(value: T): void;
	clear(): void;
}
