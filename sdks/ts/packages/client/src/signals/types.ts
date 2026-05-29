// --- Signal trait types ---

import { type CancellationTokenTrait } from "../cancellation/types";
import { type InteropObservableTrait } from "../compat";

/**
 * Read-only signal interface.
 * Semantics align with TC39 Signals proposal, but uses an SDK-owned thin protocol
 * to avoid coupling to any specific polyfill or standard implementation.
 */
export interface ReadableSignalTrait<T> extends InteropObservableTrait<T> {
	/** Return the current snapshot value. */
	get(): T;
	/**
	 * Notify on writes.
	 * The listener is called whenever `set()` publishes a value (not on registration).
	 * @returns An unsubscribe function.
	 */
	notify(listener: () => void): () => void;
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
	extends InteropObservableTrait<T> {
	get(): ReplaySignalSlot<T>;
	notify(listener: () => void): () => void;
	hasValue(): boolean;
	whenValue(options?: ReplaySignalWhenValueOptions): Promise<T>;
}

export interface ComputedReplaySignalTrait<T>
	extends ReadableReplaySignalTrait<T> {}

export interface WritableReplaySignalTrait<T>
	extends ReadableReplaySignalTrait<T> {
	setValue(value: T): void;
}
