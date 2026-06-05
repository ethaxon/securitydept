import {
	from,
	Observable,
	type ObservableInput,
	type OperatorFunction,
	ReplaySubject,
	Subject,
} from "rxjs";
import {
	type InteropObservableTrait,
	isInteropObservableTrait,
	type SubscribableTrait,
	SYMBOL_OBSERVABLE,
} from "../compat";
import {
	type EventObserverTrait,
	type EventStreamTrait,
	type EventSubjectTrait,
} from "../events/types";

export type RxEventStreamProducer<T> = (
	observer: EventObserverTrait<T>,
) => (() => void) | void;

export type RxEventStreamInput<T> =
	| ObservableInput<T>
	| InteropObservableTrait<T>
	| SubscribableTrait<T>;

export class RxEventStream<T>
	extends Observable<T>
	implements EventStreamTrait<T>, InteropObservableTrait<T>
{
	constructor(source: RxEventStreamInput<T> | RxEventStreamProducer<T>) {
		super((subscriber) => {
			if (typeof source === "function") {
				return source(subscriber);
			}
			if (isInteropObservableTrait<T>(source)) {
				const subscription = source[SYMBOL_OBSERVABLE]().subscribe(subscriber);
				return () => {
					subscription.unsubscribe();
				};
			}
			if (
				typeof source === "object" &&
				source !== null &&
				"subscribe" in source &&
				typeof source.subscribe === "function"
			) {
				const subscription = source.subscribe(subscriber);
				return () => {
					subscription.unsubscribe();
				};
			}
			const subscription = from(source as ObservableInput<T>).subscribe(
				subscriber,
			);
			return () => {
				subscription.unsubscribe();
			};
		});
	}

	[SYMBOL_OBSERVABLE](): RxEventStream<T> {
		return this;
	}

	static fromObservableInput<T>(
		input: RxEventStreamInput<T>,
	): RxEventStream<T> {
		if (input instanceof RxEventStream) {
			return input;
		}
		return new RxEventStream(input);
	}

	// @ts-expect-error RxJS pipe overloads are intentionally narrowed to RxEventStream.
	override pipe(): RxEventStream<T>;
	override pipe<A>(op1: OperatorFunction<T, A>): RxEventStream<A>;
	override pipe<A, B>(
		op1: OperatorFunction<T, A>,
		op2: OperatorFunction<A, B>,
	): RxEventStream<B>;
	override pipe<A, B, C>(
		op1: OperatorFunction<T, A>,
		op2: OperatorFunction<A, B>,
		op3: OperatorFunction<B, C>,
	): RxEventStream<C>;
	override pipe<A, B, C, D>(
		op1: OperatorFunction<T, A>,
		op2: OperatorFunction<A, B>,
		op3: OperatorFunction<B, C>,
		op4: OperatorFunction<C, D>,
	): RxEventStream<D>;
	override pipe<A, B, C, D, E>(
		op1: OperatorFunction<T, A>,
		op2: OperatorFunction<A, B>,
		op3: OperatorFunction<B, C>,
		op4: OperatorFunction<C, D>,
		op5: OperatorFunction<D, E>,
	): RxEventStream<E>;
	override pipe<A, B, C, D, E, F>(
		op1: OperatorFunction<T, A>,
		op2: OperatorFunction<A, B>,
		op3: OperatorFunction<B, C>,
		op4: OperatorFunction<C, D>,
		op5: OperatorFunction<D, E>,
		op6: OperatorFunction<E, F>,
	): RxEventStream<F>;
	override pipe<A, B, C, D, E, F, G>(
		op1: OperatorFunction<T, A>,
		op2: OperatorFunction<A, B>,
		op3: OperatorFunction<B, C>,
		op4: OperatorFunction<C, D>,
		op5: OperatorFunction<D, E>,
		op6: OperatorFunction<E, F>,
		op7: OperatorFunction<F, G>,
	): RxEventStream<G>;
	override pipe<A, B, C, D, E, F, G, H>(
		op1: OperatorFunction<T, A>,
		op2: OperatorFunction<A, B>,
		op3: OperatorFunction<B, C>,
		op4: OperatorFunction<C, D>,
		op5: OperatorFunction<D, E>,
		op6: OperatorFunction<E, F>,
		op7: OperatorFunction<F, G>,
		op8: OperatorFunction<G, H>,
	): RxEventStream<H>;
	override pipe<A, B, C, D, E, F, G, H, I>(
		op1: OperatorFunction<T, A>,
		op2: OperatorFunction<A, B>,
		op3: OperatorFunction<B, C>,
		op4: OperatorFunction<C, D>,
		op5: OperatorFunction<D, E>,
		op6: OperatorFunction<E, F>,
		op7: OperatorFunction<F, G>,
		op8: OperatorFunction<G, H>,
		op9: OperatorFunction<H, I>,
	): RxEventStream<I>;
	override pipe<A, B, C, D, E, F, G, H, I>(
		op1: OperatorFunction<T, A>,
		op2: OperatorFunction<A, B>,
		op3: OperatorFunction<B, C>,
		op4: OperatorFunction<C, D>,
		op5: OperatorFunction<D, E>,
		op6: OperatorFunction<E, F>,
		op7: OperatorFunction<F, G>,
		op8: OperatorFunction<G, H>,
		op9: OperatorFunction<H, I>,
		...operations: OperatorFunction<any, any>[]
	): RxEventStream<unknown>;
	override pipe(
		...args: Parameters<Observable<T>["pipe"]>
	): RxEventStream<unknown> {
		const piped = super.pipe(...args);
		return RxEventStream.fromObservableInput(piped);
	}
}

export class RxEventSubject<T>
	extends Subject<T>
	implements EventSubjectTrait<T>
{
	[SYMBOL_OBSERVABLE](): RxEventStream<T> {
		return this.asObservable();
	}

	override asObservable(): RxEventStream<T> {
		return RxEventStream.fromObservableInput(super.asObservable());
	}
}

export class RxEventReplaySubject<T>
	extends ReplaySubject<T>
	implements EventSubjectTrait<T>
{
	[SYMBOL_OBSERVABLE](): RxEventStream<T> {
		return this.asObservable();
	}

	override asObservable(): RxEventStream<T> {
		return RxEventStream.fromObservableInput(super.asObservable());
	}
}
