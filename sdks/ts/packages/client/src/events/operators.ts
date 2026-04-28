import { merge as rxMerge } from "rxjs";
import {
	concatMap as rxConcatMap,
	debounceTime as rxDebounceTime,
	exhaustMap as rxExhaustMap,
	filter as rxFilter,
	finalize as rxFinalize,
	map as rxMap,
	share as rxShare,
	shareReplay as rxShareReplay,
	switchMap as rxSwitchMap,
	takeUntil as rxTakeUntil,
	tap as rxTap,
	throttleTime as rxThrottleTime,
	withLatestFrom as rxWithLatestFrom,
} from "rxjs/operators";
import type { ReadableSignalTrait } from "../signals";
import {
	createEventStream,
	fromRxObservable,
	toRxObservable,
} from "./event-stream";
import type { EventStreamTrait } from "./types";

// --- Operator types ---

export type EventOperator<A, B> = (
	source: EventStreamTrait<A>,
) => EventStreamTrait<B>;

// --- pipe ---

export function pipe<A>(source: EventStreamTrait<A>): EventStreamTrait<A>;
export function pipe<A, B>(
	source: EventStreamTrait<A>,
	op1: EventOperator<A, B>,
): EventStreamTrait<B>;
export function pipe<A, B, C>(
	source: EventStreamTrait<A>,
	op1: EventOperator<A, B>,
	op2: EventOperator<B, C>,
): EventStreamTrait<C>;
export function pipe<A, B, C, D>(
	source: EventStreamTrait<A>,
	op1: EventOperator<A, B>,
	op2: EventOperator<B, C>,
	op3: EventOperator<C, D>,
): EventStreamTrait<D>;
export function pipe(
	source: EventStreamTrait<unknown>,
	...operators: EventOperator<unknown, unknown>[]
): EventStreamTrait<unknown> {
	return operators.reduce((acc, op) => op(acc), source);
}

// --- map ---

export function map<A, B>(fn: (value: A) => B): EventOperator<A, B> {
	return (source) => fromRxObservable(toRxObservable(source).pipe(rxMap(fn)));
}

// --- filter ---

export function filter<A>(
	predicate: (value: A) => boolean,
): EventOperator<A, A> {
	return (source) =>
		fromRxObservable(toRxObservable(source).pipe(rxFilter(predicate)));
}

// --- tap ---

export function tap<A>(fn: (value: A) => void): EventOperator<A, A> {
	return (source) => fromRxObservable(toRxObservable(source).pipe(rxTap(fn)));
}

// --- takeUntil ---

export function takeUntil<A>(
	notifier: EventStreamTrait<unknown>,
): EventOperator<A, A> {
	return (source) =>
		fromRxObservable(
			toRxObservable(source).pipe(rxTakeUntil(toRxObservable(notifier))),
		);
}

// --- finalize ---

export function finalize<A>(fn: () => void): EventOperator<A, A> {
	return (source) =>
		fromRxObservable(toRxObservable(source).pipe(rxFinalize(fn)));
}

// --- merge ---

export function merge<A>(
	...sources: EventStreamTrait<A>[]
): EventStreamTrait<A> {
	return fromRxObservable(rxMerge(...sources.map(toRxObservable)));
}

export function share<A>(): EventOperator<A, A> {
	return (source) => fromRxObservable(toRxObservable(source).pipe(rxShare()));
}

export function shareReplay<A>(bufferSize = 1): EventOperator<A, A> {
	return (source) =>
		fromRxObservable(
			toRxObservable(source).pipe(
				rxShareReplay({ bufferSize, refCount: true }),
			),
		);
}

export function switchMap<A, B>(
	fn: (value: A) => EventStreamTrait<B>,
): EventOperator<A, B> {
	return (source) =>
		fromRxObservable(
			toRxObservable(source).pipe(
				rxSwitchMap((value) => toRxObservable(fn(value))),
			),
		);
}

export function concatMap<A, B>(
	fn: (value: A) => EventStreamTrait<B>,
): EventOperator<A, B> {
	return (source) =>
		fromRxObservable(
			toRxObservable(source).pipe(
				rxConcatMap((value) => toRxObservable(fn(value))),
			),
		);
}

export function exhaustMap<A, B>(
	fn: (value: A) => EventStreamTrait<B>,
): EventOperator<A, B> {
	return (source) =>
		fromRxObservable(
			toRxObservable(source).pipe(
				rxExhaustMap((value) => toRxObservable(fn(value))),
			),
		);
}

export function debounceTime<A>(durationMs: number): EventOperator<A, A> {
	return (source) =>
		fromRxObservable(toRxObservable(source).pipe(rxDebounceTime(durationMs)));
}

export function throttleTime<A>(durationMs: number): EventOperator<A, A> {
	return (source) =>
		fromRxObservable(toRxObservable(source).pipe(rxThrottleTime(durationMs)));
}

export function withLatestFromSignal<A, B>(
	signal: ReadableSignalTrait<B>,
): EventOperator<A, [A, B]> {
	return (source) =>
		fromRxObservable(
			toRxObservable(source).pipe(
				rxWithLatestFrom(
					toRxObservable(
						createEventStream<B>((observer) => {
							observer.next?.(signal.get());
							return signal.subscribe(() => observer.next?.(signal.get()));
						}),
					),
				),
			),
		);
}
