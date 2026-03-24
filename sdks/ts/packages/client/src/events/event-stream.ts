import type {
	EventObserver,
	EventStreamTrait,
	EventSubscriptionTrait,
} from "./types";

/**
 * Create a new event stream from a producer function.
 *
 * The producer receives an observer and should call `next()` to emit values,
 * `error()` to signal an error, and `complete()` to signal completion.
 * It may return a teardown function that will be called on unsubscribe.
 */
export function createEventStream<T>(
	producer: (observer: EventObserver<T>) => (() => void) | void,
): EventStreamTrait<T> {
	return {
		subscribe(observer: EventObserver<T>): EventSubscriptionTrait {
			let active = true;
			const safeObserver: EventObserver<T> = {
				next(value: T) {
					if (active) observer.next?.(value);
				},
				error(err: unknown) {
					if (active) {
						active = false;
						observer.error?.(err);
					}
				},
				complete() {
					if (active) {
						active = false;
						observer.complete?.();
					}
				},
			};

			const teardown = producer(safeObserver);

			return {
				unsubscribe() {
					if (active) {
						active = false;
						teardown?.();
					}
				},
			};
		},
	};
}
