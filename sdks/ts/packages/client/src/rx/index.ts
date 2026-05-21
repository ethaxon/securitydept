import { Observable } from "rxjs";
import type { EventStreamTrait } from "../events/index";
import {
	fromRxObservable as fromEventRxObservable,
	toRxObservable as toEventRxObservable,
} from "../events/index";
import type { ReadableSignalTrait } from "../signals/index";

export function toRxObservable<T>(source: EventStreamTrait<T>): Observable<T>;
export function toRxObservable<T>(
	source: ReadableSignalTrait<T>,
): Observable<T>;
export function toRxObservable<T>(
	source: EventStreamTrait<T> | ReadableSignalTrait<T>,
): Observable<T> {
	if (isReadableSignal(source)) {
		return new Observable<T>((subscriber) => {
			subscriber.next(source.get());
			const unsubscribe = source.subscribe(() => {
				subscriber.next(source.get());
			});
			return () => unsubscribe();
		});
	}

	return toEventRxObservable(source);
}

export function fromRxObservable<T>(
	observable: Observable<T>,
): EventStreamTrait<T> {
	return fromEventRxObservable(observable);
}

function isReadableSignal<T>(
	value: EventStreamTrait<T> | ReadableSignalTrait<T>,
): value is ReadableSignalTrait<T> {
	return (
		typeof value === "object" &&
		value !== null &&
		"get" in value &&
		typeof value.get === "function" &&
		"subscribe" in value &&
		typeof value.subscribe === "function"
	);
}
