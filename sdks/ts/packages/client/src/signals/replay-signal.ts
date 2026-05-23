import { BehaviorSubject, filter, map, type Subscription } from "rxjs";
import { isInteropObservableTrait, SYMBOL_OBSERVABLE } from "../compat";
import { createEventStream } from "../events";
import type {
	ComputedReplaySignalTrait,
	ReadableReplaySignalTrait,
	ReadableSignalTrait,
	ReplaySignalSlot,
	WritableReplaySignalTrait,
} from "./types";

const EMPTY_REPLAY_SIGNAL_SLOT = { kind: "empty" } as const;

export function createReplaySignal<T>(): WritableReplaySignalTrait<T> {
	const subject = new BehaviorSubject<ReplaySignalSlot<T>>(
		EMPTY_REPLAY_SIGNAL_SLOT,
	);

	return {
		get: () => subject.getValue(),
		subscribe: (listener) => {
			const unsubscribe = subject.subscribe(listener);
			return () => unsubscribe.unsubscribe();
		},
		hasValue: () => subject.getValue().kind === "value",
		whenValue: (options) => {
			const slot = subject.getValue();
			if (slot.kind === "value") {
				return Promise.resolve(slot.value);
			}

			const cancellationToken = options?.cancellationToken;
			if (cancellationToken?.isCancellationRequested) {
				return Promise.reject(readCancellationError(cancellationToken));
			}

			return new Promise<T>((resolve, reject) => {
				let subscription: Subscription | undefined;
				let disposeCancellation: (() => void) | undefined;

				const cleanup = () => {
					subscription?.unsubscribe();
					subscription = undefined;
					disposeCancellation?.();
					disposeCancellation = undefined;
				};

				const resolveIfValue = () => {
					const nextSlot = subject.getValue();
					if (nextSlot.kind === "value") {
						cleanup();
						resolve(nextSlot.value);
					}
				};

				subscription = subject.subscribe(resolveIfValue);
				disposeCancellation = cancellationToken?.onCancellationRequested(() => {
					cleanup();
					reject(readCancellationError(cancellationToken));
				})[Symbol.dispose];
				resolveIfValue();
			});
		},
		[SYMBOL_OBSERVABLE]: () => {
			return subject.pipe(
				filter(
					(slot): slot is { kind: "value"; value: T } => slot.kind === "value",
				),
				map((slot) => slot.value),
			);
		},
		setValue(value) {
			subject.next({ kind: "value", value });
		},
	};
}

export function readonlyReplaySignal<T>(
	signal: WritableReplaySignalTrait<T>,
): ReadableReplaySignalTrait<T> {
	return {
		get: () => signal.get(),
		subscribe: (listener) => signal.subscribe(listener),
		hasValue: () => signal.hasValue(),
		whenValue: (options) => signal.whenValue(options),
		[SYMBOL_OBSERVABLE]: () => signal[SYMBOL_OBSERVABLE](),
	};
}

export function createComputedReplaySignal<T>(
	compute: () => ReplaySignalSlot<T>,
	deps: ReadableSignalTrait<unknown>[],
): ComputedReplaySignalTrait<T> {
	let cached: ReplaySignalSlot<T> | undefined;
	let dirty = true;
	const listeners = new Set<() => void>();

	const markDirty = () => {
		dirty = true;
		for (const listener of listeners) {
			listener();
		}
	};

	for (const dep of deps) {
		dep.subscribe(markDirty);
	}

	return createReadableReplaySignalView({
		get() {
			if (dirty) {
				cached = compute();
				dirty = false;
			}
			return cached ?? { kind: "empty" };
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	});
}

export function createAndThenComputedReplaySignal<T, U>(
	source: ReadableReplaySignalTrait<T>,
	computeValue: (value: T) => ReplaySignalSlot<U>,
): ComputedReplaySignalTrait<U> {
	return createComputedReplaySignal(() => {
		const slot = source.get();
		return slot.kind === "value" ? computeValue(slot.value) : { kind: "empty" };
	}, [source]);
}

function createReadableReplaySignalView<T>(
	signalLike: Omit<
		ReadableSignalTrait<ReplaySignalSlot<T>>,
		typeof Symbol.observable
	>,
): ReadableReplaySignalTrait<T> {
	const signal: Omit<ReadableReplaySignalTrait<T>, typeof Symbol.observable> = {
		get: () => signalLike.get(),
		subscribe: (listener) => signalLike.subscribe(listener),
		hasValue: () => signalLike.get().kind === "value",
		whenValue: (options) => {
			const slot = signalLike.get();
			if (slot.kind === "value") {
				return Promise.resolve(slot.value);
			}

			const cancellationToken = options?.cancellationToken;
			if (cancellationToken?.isCancellationRequested) {
				return Promise.reject(readCancellationError(cancellationToken));
			}

			return new Promise<T>((resolve, reject) => {
				let unsubscribe: (() => void) | undefined;
				let disposeCancellation: (() => void) | undefined;

				const cleanup = () => {
					unsubscribe?.();
					unsubscribe = undefined;
					disposeCancellation?.();
					disposeCancellation = undefined;
				};

				const resolveIfValue = () => {
					const nextSlot = signalLike.get();
					if (nextSlot.kind === "value") {
						cleanup();
						resolve(nextSlot.value);
					}
				};

				unsubscribe = signalLike.subscribe(resolveIfValue);
				disposeCancellation = cancellationToken?.onCancellationRequested(() => {
					cleanup();
					reject(readCancellationError(cancellationToken));
				})[Symbol.dispose];
				resolveIfValue();
			});
		},
	};

	return Object.assign(signal, {
		[SYMBOL_OBSERVABLE]: () => {
			return createEventStream((observer) => {
				const ifPresentEmit = () => {
					const slot = signalLike.get();
					if (slot.kind === "value") {
						observer.next(slot.value);
					}
				};
				ifPresentEmit();
				const unsubscribe = signalLike.subscribe(() => {
					ifPresentEmit();
				});
				return () => {
					unsubscribe();
					observer.complete();
				};
			});
		},
	});
}

function readCancellationError(cancellationToken: {
	throwIfCancellationRequested(): void;
	reason?: unknown;
}): unknown {
	try {
		cancellationToken.throwIfCancellationRequested();
	} catch (error) {
		return error;
	}
	return cancellationToken.reason;
}

export function isReplaySignalTrait<T>(
	value: unknown,
): value is ReadableReplaySignalTrait<T> {
	return (
		typeof value === "object" &&
		value !== null &&
		"get" in value &&
		typeof value.get === "function" &&
		"subscribe" in value &&
		typeof value.subscribe === "function" &&
		"hasValue" in value &&
		typeof value.hasValue === "function" &&
		"whenValue" in value &&
		typeof value.whenValue === "function" &&
		isInteropObservableTrait(value)
	);
}
