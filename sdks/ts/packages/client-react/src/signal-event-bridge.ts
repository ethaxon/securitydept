import {
	type EventStreamTrait,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
	type ReplaySignalSlot,
} from "@securitydept/client";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

interface SignalStore<T> {
	get(): T;
	subscribe(listener: () => void): () => void;
}

export function useReadableSignal<T>(source: ReadableSignalTrait<T>): T {
	const store = source as SignalStore<T>;
	const subscribe = useCallback(
		(listener: () => void) => store.subscribe(listener),
		[store],
	);
	const getSnapshot = useCallback(() => store.get(), [store]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface UseReplaySignalValueOptions<T> {
	initialValue?: T;
}

export function useReplaySignalValue<T>(
	source: ReadableReplaySignalTrait<T>,
	options: UseReplaySignalValueOptions<T> = {},
): T {
	const store = source as unknown as SignalStore<ReplaySignalSlot<T>>;
	const slot = useSyncExternalStore(
		useCallback((listener: () => void) => store.subscribe(listener), [store]),
		useCallback(() => store.get(), [store]),
		useCallback(() => store.get(), [store]),
	);
	if (slot.kind === "value") {
		return slot.value;
	}
	if (Object.hasOwn(options, "initialValue")) {
		return options.initialValue as T;
	}
	throw source.whenValue();
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
