import { Observable, ReplaySubject, Subject } from "rxjs";
import { SYMBOL_OBSERVABLE } from "../compat";
import type {
	EventObserverTrait,
	EventStreamTrait,
	EventSubjectTrait,
} from "./types";

/**
 * Create a new event stream from a producer function.
 *
 * The producer receives an observer and should call `next()` to emit values,
 * `error()` to signal an error, and `complete()` to signal completion.
 * It may return a teardown function that will be called on unsubscribe.
 */
export function createEventStream<T>(
	producer: (observer: EventObserverTrait<T>) => (() => void) | void,
): EventStreamTrait<T> {
	const observable = new Observable<T>(producer);
	return Object.assign(new Observable<T>(producer), {
		[SYMBOL_OBSERVABLE]() {
			return observable;
		},
	});
}

export function createEventSubject<T>(): EventSubjectTrait<T> {
	const subject = new Subject<T>();
	return Object.assign(subject, {
		[SYMBOL_OBSERVABLE]() {
			return subject;
		},
	});
}

export function createEventReplaySubject<T>(
	bufferSize = Infinity,
): EventSubjectTrait<T> {
	const subject = new ReplaySubject<T>(bufferSize);
	return Object.assign(subject, {
		[SYMBOL_OBSERVABLE]() {
			return subject;
		},
	});
}

export function createEmptyEventStream<T>(): EventStreamTrait<T> {
	const observable = new Observable<T>();
	return Object.assign(observable, {
		[SYMBOL_OBSERVABLE]() {
			return observable;
		},
	});
}

export function createNeverEventStream<T>(): EventStreamTrait<T> {
	const observable = new Observable<T>();
	return Object.assign(observable, {
		[SYMBOL_OBSERVABLE]() {
			return observable;
		},
	});
}
