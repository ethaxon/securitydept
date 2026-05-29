import {
	type EventStreamTrait,
	type InteropObservableTrait,
	isInteropObservableTrait,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
	type SubscribableTrait,
	SYMBOL_OBSERVABLE,
} from "@securitydept/client";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";

export function useReadableSignalValue<T>(source: ReadableSignalTrait<T>): T {
	const subscribe = useCallback(
		(listener: () => void) => source.notify(listener),
		[source],
	);
	const getSnapshot = useCallback(() => source.get(), [source]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface UseReplaySignalValueOptions<T> {
	initialValue?: T;
}

export function useReplaySignalValue<T>(
	source: ReadableReplaySignalTrait<T>,
	options: UseReplaySignalValueOptions<T> = {},
): T {
	const slot = useSyncExternalStore(
		useCallback((listener: () => void) => source.notify(listener), [source]),
		useCallback(() => source.get(), [source]),
		useCallback(() => source.get(), [source]),
	);
	if (slot.kind === "value") {
		return slot.value;
	}
	if (Object.hasOwn(options, "initialValue")) {
		return options.initialValue as T;
	}
	throw source.whenValue();
}

export interface UseInteropObservableOptions<T> {
	initialValue?: T;
	requireSync?: boolean;
}

export function useInteropObservable<T>(
	source: InteropObservableTrait<T> | SubscribableTrait<T>,
): T | undefined;
export function useInteropObservable<T>(
	source: InteropObservableTrait<T> | SubscribableTrait<T>,
	options: UseInteropObservableOptions<T> & {
		initialValue?: undefined;
		requireSync?: false;
	},
): T | undefined;
export function useInteropObservable<T>(
	source: InteropObservableTrait<T> | SubscribableTrait<T>,
	options: UseInteropObservableOptions<T | null> & {
		initialValue?: null;
		requireSync?: false;
	},
): T | null;
export function useInteropObservable<T>(
	source: InteropObservableTrait<T> | SubscribableTrait<T>,
	options: UseInteropObservableOptions<T> & {
		initialValue?: undefined;
		requireSync: true;
	},
): T;
export function useInteropObservable<T, const U extends T>(
	source: InteropObservableTrait<T> | SubscribableTrait<T>,
	options: UseInteropObservableOptions<T | U> & {
		initialValue: U;
		requireSync?: false;
	},
): T | U;
export function useInteropObservable<T>(
	source: InteropObservableTrait<T> | SubscribableTrait<T>,
	options: UseInteropObservableOptions<T | undefined> = {},
): T | undefined {
	const initialValueProvided = Object.hasOwn(options, "initialValue");
	const initialValue = options.initialValue;
	const requireSync = options.requireSync;
	const store = useMemo(
		() =>
			createInteropObservableStore(source, {
				initialValue,
				initialValueProvided,
				requireSync,
			}),
		[source, initialValue, initialValueProvided, requireSync],
	);
	return useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
}

export function useEventStream<T>(
	source: EventStreamTrait<T>,
	handler: (event: T) => void,
	options: { enabled?: boolean } = {},
): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	useEffect(() => {
		if (options.enabled === false) {
			return;
		}

		const subscription = source.subscribe({
			next: (event) => {
				handlerRef.current(event);
			},
		});

		return () => {
			subscription.unsubscribe();
		};
	}, [options.enabled, source]);
}

function createInteropObservableStore<T>(
	source: InteropObservableTrait<T> | SubscribableTrait<T>,
	options: {
		initialValue: T | undefined;
		initialValueProvided: boolean;
		requireSync?: boolean;
	},
): {
	getSnapshot(): T | undefined;
	subscribe(listener: () => void): () => void;
} {
	const subscribable = (
		isInteropObservableTrait(source) ? source[SYMBOL_OBSERVABLE]() : source
	) as SubscribableTrait<T>;
	let current = options.initialValueProvided ? options.initialValue : undefined;
	let error: unknown;

	if (options.requireSync === true) {
		let syncEmitted = false;
		const subscription = subscribable.subscribe({
			next(value) {
				syncEmitted = true;
				current = value;
			},
			error(nextError) {
				error = nextError;
			},
		});
		subscription.unsubscribe();
		if (error !== undefined) {
			throw error;
		}
		if (!syncEmitted) {
			throw new Error(
				"useInteropObservable() requires a synchronous emission.",
			);
		}
	}

	return {
		getSnapshot() {
			if (error !== undefined) {
				throw error;
			}
			return current;
		},
		subscribe(listener) {
			const subscription = subscribable.subscribe({
				next(value) {
					current = value;
					listener();
				},
				error(nextError) {
					error = nextError;
					listener();
				},
			});
			return () => {
				subscription.unsubscribe();
			};
		},
	};
}
