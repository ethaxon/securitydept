import {
	isObservable,
	Observable,
	type OperatorFunction,
	type Subscribable,
} from "rxjs";
import { SYMBOL_OBSERVABLE } from "../compat";
import type { EventOperatorFunction, EventStreamTrait } from "../events";
import type {
	ReadableReplaySignalTrait,
	ReadableSignalTrait,
} from "../signals";

export function signalToObservable<T>(
	signal: ReadableSignalTrait<T> | ReadableReplaySignalTrait<T>,
): Observable<T> {
	return eventStreamToObservable(signal[Symbol.observable]());
}

export function observableToEventStream<T>(
	observable: Subscribable<T>,
): EventStreamTrait<T> {
	if (isObservable(observable)) {
		return observable as unknown as EventStreamTrait<T>;
	}
	return Object.assign(observable, {
		[SYMBOL_OBSERVABLE]() {
			return observable;
		},
	});
}

export function eventStreamToObservable<T>(
	eventStream: Omit<EventStreamTrait<T>, typeof Symbol.observable>,
): Observable<T> {
	if (isObservable(eventStream)) {
		return eventStream as Observable<T>;
	}
	return new Observable<T>((subscriber) =>
		eventStream.subscribe({
			next: (value) => subscriber.next(value),
			error: (error) => subscriber.error(error),
			complete: () => subscriber.complete(),
		}),
	);
}

export function eventOperatorFunctionToRx<T, R>(
	op: EventOperatorFunction<T, R>,
): OperatorFunction<T, R> {
	return (source) =>
		eventStreamToObservable(op(observableToEventStream(source)));
}

export function rxOperatorFunctionToEvent<T, R>(
	op: OperatorFunction<T, R>,
): EventOperatorFunction<T, R> {
	return (stream) =>
		observableToEventStream(op(eventStreamToObservable(stream)));
}
