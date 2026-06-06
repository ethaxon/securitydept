import {
	catchError,
	distinctUntilChanged,
	filter,
	finalize,
	firstValueFrom,
	from,
	map,
	merge,
	NEVER,
	type Observable,
	type ObservableInput,
	of,
	switchMap,
	take,
	takeUntil,
} from "rxjs";
import {
	type CancellationTokenTrait,
	createCancellationTokenSource,
} from "../cancellation";
import {
	type InteropObservableTrait,
	SYMBOL_DISPOSE,
	SYMBOL_OBSERVABLE,
	type WithInteropObservableTraitCompat,
} from "../compat";
import { ResourceError } from "../signals/error";
import {
	ResourceSnapshotUpdateKind,
	reduceResourceSnapshot,
} from "../signals/resource-snapshot";
import {
	type ReadableSignalTrait,
	type ResourceErrorSnapshot,
	type ResourceLoadingErrorSnapshot,
	type ResourceReloadingSnapshot,
	type ResourceResolvedSnapshot,
	type ResourceSnapshot,
	ResourceStatus,
	type ResourceTrait,
	type ResourceWhenValueOptions,
} from "../signals/types";
import { type RxEventStream } from "./event";
import {
	RxComputedSignal,
	type RxComputedSignalCompat,
	RxStateSignal,
	type RxStateSignalCompat,
} from "./signal";

export {
	type ResourceErrorSnapshot,
	type ResourceIdleSnapshot,
	type ResourceLoadingErrorSnapshot,
	type ResourceLoadingSnapshot,
	type ResourceReloadingSnapshot,
	type ResourceResolvedSnapshot,
	type ResourceSnapshot,
	ResourceStatus,
	type ResourceTrait,
	type ResourceWhenValueOptions,
} from "../signals/types";

export interface RxResourceStreamContext<T, R> {
	readonly request: R;
	readonly previous: ResourceSnapshot<T>;
	readonly cancellationToken: CancellationTokenTrait;
}

export interface RxResourceOptions<T, R = undefined> {
	readonly request?: ReadableSignalTrait<R | undefined> | (() => R | undefined);
	readonly stream: (
		context: RxResourceStreamContext<T, R>,
	) => ObservableInput<T>;
}

abstract class RxResourceBase<T>
	implements ResourceTrait<T>, InteropObservableTrait<ResourceSnapshot<T>>
{
	abstract readonly snapshot: ReadableSignalTrait<ResourceSnapshot<T>>;
	readonly value: RxComputedSignalCompat<T>;
	readonly status: RxComputedSignalCompat<ResourceStatus>;
	readonly error: RxComputedSignalCompat<unknown | undefined>;
	readonly isLoading: RxComputedSignalCompat<boolean>;
	protected readonly destroyed = RxStateSignal.fromInitialValue(false);
	protected readonly destroyed$ = from(this.destroyed).pipe(
		filter((value): value is true => value),
		take(1),
	);

	protected constructor() {
		this.value = RxComputedSignal.computed(() => {
			const snapshot = this.snapshot.get();
			if (
				snapshot.status === ResourceStatus.Resolved ||
				snapshot.status === ResourceStatus.Reloading
			) {
				return snapshot.value;
			}
			if (
				snapshot.status === ResourceStatus.LoadingError ||
				snapshot.status === ResourceStatus.Error
			) {
				throw snapshot.error;
			}
			throw ResourceError.valueUnavailable({ status: snapshot.status });
		});
		this.status = RxComputedSignal.computed(() => this.snapshot.get().status);
		this.error = RxComputedSignal.computed(() => {
			const snapshot = this.snapshot.get();
			return snapshot.status === ResourceStatus.LoadingError ||
				snapshot.status === ResourceStatus.Error
				? snapshot.error
				: undefined;
		});
		this.isLoading = RxComputedSignal.computed(() => {
			const status = this.snapshot.get().status;
			return (
				status === ResourceStatus.Loading || status === ResourceStatus.Reloading
			);
		});
	}

	hasValue(): boolean {
		const status = this.snapshot.get().status;
		return (
			status === ResourceStatus.Resolved || status === ResourceStatus.Reloading
		);
	}

	async whenValue(options?: ResourceWhenValueOptions): Promise<T> {
		options?.cancellationToken?.throwIfCancellationRequested();
		if (this.destroyed.get()) {
			throw ResourceError.disposed();
		}
		const current = this.snapshot.get();
		if (
			current.status === ResourceStatus.Resolved ||
			current.status === ResourceStatus.Reloading
		) {
			return current.value;
		}
		if (
			current.status === ResourceStatus.LoadingError ||
			current.status === ResourceStatus.Error
		) {
			throw current.error;
		}

		const snapshot = await firstValueFrom(
			merge(
				from(this.snapshot).pipe(
					filter(
						(
							snapshot,
						): snapshot is
							| ResourceResolvedSnapshot<T>
							| ResourceReloadingSnapshot<T>
							| ResourceLoadingErrorSnapshot
							| ResourceErrorSnapshot<T> =>
							snapshot.status === ResourceStatus.Resolved ||
							snapshot.status === ResourceStatus.Reloading ||
							snapshot.status === ResourceStatus.LoadingError ||
							snapshot.status === ResourceStatus.Error,
					),
				),
				this.destroyed$.pipe(
					map(() => {
						throw ResourceError.disposed();
					}),
				),
				(options?.cancellationToken
					? from(options.cancellationToken)
					: NEVER
				).pipe(
					map(({ cancellationError }) => {
						throw cancellationError;
					}),
				),
			),
		);

		if (
			snapshot.status === ResourceStatus.LoadingError ||
			snapshot.status === ResourceStatus.Error
		) {
			throw snapshot.error;
		}
		return snapshot.value;
	}

	dispose(): void {
		this.destroyed.set(true);
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	[SYMBOL_OBSERVABLE](): RxEventStream<ResourceSnapshot<T>> {
		return this.snapshot[SYMBOL_OBSERVABLE]() as RxEventStream<
			ResourceSnapshot<T>
		>;
	}
}

export class RxResource<T, R = undefined> extends RxResourceBase<T> {
	readonly snapshot: RxStateSignalCompat<ResourceSnapshot<T>>;

	constructor(private readonly options: RxResourceOptions<T, R>) {
		super();
		this.snapshot = RxStateSignal.fromInitialValue<ResourceSnapshot<T>>({
			status: ResourceStatus.Idle,
		});
		this.connect();
	}

	private connect(): void {
		const configuredRequest = this.options.request;
		const requestObservable: Observable<R | undefined> =
			configuredRequest && typeof configuredRequest !== "function"
				? from(configuredRequest).pipe(
						distinctUntilChanged(
							configuredRequest.equals as (
								left: R | undefined,
								right: R | undefined,
							) => boolean,
						),
					)
				: of(
						configuredRequest && typeof configuredRequest === "function"
							? configuredRequest()
							: (undefined as R),
					);
		const requestControlsLoading = configuredRequest !== undefined;

		requestObservable
			.pipe(
				switchMap((request) => {
					if (requestControlsLoading && request === undefined) {
						return of<ResourceSnapshot<T>>({ status: ResourceStatus.Idle });
					}
					const previous = this.snapshot.get();
					const loadingSnapshot = reduceResourceSnapshot(previous, {
						kind: ResourceSnapshotUpdateKind.Load,
					});
					this.snapshot.set(loadingSnapshot);

					const loadCancellation = createCancellationTokenSource();
					return from(
						this.options.stream({
							request: request as R,
							previous,
							cancellationToken: loadCancellation.token,
						}),
					).pipe(
						map((value) =>
							reduceResourceSnapshot(loadingSnapshot, {
								kind: ResourceSnapshotUpdateKind.Resolve,
								value,
							}),
						),
						catchError((error: unknown) =>
							of(
								reduceResourceSnapshot(loadingSnapshot, {
									kind: ResourceSnapshotUpdateKind.Fail,
									error,
								}),
							),
						),
						finalize(() => loadCancellation.cancel(ResourceError.disposed())),
					);
				}),
				takeUntil(this.destroyed$),
			)
			.subscribe((snapshot) => this.snapshot.set(snapshot));
	}

	static create<T, R = undefined>(
		options: RxResourceOptions<T, R>,
	): RxResource<T, R> {
		return new RxResource(options);
	}
}

class RxSnapshotResource<T> extends RxResourceBase<T> {
	readonly snapshot: RxComputedSignalCompat<ResourceSnapshot<T>>;

	constructor(source: () => ResourceSnapshot<T>) {
		super();
		this.snapshot = RxComputedSignal.computed(source);
	}
}

export function resourceFromSnapshots<T>(
	source: () => ResourceSnapshot<T>,
): WithInteropObservableTraitCompat<ResourceTrait<T>, ResourceSnapshot<T>> {
	return new RxSnapshotResource(source);
}

export function mapResource<T, U>(
	source: ResourceTrait<T>,
	mapValue: (value: T) => U,
): WithInteropObservableTraitCompat<ResourceTrait<U>, ResourceSnapshot<U>> {
	return resourceFromSnapshots(() => {
		const snapshot = source.snapshot.get();
		switch (snapshot.status) {
			case ResourceStatus.Idle:
			case ResourceStatus.Loading:
			case ResourceStatus.LoadingError:
				return snapshot;
			case ResourceStatus.Reloading:
			case ResourceStatus.Resolved:
				return { status: snapshot.status, value: mapValue(snapshot.value) };
			case ResourceStatus.Error:
				return {
					status: ResourceStatus.Error,
					value: mapValue(snapshot.value),
					error: snapshot.error,
				};
		}
	});
}

export function rxResource<T, R = undefined>(
	options: RxResourceOptions<T, R>,
): WithInteropObservableTraitCompat<ResourceTrait<T>, ResourceSnapshot<T>> {
	return new RxResource(options);
}
