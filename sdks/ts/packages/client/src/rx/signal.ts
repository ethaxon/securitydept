import { BehaviorSubject, Observable, UnsubscriptionError } from "rxjs";
import {
	type InteropObservableTrait,
	SYMBOL_OBSERVABLE,
	type WithInteropObservableTraitCompat,
} from "../compat";
import { type WritableSignalTrait } from "../signals/types";
import { RxEventStream } from "./event";
import {
	RxSignal,
	type RxSignalDirtyEvent,
	type RxSignalDirtyObserver,
	type RxSignalOptions,
} from "./internal/reactive-system/base";

export {
	RxSignal,
	type RxSignalDirtyEvent,
	type RxSignalOptions,
	type RxSignalWatchCanceller,
	type RxSignalWatchOptions,
	type RxSignalWatchScheduler,
} from "./internal/reactive-system/base";
export class RxStateSignal<T>
	extends RxSignal<T>
	implements InteropObservableTrait<T>, WritableSignalTrait<T>
{
	protected dirtyListeners: Set<RxSignalDirtyObserver<T>> | undefined;
	private dirtySnapshot: RxSignalDirtyObserver<T>[] | undefined;
	private dirty$: Observable<RxSignalDirtyEvent<T>> | undefined;
	protected value: T;
	private valueSubject: BehaviorSubject<T> | undefined;

	protected constructor(
		initialValue: T,
		options: RxSignalOptions<T> | undefined,
	) {
		super(options);
		this.value = initialValue;
	}

	set(input: T): void {
		const changed = !this.equals(this.value, input);
		this.value = input;
		if (changed) {
			this.valueEqVersion += 1;
		}
		RxSignal.globalEpoch += 1;
		const epoch = RxSignal.globalEpoch;
		// Commit versions before synchronous observers can read cached computed values.
		this.valueSubject?.next(input);
		const listeners = this.dirtyListeners;
		if (listeners?.size) {
			let snapshot = this.dirtySnapshot;
			if (!snapshot) {
				snapshot = [...listeners];
				this.dirtySnapshot = snapshot;
			}
			RxSignal.dispatchDirty(epoch, () => {
				const event = { epoch, signal: this };
				for (const listener of snapshot) {
					listener.next(event);
				}
			});
		}
	}

	static fromInitialValue<T>(
		initialValue: T,
		options?: RxSignalOptions<T>,
	): RxStateSignalCompat<T> {
		return new RxStateSignal<T>(initialValue, options);
	}

	get(): T {
		const value = this.value;
		RxSignal.currentContext?.markDependency(this);
		return value;
	}

	override validateForEpoch(): void {}

	override dirtyObservable(): Observable<RxSignalDirtyEvent<T>> {
		this.dirty$ ??= new Observable((observer) =>
			this.listenDirty({
				next: (event) => observer.next(event),
				error: (error) => observer.error(error),
			}),
		);
		return this.dirty$;
	}

	protected override listenDirty(
		listener: RxSignalDirtyObserver<T>,
	): () => void {
		this.dirtyListeners ??= new Set();
		this.dirtySnapshot = undefined;
		this.dirtyListeners.add(listener);
		return () => {
			this.dirtySnapshot = undefined;
			this.dirtyListeners?.delete(listener);
		};
	}

	override [SYMBOL_OBSERVABLE](): RxEventStream<T> {
		return new RxEventStream((observer) => {
			this.valueSubject ??= new BehaviorSubject(this.value);
			const subject = this.valueSubject;
			const subscription = subject.subscribe(observer);
			return () => {
				subscription.unsubscribe();
				if (!subject.observed && this.valueSubject === subject) {
					this.valueSubject = undefined;
				}
			};
		});
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
	private dirtyListeners: Set<RxSignalDirtyObserver<T>> | undefined;
	private dirtySnapshot: RxSignalDirtyObserver<T>[] | undefined;
	private dirtyStops: Map<AnyRxSignal, () => void> | undefined;
	private dirtyConnection = 0;
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
		const previousSources = this.sources;
		// Key changes only matter to the optional observable dependency graph.
		const sourcesChanged = this.dirtyListeners?.size
			? !haveSameSourceKeys(previousSources, nextSources)
			: undefined;
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
		// A custom equality function can attach an observer during comparison.
		if (
			this.dirtyListeners?.size &&
			(sourcesChanged ?? !haveSameSourceKeys(previousSources, nextSources))
		) {
			try {
				this.syncDirtySources(nextSources);
			} catch (error) {
				this.failDirtySources(error);
			}
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
		this.dirty$ ??= new Observable((observer) =>
			this.listenDirty({
				next: (event) => observer.next(event),
				error: (error) => observer.error(error),
			}),
		);
		return this.dirty$;
	}

	protected override listenDirty(
		listener: RxSignalDirtyObserver<T>,
	): () => void {
		this.validateForEpoch(RxSignal.globalEpoch);
		this.dirtyListeners ??= new Set();
		const first = this.dirtyListeners.size === 0;
		this.dirtySnapshot = undefined;
		this.dirtyListeners.add(listener);
		if (first) {
			this.dirtyConnection++;
			try {
				this.syncDirtySources(this.sources);
			} catch (error) {
				this.dirtySnapshot = undefined;
				this.dirtyListeners.delete(listener);
				if (!this.dirtyListeners.size) {
					this.disconnectDirtySources();
				}
				throw error;
			}
		}
		return () => {
			this.dirtySnapshot = undefined;
			this.dirtyListeners?.delete(listener);
			if (!this.dirtyListeners?.size) {
				this.disconnectDirtySources();
			}
		};
	}

	private disconnectDirtySources(): void {
		this.dirtyConnection++;
		const stops = this.dirtyStops;
		this.dirtyStops = undefined;
		let errors: unknown[] | undefined;
		for (const stop of stops?.values() ?? []) {
			try {
				stop();
			} catch (error) {
				errors ??= [];
				errors.push(
					...(error instanceof UnsubscriptionError ? error.errors : [error]),
				);
			}
		}
		if (errors) {
			throw new UnsubscriptionError(errors);
		}
	}

	private failDirtySources(error: unknown): void {
		const listeners = [...(this.dirtyListeners ?? [])];
		this.dirtyListeners?.clear();
		this.dirtySnapshot = undefined;
		// Reset before an error callback can reconnect; notification errors do not poison snapshots.
		let notificationError = error;
		try {
			this.disconnectDirtySources();
		} catch (cleanupError) {
			notificationError = new AggregateError(
				[error, cleanupError],
				"Dirty propagation and cleanup failed",
			);
		}
		for (const listener of listeners) {
			listener.error(notificationError);
		}
	}

	private syncDirtySources(sources: ReadonlyMap<AnyRxSignal, number>): void {
		this.dirtyStops ??= new Map();
		const stops = this.dirtyStops;
		const connection = this.dirtyConnection;
		for (const [source, stop] of stops) {
			if (!sources.has(source)) {
				stop();
				stops.delete(source);
			}
			if (this.dirtyConnection !== connection) {
				return;
			}
		}
		for (const source of sources.keys()) {
			if (stops.has(source)) {
				continue;
			}
			let active = true;
			const detach = RxSignal.listenToDirty(
				source,
				{
					next: (event) => {
						if (
							!active ||
							this.dirtyConnection !== connection ||
							!this.dirtyListeners?.size ||
							!this.acceptDirtyEpoch(event.epoch)
						) {
							return;
						}
						const dirtyEvent = { epoch: event.epoch, signal: this };
						let snapshot = this.dirtySnapshot;
						if (!snapshot) {
							snapshot = [...this.dirtyListeners];
							this.dirtySnapshot = snapshot;
						}
						for (const listener of snapshot) {
							listener.next(dirtyEvent);
						}
					},
					error: (error) => {
						if (!active || this.dirtyConnection !== connection) {
							return;
						}
						this.failDirtySources(error);
					},
				},
				source.dirtyObservable === RxStateSignal.prototype.dirtyObservable ||
					source.dirtyObservable === RxComputedSignal.prototype.dirtyObservable,
			);
			const stop = () => {
				active = false;
				detach();
			};
			if (
				!active ||
				this.dirtyConnection !== connection ||
				!this.dirtyListeners?.size
			) {
				stop();
				return;
			}
			stops.set(source, stop);
		}
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
