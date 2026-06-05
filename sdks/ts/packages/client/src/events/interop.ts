import { from } from "rxjs";
import { type InteropObservableTrait } from "../compat";
import { RxEventStream } from "../rx/event";
import { type ReadableSignalTrait } from "../signals/types";
import { type EventStreamTrait, isEventStreamTrait } from "./types";

export type ToEventStreamInput<T> =
	| InteropObservableTrait<T>
	| Promise<T>
	| AsyncIterable<T>
	| PromiseLike<T>
	| ArrayLike<T>
	| Iterable<T>
	| EventStreamTrait<T>
	| ReadableSignalTrait<T>;

export function toEventStream<T>(
	input: ToEventStreamInput<T>,
): EventStreamTrait<T> {
	if (isEventStreamTrait(input)) {
		return input;
	}
	return RxEventStream.fromObservableInput(from(input));
}
