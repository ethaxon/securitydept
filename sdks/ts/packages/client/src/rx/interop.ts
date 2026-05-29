import {
	BehaviorSubject,
	filter,
	isObservable,
	map,
	Observable,
	Subject,
	type Subscribable,
	type Subscription,
	skip,
} from "rxjs";
import { SYMBOL_OBSERVABLE } from "../compat";
import { type EventStreamTrait, type EventSubjectTrait } from "../events";
import {
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
	type ReplaySignalSlot,
	type WritableSignalTrait,
} from "../signals/types";

const EMPTY_REPLAY_SIGNAL_SLOT = { kind: "empty" } as const;

export function signalToObservable<T>(
	signal: ReadableSignalTrait<T> | ReadableReplaySignalTrait<T>,
): Observable<T> {
	return eventStreamToObservable(signal[SYMBOL_OBSERVABLE]());
}

export function behaviorSubjectToSignal<T>(
	createSubject: () => BehaviorSubject<T>,
): WritableSignalTrait<T> {
	const subject = createSubject();
	return {
		get: () => subject.getValue(),
		set: (value) => {
			subject.next(value);
		},
		notify(listener) {
			const subscription = subject.pipe(skip(1)).subscribe(() => {
				listener();
			});
			return () => {
				subscription.unsubscribe();
			};
		},
		[SYMBOL_OBSERVABLE]: () => subject.asObservable(),
	};
}

export function observableToReplaySignal<T>(
	source: Observable<T>,
): ReadableReplaySignalTrait<T> {
	const subject = new BehaviorSubject<ReplaySignalSlot<T>>(
		EMPTY_REPLAY_SIGNAL_SLOT,
	);
	source.subscribe((value) => {
		subject.next({ kind: "value", value });
	});
	const valueObservable = subject.pipe(
		filter(
			(slot): slot is { kind: "value"; value: T } => slot.kind === "value",
		),
		map((slot) => slot.value),
	);

	return {
		get: () => subject.getValue(),
		notify(listener) {
			const subscription = subject.pipe(skip(1)).subscribe(() => {
				listener();
			});
			return () => {
				subscription.unsubscribe();
			};
		},
		hasValue: () => subject.getValue().kind === "value",
		whenValue(options) {
			const slot = subject.getValue();
			if (slot.kind === "value") {
				return Promise.resolve(slot.value);
			}

			const cancellationToken = options?.cancellationToken;
			if (cancellationToken?.isCancellationRequested) {
				return Promise.reject(cancellationToken.readCancellationError());
			}

			return new Promise<T>((resolve, reject) => {
				let subscription: Subscription | undefined;
				let disposeCancellation: (() => void) | undefined;

				const cleanup = () => {
					subscription?.unsubscribe();
					subscription = undefined;
					disposeCancellation?.();
					disposeCancellation = undefined;
				};

				const resolveIfValue = () => {
					const nextSlot = subject.getValue();
					if (nextSlot.kind === "value") {
						cleanup();
						resolve(nextSlot.value);
					}
				};

				subscription = subject.subscribe(resolveIfValue);
				disposeCancellation = cancellationToken?.onCancellationRequested(() => {
					cleanup();
					reject(cancellationToken.readCancellationError());
				}).dispose;
				resolveIfValue();
			});
		},
		[SYMBOL_OBSERVABLE]: () => valueObservable,
	};
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
