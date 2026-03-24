import { createEventStream } from "./event-stream";
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
	return (source) =>
		createEventStream((observer) => {
			const sub = source.subscribe({
				next(value) {
					observer.next?.(fn(value));
				},
				error(err) {
					observer.error?.(err);
				},
				complete() {
					observer.complete?.();
				},
			});
			return () => sub.unsubscribe();
		});
}

// --- filter ---

export function filter<A>(
	predicate: (value: A) => boolean,
): EventOperator<A, A> {
	return (source) =>
		createEventStream((observer) => {
			const sub = source.subscribe({
				next(value) {
					if (predicate(value)) observer.next?.(value);
				},
				error(err) {
					observer.error?.(err);
				},
				complete() {
					observer.complete?.();
				},
			});
			return () => sub.unsubscribe();
		});
}

// --- tap ---

export function tap<A>(fn: (value: A) => void): EventOperator<A, A> {
	return (source) =>
		createEventStream((observer) => {
			const sub = source.subscribe({
				next(value) {
					fn(value);
					observer.next?.(value);
				},
				error(err) {
					observer.error?.(err);
				},
				complete() {
					observer.complete?.();
				},
			});
			return () => sub.unsubscribe();
		});
}

// --- takeUntil ---

export function takeUntil<A>(
	notifier: EventStreamTrait<unknown>,
): EventOperator<A, A> {
	return (source) =>
		createEventStream((observer) => {
			const sourceSub = source.subscribe({
				next(value) {
					observer.next?.(value);
				},
				error(err) {
					observer.error?.(err);
				},
				complete() {
					observer.complete?.();
				},
			});

			const notifierSub = notifier.subscribe({
				next() {
					observer.complete?.();
					sourceSub.unsubscribe();
					notifierSub.unsubscribe();
				},
			});

			return () => {
				sourceSub.unsubscribe();
				notifierSub.unsubscribe();
			};
		});
}

// --- finalize ---

export function finalize<A>(fn: () => void): EventOperator<A, A> {
	return (source) =>
		createEventStream((observer) => {
			const sub = source.subscribe({
				next(value) {
					observer.next?.(value);
				},
				error(err) {
					observer.error?.(err);
					fn();
				},
				complete() {
					observer.complete?.();
					fn();
				},
			});
			return () => {
				sub.unsubscribe();
				fn();
			};
		});
}

// --- merge ---

export function merge<A>(
	...sources: EventStreamTrait<A>[]
): EventStreamTrait<A> {
	return createEventStream((observer) => {
		let completedCount = 0;
		const subs = sources.map((source) =>
			source.subscribe({
				next(value) {
					observer.next?.(value);
				},
				error(err) {
					observer.error?.(err);
				},
				complete() {
					completedCount++;
					if (completedCount === sources.length) {
						observer.complete?.();
					}
				},
			}),
		);
		return () => {
			for (const sub of subs) {
				sub.unsubscribe();
			}
		};
	});
}
