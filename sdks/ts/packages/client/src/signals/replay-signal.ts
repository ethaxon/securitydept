import { createSignal } from "./signal";
import type {
	ComputedReplaySignalTrait,
	ReadableReplaySignalTrait,
	ReadableSignalTrait,
	ReplaySignalSlot,
	WritableReplaySignalTrait,
} from "./types";

const EMPTY_REPLAY_SIGNAL_SLOT = { kind: "empty" } as const;

export function createReplaySignal<T>(): WritableReplaySignalTrait<T> {
	const signal = createSignal<ReplaySignalSlot<T>>(EMPTY_REPLAY_SIGNAL_SLOT);

	return {
		...createReadableReplaySignalView(signal),
		emit(value) {
			signal.set({ kind: "value", value });
		},
		clear() {
			signal.set(EMPTY_REPLAY_SIGNAL_SLOT);
		},
	};
}

export function readonlyReplaySignal<T>(
	signal: WritableReplaySignalTrait<T>,
): ReadableReplaySignalTrait<T> {
	return createReadableReplaySignalView(signal);
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

function createReadableReplaySignalView<T>(signal: {
	get(): ReplaySignalSlot<T>;
	subscribe(listener: () => void): () => void;
}): ReadableReplaySignalTrait<T> {
	return {
		get: () => signal.get(),
		subscribe: (listener) => signal.subscribe(listener),
		hasValue: () => signal.get().kind === "value",
		whenValue: (options) => {
			const slot = signal.get();
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
					const nextSlot = signal.get();
					if (nextSlot.kind === "value") {
						cleanup();
						resolve(nextSlot.value);
					}
				};

				unsubscribe = signal.subscribe(resolveIfValue);
				disposeCancellation = cancellationToken?.onCancellationRequested(() => {
					cleanup();
					reject(readCancellationError(cancellationToken));
				}).dispose;
				resolveIfValue();
			});
		},
	};
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
		typeof value.whenValue === "function"
	);
}
