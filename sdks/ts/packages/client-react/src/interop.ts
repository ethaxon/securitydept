import {
	type EventStreamTrait,
	type InteropObservableTrait,
	isInteropObservableTrait,
	type ReadableSignalTrait,
	type ResourceSnapshot,
	ResourceStatus,
	type ResourceTrait,
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

export function useSignal<T>(source: ReadableSignalTrait<T>): T {
	const subscribe = useCallback(
		(listener: () => void) => {
			const subscription = source.watchStream().subscribe({
				next: listener,
			});
			return () => {
				subscription.unsubscribe();
			};
		},
		[source],
	);
	const getSnapshot = useCallback(() => source.get(), [source]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useResourceSnapshot<T>(
	resource: ResourceTrait<T>,
): ResourceSnapshot<T> {
	const subscribe = useCallback(
		(listener: () => void) => {
			const subscription = resource[SYMBOL_OBSERVABLE]().subscribe({
				next: listener,
				error: listener,
			});
			return () => {
				subscription.unsubscribe();
			};
		},
		[resource],
	);
	const getSnapshot = useCallback(() => resource.snapshot.get(), [resource]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface UseResourceValueOptions<T> {
	initialValue?: T;
}

export function useResourceValue<T>(
	resource: ResourceTrait<T>,
	options: UseResourceValueOptions<T> = {},
): T {
	const snapshot = useResourceSnapshot(resource);
	if (
		snapshot.status === ResourceStatus.LoadingError ||
		snapshot.status === ResourceStatus.Error
	) {
		throw snapshot.error;
	}
	if (
		snapshot.status === ResourceStatus.Reloading ||
		snapshot.status === ResourceStatus.Resolved
	) {
		return snapshot.value;
	}
	if (Object.hasOwn(options, "initialValue")) {
		return options.initialValue as T;
	}
	throw resource.whenValue();
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
