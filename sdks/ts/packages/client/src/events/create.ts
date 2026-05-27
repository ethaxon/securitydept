import { EMPTY, NEVER, Observable, ReplaySubject, Subject } from "rxjs";
import { observableToEventStream, subjectToEventSubject } from "../rx/interop";
import {
	type EventObserverTrait,
	type EventStreamTrait,
	type EventSubjectTrait,
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
	return observableToEventStream(new Observable<T>(producer));
}

export function createEventSubject<T>(): EventSubjectTrait<T> {
	return subjectToEventSubject(new Subject<T>());
}

export function createEventReplaySubject<T>(
	bufferSize = Infinity,
): EventSubjectTrait<T> {
	return subjectToEventSubject(new ReplaySubject<T>(bufferSize));
}

export function createEmptyEventStream<T>(): EventStreamTrait<T> {
	return observableToEventStream(EMPTY);
}

export function createNeverEventStream<T>(): EventStreamTrait<T> {
	return observableToEventStream(NEVER);
}
