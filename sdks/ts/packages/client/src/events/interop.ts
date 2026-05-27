import { from } from "rxjs";
import { type InteropObservableTrait } from "../compat";
import { observableToEventStream } from "../rx";
import {
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
} from "../signals/types";
import { type EventStreamTrait, isEventStreamTrait } from "./types";

export type ToEventStreamInput<T> =
	| InteropObservableTrait<T>
	| Promise<T>
	| AsyncIterable<T>
	| PromiseLike<T>
	| ArrayLike<T>
	| Iterable<T>
	| EventStreamTrait<T>
	| ReadableSignalTrait<T>
	| ReadableReplaySignalTrait<T>;

export function toEventStream<T>(
	input: ToEventStreamInput<T>,
): EventStreamTrait<T> {
	if (isEventStreamTrait(input)) {
		return input;
	}
	return observableToEventStream(from(input));
}
