import { EMPTY, fromEventPattern, map, merge, of } from "rxjs";
import { type EventStreamTrait } from "../../events/types";
import { observableToEventStream } from "../../rx/interop";

export type AbortSignalStdSource = Pick<AbortSignal, "aborted" | "reason"> & {
	addEventListener?: (type: "abort", listener: EventListener) => void;
	removeEventListener?: (type: "abort", listener: EventListener) => void;
};

/**
 * Adapt an `AbortSignal`-like source into an event stream of abort reasons.
 */
export function abortSignalToEventStream(
	signal: AbortSignalStdSource,
): EventStreamTrait<unknown> {
	return observableToEventStream(
		merge(
			signal.aborted ? of(signal.reason) : EMPTY,
			fromEventPattern<Event>(
				(handler) => {
					signal.addEventListener?.("abort", handler);
				},
				(handler) => {
					signal.removeEventListener?.("abort", handler);
				},
			).pipe(map(() => signal.reason)),
		),
	);
}
