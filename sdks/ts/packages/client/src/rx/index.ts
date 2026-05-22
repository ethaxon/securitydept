import { Observable } from "rxjs";
import type { EventStreamTrait } from "../events/index";
import { fromEventRxObservable, toEventRxObservable } from "../events/index";
import type {
	ReadableReplaySignalTrait,
	ReadableSignalTrait,
} from "../signals/index";
import { isReplaySignalTrait } from "../signals/index";

export function toRxObservable<T>(
	source: ReadableReplaySignalTrait<T>,
): Observable<T>;
export function toRxObservable<T>(source: EventStreamTrait<T>): Observable<T>;
export function toRxObservable<T>(
	source: ReadableSignalTrait<T>,
): Observable<T>;
export function toRxObservable<T>(
	source:
		| EventStreamTrait<T>
		| ReadableSignalTrait<T>
		| ReadableReplaySignalTrait<T>,
): Observable<T> {
	if (isReplaySignalTrait<T>(source)) {
		return new Observable<T>((subscriber) => {
			const emitIfPresent = () => {
				const slot = source.get();
				if (slot.kind === "value") {
					subscriber.next(slot.value);
				}
			};
			emitIfPresent();
			const unsubscribe = source.subscribe(emitIfPresent);
			return () => unsubscribe();
		});
	}

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
	value:
		| EventStreamTrait<T>
		| ReadableSignalTrait<T>
		| ReadableReplaySignalTrait<T>,
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
