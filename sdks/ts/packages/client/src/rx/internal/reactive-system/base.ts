import {
	animationFrameScheduler,
	asapScheduler,
	audit,
	auditTime,
	fromEventPattern,
	type MonoTypeOperatorFunction,
	map,
	type Observable,
	type Observer,
	shareReplay,
} from "rxjs";
import {
	type InteropObservableTrait,
	SYMBOL_OBSERVABLE,
} from "../../../compat";
import {
	type ReadableSignalTrait,
	type SignalOptions,
} from "../../../signals/types";
import { RxEventStream } from "../../event";

export interface RxSignalDirtyEvent<T> {
	epoch: number;
	signal: ReadableSignalTrait<T>;
}

export type RxSignalDirtyObserver<T> = Pick<
	Observer<RxSignalDirtyEvent<T>>,
	"next" | "error"
>;

export type RxSignalOptions<T> = SignalOptions<T>;

export type RxSignalWatchScheduler<THandle = unknown> = (
	flush: () => void,
) => THandle;

export type RxSignalWatchCanceller<THandle = unknown> = (
	handle: THandle,
) => void;

export interface RxSignalWatchOptions {
	schedule: RxSignalWatchScheduler;
	cancel?: RxSignalWatchCanceller;
}

function watchOptionsToAuditOperator<T>(
	options: RxSignalWatchOptions,
): MonoTypeOperatorFunction<T> {
	if (options.schedule === globalThis.queueMicrotask) {
		return auditTime(0, asapScheduler);
	}
	if (
		options.schedule === globalThis.requestAnimationFrame &&
		options.cancel === globalThis.cancelAnimationFrame
	) {
		return auditTime(0, animationFrameScheduler);
	}
	return audit(() =>
		fromEventPattern<void>(
			(handler) => options.schedule(() => handler()),
			(_handler, handle) => {
				if (options.cancel) {
					options.cancel(handle);
				} else if (typeof handle === "function") {
					handle();
				}
			},
		),
	);
}

export abstract class RxSignal<T>
	implements ReadableSignalTrait<T>, InteropObservableTrait<T>
{
	protected static globalEpoch = 0;
	protected static currentContext: {
		markDependency(signal: RxSignal<any>): void;
	} | null = null;
	private static dirtyFrame:
		| { epoch: number; notified?: Set<RxSignal<any>> }
		| undefined;

	protected valueEqVersion = 0;

	readonly equals: (a: unknown, b: unknown) => boolean;
	abstract get(): T;
	abstract dirtyObservable(): Observable<RxSignalDirtyEvent<T>>;

	protected constructor(options: RxSignalOptions<T> | undefined) {
		this.equals = (options?.equals ?? Object.is) as (
			left: unknown,
			right: unknown,
		) => boolean;
	}

	watchStream(
		options: RxSignalWatchOptions = { schedule: globalThis.queueMicrotask },
	): RxEventStream<void> {
		return RxEventStream.fromObservableInput(
			this.dirtyObservable().pipe(
				watchOptionsToAuditOperator(options),
				map(() => undefined),
				shareReplay({ bufferSize: 1, refCount: true }),
			),
		);
	}

	[SYMBOL_OBSERVABLE](): RxEventStream<T> {
		return new RxEventStream((observer) => {
			// Establish listening before replay so a replay callback can write again.
			this.get();
			const subscription = this.dirtyObservable().subscribe({
				next: () => {
					try {
						observer.next(this.get());
					} catch (error) {
						observer.error(error);
					}
				},
				error: (error) => observer.error(error),
				complete: () => observer.complete(),
			});
			try {
				observer.next(this.get());
			} catch (error) {
				subscription.unsubscribe();
				observer.error(error);
			}
			return () => subscription.unsubscribe();
		});
	}

	protected static dispatchDirty(epoch: number, publish: () => void): void {
		const previous = RxSignal.dirtyFrame;
		RxSignal.dirtyFrame = { epoch };
		try {
			publish();
		} finally {
			RxSignal.dirtyFrame = previous;
		}
	}

	protected acceptDirtyEpoch(epoch: number): boolean {
		const frame = RxSignal.dirtyFrame;
		if (!frame || frame.epoch !== epoch) {
			return true;
		}
		frame.notified ??= new Set();
		if (frame.notified.has(this)) {
			return false;
		}
		frame.notified.add(this);
		return true;
	}

	// Native SDK nodes override this; external RxSignal subclasses retain their observable protocol.
	protected listenDirty(listener: RxSignalDirtyObserver<T>): () => void {
		const subscription = this.dirtyObservable().subscribe(listener);
		return () => subscription.unsubscribe();
	}

	protected static listenToDirty<T>(
		signal: RxSignal<T>,
		listener: RxSignalDirtyObserver<T>,
		native: boolean,
	): () => void {
		if (native) {
			return signal.listenDirty(listener);
		}
		const subscription = signal.dirtyObservable().subscribe(listener);
		return () => subscription.unsubscribe();
	}

	abstract validateForEpoch(epoch: number): void;
}
