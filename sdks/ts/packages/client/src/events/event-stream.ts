import { Observable, ReplaySubject, Subject } from "rxjs";
import type {
	EventObserver,
	EventStreamTrait,
	EventSubscriptionTrait,
	ReplaySubjectTrait,
	SubjectTrait,
} from "./types";

const RX_OBSERVABLE = Symbol("securitydept.rxObservable");

type RxBackedEventStream<T> = EventStreamTrait<T> & {
	readonly [RX_OBSERVABLE]: Observable<T>;
};

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
	return fromRxObservable(
		new Observable<T>((subscriber) => {
			const teardown = producer({
				next: (value) => subscriber.next(value),
				error: (error) => subscriber.error(error),
				complete: () => subscriber.complete(),
			});
			return () => teardown?.();
		}),
	);
}

export function createSubject<T>(): SubjectTrait<T> {
	return wrapSubject(new Subject<T>());
}

export function createReplaySubject<T>(bufferSize = 1): ReplaySubjectTrait<T> {
	const subject = wrapSubject(new ReplaySubject<T>(bufferSize));
	return Object.assign(subject, { bufferSize });
}

export function toRxObservable<T>(stream: EventStreamTrait<T>): Observable<T> {
	const maybeBacked = stream as Partial<RxBackedEventStream<T>>;
	if (maybeBacked[RX_OBSERVABLE]) {
		return maybeBacked[RX_OBSERVABLE];
	}

	return new Observable<T>((subscriber) => {
		const subscription = stream.subscribe({
			next: (value) => subscriber.next(value),
			error: (error) => subscriber.error(error),
			complete: () => subscriber.complete(),
		});
		return () => subscription.unsubscribe();
	});
}

export function fromRxObservable<T>(
	observable: Observable<T>,
): EventStreamTrait<T> {
	return {
		[RX_OBSERVABLE]: observable,
		subscribe(observer: EventObserver<T>): EventSubscriptionTrait {
			const subscription = observable.subscribe({
				next: (value) => observer.next?.(value),
				error: (error) => observer.error?.(error),
				complete: () => observer.complete?.(),
			});
			return { unsubscribe: () => subscription.unsubscribe() };
		},
	} as RxBackedEventStream<T>;
}

function wrapSubject<T>(subject: Subject<T>): SubjectTrait<T> {
	return Object.assign(fromRxObservable(subject.asObservable()), {
		next: (value: T) => subject.next(value),
		error: (error: unknown) => subject.error(error),
		complete: () => subject.complete(),
	});
}
