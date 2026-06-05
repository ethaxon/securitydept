// --- Signal trait types ---

import { type CancellationTokenTrait } from "../cancellation/types";
import { type DisposableTrait, type InteropObservableTrait } from "../compat";
import { type EventStreamTrait } from "../events/types";

export interface SignalOptions<T> {
	equals?: (a: T, b: T) => boolean;
}

/**
 * Read-only signal interface.
 * Semantics align with TC39 Signals proposal, but uses an SDK-owned thin protocol
 * to avoid coupling to any specific polyfill or standard implementation.
 */
export interface ReadableSignalTrait<T> extends InteropObservableTrait<T> {
	readonly equals: (a: unknown, b: unknown) => boolean;
	/** Return the current snapshot value. */
	get(): T;
	/**
	 * Watch value invalidations.
	 * The stream does not emit the current value on subscription; use
	 * `[SYMBOL_OBSERVABLE]()` when value replay is required.
	 */
	watchStream(): EventStreamTrait<void>;
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

export const ResourceStatus = {
	Idle: "idle",
	Loading: "loading",
	LoadingError: "loading_error",
	Reloading: "reloading",
	Resolved: "resolved",
	Error: "error",
} as const;

export type ResourceStatus =
	(typeof ResourceStatus)[keyof typeof ResourceStatus];

export interface ResourceIdleSnapshot {
	readonly status: typeof ResourceStatus.Idle;
}

export interface ResourceLoadingSnapshot {
	readonly status: typeof ResourceStatus.Loading;
}

export interface ResourceLoadingErrorSnapshot {
	readonly status: typeof ResourceStatus.LoadingError;
	readonly error: unknown;
}

export interface ResourceReloadingSnapshot<T> {
	readonly status: typeof ResourceStatus.Reloading;
	readonly value: T;
}

export interface ResourceResolvedSnapshot<T> {
	readonly status: typeof ResourceStatus.Resolved;
	readonly value: T;
}

export interface ResourceErrorSnapshot<T> {
	readonly status: typeof ResourceStatus.Error;
	readonly value: T;
	readonly error: unknown;
}

export type ResourceSnapshot<T> =
	| ResourceIdleSnapshot
	| ResourceLoadingSnapshot
	| ResourceLoadingErrorSnapshot
	| ResourceReloadingSnapshot<T>
	| ResourceResolvedSnapshot<T>
	| ResourceErrorSnapshot<T>;

export interface ResourceWhenValueOptions {
	cancellationToken?: CancellationTokenTrait;
}

export interface ResourceTrait<T>
	extends DisposableTrait,
		InteropObservableTrait<ResourceSnapshot<T>> {
	readonly value: ReadableSignalTrait<T>;
	readonly status: ReadableSignalTrait<ResourceStatus>;
	readonly error: ReadableSignalTrait<unknown | undefined>;
	readonly isLoading: ReadableSignalTrait<boolean>;
	readonly snapshot: ReadableSignalTrait<ResourceSnapshot<T>>;
	hasValue(): boolean;
	whenValue(options?: ResourceWhenValueOptions): Promise<T>;
}
