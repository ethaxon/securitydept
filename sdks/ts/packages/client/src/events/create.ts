import { EMPTY, NEVER } from "rxjs";
import {
	RxEventReplaySubject,
	RxEventStream,
	RxEventSubject,
} from "../rx/event";
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
	return new RxEventStream(producer);
}

export function createEventSubject<T>(): EventSubjectTrait<T> {
	return new RxEventSubject<T>();
}

export function createEventReplaySubject<T>(
	bufferSize = Infinity,
): EventSubjectTrait<T> {
	return new RxEventReplaySubject<T>(bufferSize);
}

export function createEmptyEventStream<T>(): EventStreamTrait<T> {
	return RxEventStream.fromObservableInput(EMPTY);
}

export function createNeverEventStream<T>(): EventStreamTrait<T> {
	return RxEventStream.fromObservableInput(NEVER);
}
