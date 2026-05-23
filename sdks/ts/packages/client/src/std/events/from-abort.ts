import type { EventStreamTrait } from "../../events";
import { createEventStream, fromEventPattern } from "../../events";

export interface AbortSignalSource {
	aborted: boolean;
	reason: unknown;
	addEventListener(type: "abort", listener: EventListener): void;
	removeEventListener(type: "abort", listener: EventListener): void;
}

export interface FromAbortSignalOptions {
	/** AbortSignal to observe. */
	signal: AbortSignalSource;
	/**
	 * Emit immediately when the signal is already aborted at subscribe time.
	 * Defaults to `false`.
	 */
	emitIfAborted?: boolean;
}

/**
 * Adapt an `AbortSignal`-like source into an event stream of abort reasons.
 */
export function fromAbortSignal(
	options: FromAbortSignalOptions,
): EventStreamTrait<unknown> {
	return createEventStream<unknown>((observer) => {
		const { signal } = options;

		if (options.emitIfAborted && signal.aborted) {
			observer.next?.(signal.reason);
		}

		const subscription = fromEventPattern<Event>({
			addHandler: (handler) => {
				signal.addEventListener("abort", handler);
			},
			removeHandler: (handler) => {
				signal.removeEventListener("abort", handler);
			},
		}).subscribe({
			next: () => observer.next?.(signal.reason),
			error: (error) => observer.error?.(error),
			complete: () => observer.complete?.(),
		});

		return () => subscription.unsubscribe();
	});
}
