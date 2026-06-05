import {
	animationFrameScheduler,
	asapScheduler,
	audit,
	auditTime,
	BehaviorSubject,
	concat,
	defer,
	distinctUntilChanged,
	EMPTY,
	fromEventPattern,
	type MonoTypeOperatorFunction,
	map,
	merge,
	type Observable,
	of,
	Subject,
	share,
	shareReplay,
	switchMap,
} from "rxjs";
import {
	type InteropObservableTrait,
	SYMBOL_OBSERVABLE,
	type WithInteropObservableTraitCompat,
} from "../compat";
import {
	type ReadableSignalTrait,
	type SignalOptions,
	type WritableSignalTrait,
} from "../signals/types";
import { RxEventStream } from "./event";

export interface RxSignalDirtyEvent<T> {
	epoch: number;
	signal: ReadableSignalTrait<T>;
}

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
	protected static currentContext: RxComputedSignal<any> | null = null;

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
		return RxEventStream.fromObservableInput(
			defer(() =>
				concat(
					of(this.get()),
					this.dirtyObservable().pipe(map(() => this.get())),
				),
			),
		);
	}

	abstract validateForEpoch(epoch: number): void;
}

export class RxStateSignal<T>
	extends RxSignal<T>
	implements InteropObservableTrait<T>, WritableSignalTrait<T>
{
	protected dirtySubject: Subject<RxSignalDirtyEvent<T>> = new Subject();
	protected value: BehaviorSubject<T>;

	protected constructor(
		initialValue: T,
		options: RxSignalOptions<T> | undefined,
	) {
		super(options);
		this.value = new BehaviorSubject(initialValue);
	}

	set(input: T): void {
		const changed = !this.equals(this.value.getValue(), input);
		this.value.next(input);
		if (changed) {
			this.valueEqVersion += 1;
		}
		RxSignal.globalEpoch += 1;
		this.dirtySubject.next({
			epoch: RxSignal.globalEpoch,
			signal: this,
		});
	}

	static fromInitialValue<T>(
		initialValue: T,
		options?: RxSignalOptions<T>,
	): RxStateSignalCompat<T> {
		return new RxStateSignal<T>(initialValue, options);
	}

	get(): T {
		const value = this.value.getValue();
		RxSignal.currentContext?.markDependency(this);
		return value;
	}

	override validateForEpoch(): void {}

	override dirtyObservable(): Observable<RxSignalDirtyEvent<T>> {
		return this.dirtySubject.asObservable();
	}

	override [SYMBOL_OBSERVABLE](): RxEventStream<T> {
		return RxEventStream.fromObservableInput(this.value.asObservable());
	}
}

export type RxStateSignalCompat<T> = WithInteropObservableTraitCompat<
	RxStateSignal<T>,
	T
>;

type AnyRxSignal = RxSignal<any> & { valueEqVersion: number };

type ComputedCacheState<T> =
	| { kind: "empty" }
	| { kind: "value"; value: T }
	| { kind: "error"; error: unknown };

function haveSameSourceKeys(
	left: ReadonlyMap<AnyRxSignal, number>,
	right: ReadonlyMap<AnyRxSignal, number>,
): boolean {
	if (left.size !== right.size) {
		return false;
	}
	const leftSources = left.keys();
	const rightSources = right.keys();
	while (true) {
		const leftSource = leftSources.next();
		const rightSource = rightSources.next();
		if (leftSource.done || rightSource.done) {
			return leftSource.done === rightSource.done;
		}
		if (leftSource.value !== rightSource.value) {
			return false;
		}
	}
}

export class RxComputedSignal<T> extends RxSignal<T> {
	protected cacheState: ComputedCacheState<T> = { kind: "empty" };
	protected sources: ReadonlyMap<AnyRxSignal, number> = new Map();
	protected sourcesSubject: BehaviorSubject<ReadonlyMap<AnyRxSignal, number>> =
		new BehaviorSubject(this.sources);
	private validatedEpoch = -1;
	private isComputing = false;
	private collectingSources: Map<AnyRxSignal, number> | null = null;
	private dirty$: Observable<RxSignalDirtyEvent<T>> | undefined;

	protected constructor(
		protected readonly computeFn: () => T,
		options: RxSignalOptions<T> | undefined,
	) {
		super(options);
	}

	markDependency(signal: RxSignal<any>): void {
		const source = signal as AnyRxSignal;
		this.collectingSources?.set(source, source.valueEqVersion);
	}

	protected cacheStatesEqual(
		left: ComputedCacheState<T>,
		right: ComputedCacheState<T>,
	): boolean {
		if (left.kind !== right.kind) {
			return false;
		}
		if (left.kind === "empty" || right.kind === "empty") {
			return false;
		}
		if (left.kind === "value" && right.kind === "value") {
			return this.equals(left.value, right.value);
		}
		if (left.kind === "error" && right.kind === "error") {
			return Object.is(left.error, right.error);
		}
		return false;
	}

	protected recompute(): void {
		if (this.isComputing) {
			throw new Error("Circular computed dependency detected");
		}
		const prevContext = RxSignal.currentContext;
		const prevCollectingSources = this.collectingSources;
		const nextSources = new Map<AnyRxSignal, number>();
		RxSignal.currentContext = this;
		this.collectingSources = nextSources;
		this.isComputing = true;
		let nextCacheState: ComputedCacheState<T>;
		try {
			const computed = this.computeFn();
			nextCacheState = { kind: "value", value: computed };
		} catch (error) {
			nextCacheState = { kind: "error", error };
		} finally {
			this.collectingSources = prevCollectingSources;
			RxSignal.currentContext = prevContext;
			this.isComputing = false;
		}
		const sourcesChanged = !haveSameSourceKeys(this.sources, nextSources);
		let cacheStateChanged: boolean;
		try {
			cacheStateChanged = !this.cacheStatesEqual(
				this.cacheState,
				nextCacheState,
			);
		} catch (error) {
			nextCacheState = { kind: "error", error };
			cacheStateChanged = !this.cacheStatesEqual(
				this.cacheState,
				nextCacheState,
			);
		}
		if (cacheStateChanged) {
			this.valueEqVersion += 1;
		}
		this.cacheState = nextCacheState;
		this.sources = nextSources;
		if (sourcesChanged) {
			this.sourcesSubject.next(nextSources);
		}
		if (nextCacheState.kind === "error") {
			throw nextCacheState.error;
		}
	}

	override validateForEpoch(epoch: number): void {
		if (this.validatedEpoch === epoch) {
			return;
		}
		try {
			if (this.cacheState.kind === "empty") {
				this.recompute();
				return;
			}
			for (const [source, version] of this.sources) {
				try {
					source.validateForEpoch(epoch);
				} catch {
					this.recompute();
					break;
				}
				if (source.valueEqVersion !== version) {
					this.recompute();
					break;
				}
			}
		} finally {
			this.validatedEpoch = epoch;
		}
	}

	override get(): T {
		this.validateForEpoch(RxSignal.globalEpoch);
		RxSignal.currentContext?.markDependency(this);
		switch (this.cacheState.kind) {
			case "value":
				return this.cacheState.value;
			case "error":
				throw this.cacheState.error;
			case "empty":
				throw new Error("Computed signal has not been initialized");
		}
	}

	override dirtyObservable(): Observable<RxSignalDirtyEvent<T>> {
		if (!this.dirty$) {
			this.dirty$ = defer(() => {
				this.validateForEpoch(RxSignal.globalEpoch);
				return this.sourcesSubject.asObservable().pipe(
					switchMap((sources) =>
						sources.size === 0
							? EMPTY
							: merge(
									...[...sources.keys()].map((source) =>
										source.dirtyObservable(),
									),
								).pipe(
									distinctUntilChanged(
										(left, right) => left.epoch === right.epoch,
									),
									map((dirtyDepEvent) => {
										return {
											epoch: dirtyDepEvent.epoch,
											signal: this,
										};
									}),
								),
					),
				);
			}).pipe(share());
		}
		return this.dirty$;
	}

	static computed<T>(
		fn: () => T,
		options?: RxSignalOptions<T>,
	): RxComputedSignalCompat<T> {
		return new RxComputedSignal<T>(fn, options);
	}
}

export type RxComputedSignalCompat<T> = WithInteropObservableTraitCompat<
	RxComputedSignal<T>,
	T
>;
