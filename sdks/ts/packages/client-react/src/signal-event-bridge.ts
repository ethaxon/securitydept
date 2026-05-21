import type {
	EventStreamTrait,
	ReadableSignalTrait,
} from "@securitydept/client";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

export function useReadableSignal<T>(source: ReadableSignalTrait<T>): T {
	const subscribe = useCallback(
		(listener: () => void) => source.subscribe(listener),
		[source],
	);
	const getSnapshot = useCallback(() => source.get(), [source]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
