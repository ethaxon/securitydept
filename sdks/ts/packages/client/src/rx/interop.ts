import {
	isObservable,
	Observable,
	type OperatorFunction,
	Subject,
	type Subscribable,
} from "rxjs";
import { SYMBOL_OBSERVABLE } from "../compat";
import {
	type EventOperatorFunction,
	type EventStreamTrait,
	type EventSubjectTrait,
} from "../events";
import {
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
} from "../signals";

export function signalToObservable<T>(
	signal: ReadableSignalTrait<T> | ReadableReplaySignalTrait<T>,
): Observable<T> {
	return eventStreamToObservable(signal[SYMBOL_OBSERVABLE]());
}

export function observableToEventStream<T>(
	observable: Subscribable<T>,
): EventStreamTrait<T> {
	if (
		typeof observable === "object" &&
		observable !== null &&
		SYMBOL_OBSERVABLE in observable &&
		typeof observable[SYMBOL_OBSERVABLE] === "function"
	) {
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

export function subjectToEventSubject<T>(
	subject: Subject<T>,
): EventSubjectTrait<T> {
	return Object.assign(observableToEventStream(subject), {
		next: subject.next.bind(subject),
		error: subject.error.bind(subject),
		complete: subject.complete.bind(subject),
	});
}

export function eventSubjectToSubject<T>(
	eventSubject: EventSubjectTrait<T>,
): Subject<T> {
	const subject = new Subject<T>();
	const next = subject.next.bind(subject);
	const error = subject.error.bind(subject);
	const complete = subject.complete.bind(subject);
	const unsubscribe = subject.unsubscribe.bind(subject);
	const bridgeSubscription = eventSubject.subscribe({
		next,
		error,
		complete,
	});

	return Object.assign(subject, {
		next(value: T) {
			eventSubject.next(value);
		},
		error(reason: unknown) {
			eventSubject.error(reason);
			bridgeSubscription.unsubscribe();
		},
		complete() {
			eventSubject.complete();
			bridgeSubscription.unsubscribe();
		},
		unsubscribe() {
			bridgeSubscription.unsubscribe();
			unsubscribe();
		},
	});
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
