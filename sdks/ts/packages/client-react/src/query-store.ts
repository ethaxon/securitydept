import {
	ClientError,
	ClientErrorKind,
	createSignal,
	type DisposableTrait,
	type EventStreamTrait,
	SecurityDeptOptional,
	SecuritydeptDestroyRef,
	type SecuritydeptProvider,
	SYMBOL_DISPOSE,
	TIME_TRAIT_TOKEN,
	type TimeTrait,
	type ToEventStreamInput,
	type WritableSignalTrait,
} from "@securitydept/client";
import {
	createAsyncSchedulerWithTimestampProvider,
	RxEventStream,
	RxEventSubject,
	RxStateSignal,
} from "@securitydept/client/rx";
import {
	combineLatest,
	defer,
	filter,
	finalize,
	firstValueFrom,
	from,
	map,
	NEVER,
	type SchedulerLike,
	skip,
	switchMap,
	take,
	takeUntil,
	timer,
} from "rxjs";
import { useSecuritydeptContext } from "./injection/index";

const QUERY_STORE_ERROR_SOURCE = "client-react.query-store";

export type QueryStoreKeyValue =
	| null
	| boolean
	| number
	| string
	| readonly QueryStoreKeyValue[]
	| { readonly [key: string]: QueryStoreKeyValue };

export type QueryStoreKey = readonly QueryStoreKeyValue[];

export interface QueryStoreOptions {
	readonly time: TimeTrait;
	readonly gcTimeMs?: number;
}

export interface ProvideQueryStoreOptions {
	readonly gcTimeMs?: number;
}

/** @internal */
export const QueryResultStatus = {
	Pending: "pending",
	Resolved: "resolved",
	Error: "error",
} as const;

/** @internal */
export type QueryResult<T> =
	| {
			readonly status: typeof QueryResultStatus.Pending;
			readonly promise: Promise<T>;
	  }
	| {
			readonly status: typeof QueryResultStatus.Resolved;
			readonly value: T;
	  }
	| {
			readonly status: typeof QueryResultStatus.Error;
			readonly error: unknown;
	  };

/** @internal */
export type QueryInput<T> = ToEventStreamInput<T>;

/** @internal */
export interface QuerySource<T> {
	readonly input: QueryInput<T>;
	readonly cancel: VoidFunction;
}

/** @internal */
export interface QueryStoreQueryOptions<T> {
	readonly hash: string;
	readonly source: () => QuerySource<T>;
	readonly gcTimeMs?: number;
	readonly retainWhilePending?: boolean;
}

interface ResolvedQueryOptions {
	readonly gcTimeMs: number;
	readonly retainWhilePending: boolean;
}

export class QueryStore implements DisposableTrait {
	static readonly defaultOptions = Object.freeze({
		gcTimeMs: 300_000,
	});

	private readonly queries = new Map<string, Query<unknown>>();
	private readonly weakKeyIds = new WeakMap<object, string>();
	private readonly scheduler: SchedulerLike;
	private readonly gcTimeMs: number;
	private nextWeakKeyId = 0;
	private disposed = false;

	constructor(options: QueryStoreOptions) {
		this.scheduler = createAsyncSchedulerWithTimestampProvider(options.time);
		this.gcTimeMs = validateGcTime(
			options.gcTimeMs ?? QueryStore.defaultOptions.gcTimeMs,
		);
	}

	getWeakKeyId(value: object): string {
		const existing = this.weakKeyIds.get(value);
		if (existing !== undefined) {
			return existing;
		}
		const id = `weak_${++this.nextWeakKeyId}`;
		this.weakKeyIds.set(value, id);
		return id;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		for (const query of this.queries.values()) {
			query.dispose();
		}
		this.queries.clear();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	/** @internal */
	getOrCreateQuery<T>(options: QueryStoreQueryOptions<T>): Query<T> {
		const existing = this.queries.get(options.hash) as Query<T> | undefined;
		const resolvedOptions = {
			gcTimeMs: validateGcTime(options.gcTimeMs ?? this.gcTimeMs),
			retainWhilePending: options.retainWhilePending ?? true,
		};
		if (existing) {
			existing.updateOptions(resolvedOptions);
			return existing;
		}
		const query = new Query(
			options.hash,
			options.source(),
			resolvedOptions,
			this.scheduler,
		);
		this.queries.set(options.hash, query as Query<unknown>);
		query.garbageCollected.subscribe({
			next: () => this.removeQuery(query as unknown as Query<unknown>),
		});
		return query;
	}

	private removeQuery(query: Query<unknown>): void {
		if (this.queries.get(query.hash) !== query) {
			return;
		}
		this.queries.delete(query.hash);
		query.dispose();
	}
}

export function provideQueryStore(
	options: ProvideQueryStoreOptions = {},
): readonly SecuritydeptProvider[] {
	return [
		{
			provide: QueryStore,
			useFactory: (
				time: TimeTrait,
				destroyRef: SecuritydeptDestroyRef | null,
			) => {
				const queryStore = new QueryStore({
					time,
					gcTimeMs: options.gcTimeMs,
				});
				destroyRef?.onDestroy(() => queryStore.dispose());
				return queryStore;
			},
			deps: [
				TIME_TRAIT_TOKEN,
				[new SecurityDeptOptional(), SecuritydeptDestroyRef],
			],
		} satisfies SecuritydeptProvider,
	];
}

export function useQueryStore(): QueryStore {
	return useSecuritydeptContext().get(QueryStore);
}

/** @internal */
export class QueryObserver<T> {
	readonly subscribe = (listener: () => void): (() => void) => {
		const subscription = this.query().changes.subscribe({ next: listener });
		return subscription.unsubscribe.bind(subscription);
	};
	readonly getSnapshot = (): QueryResult<T> => this.query().getResult();
	readonly getServerSnapshot = (): QueryResult<T> => this.query().getResult();

	constructor(
		private readonly store: QueryStore,
		private readonly options: QueryStoreQueryOptions<T>,
	) {}

	private query(): Query<T> {
		return this.store.getOrCreateQuery(this.options);
	}
}

class Query<T> implements DisposableTrait {
	readonly changes: EventStreamTrait<void>;
	readonly garbageCollected: EventStreamTrait<void>;
	private readonly state: WritableSignalTrait<QueryResult<T>>;
	private readonly options: WritableSignalTrait<ResolvedQueryOptions>;
	private readonly subscriberCount = createSignal<number>(0);
	private readonly garbageCollectedSubject = new RxEventSubject<void>();
	private readonly destroyed = createSignal<boolean>(false);
	private readonly destroyed$ = from(this.destroyed).pipe(
		filter((destroyed) => destroyed),
		take(1),
	);

	constructor(
		readonly hash: string,
		private readonly source: QuerySource<T>,
		options: ResolvedQueryOptions,
		private readonly scheduler: SchedulerLike,
	) {
		this.options = RxStateSignal.fromInitialValue(options);
		this.garbageCollected = this.garbageCollectedSubject.asObservable();

		const pendingPromise = firstValueFrom(
			RxEventStream.fromObservableInput(source.input).pipe(
				takeUntil(this.destroyed$),
			),
		);
		this.state = RxStateSignal.fromInitialValue<QueryResult<T>>({
			status: QueryResultStatus.Pending,
			promise: pendingPromise,
		});

		this.changes = RxEventStream.fromObservableInput(
			defer(() => {
				this.subscriberCount.set(this.subscriberCount.get() + 1);
				return from(this.state).pipe(
					skip(1),
					map(() => undefined),
					takeUntil(this.destroyed$),
					finalize(() => {
						this.subscriberCount.set(this.subscriberCount.get() - 1);
					}),
				);
			}),
		);
		combineLatest([
			from(this.subscriberCount),
			from(this.state),
			from(this.options),
		])
			.pipe(
				switchMap(([subscriberCount, state, gcOptions]) => {
					if (
						subscriberCount !== 0 ||
						(state.status === QueryResultStatus.Pending &&
							gcOptions.retainWhilePending) ||
						gcOptions.gcTimeMs === Number.POSITIVE_INFINITY
					) {
						return NEVER;
					}
					return timer(gcOptions.gcTimeMs, this.scheduler).pipe(
						map(() => undefined),
					);
				}),
				takeUntil(this.destroyed$),
			)
			.subscribe({
				next: () => this.garbageCollectedSubject.next(),
			});

		pendingPromise.then(
			(value) => {
				this.state.set({ status: QueryResultStatus.Resolved, value });
			},
			(error) => {
				this.state.set({ status: QueryResultStatus.Error, error });
			},
		);
	}

	updateOptions(options: ResolvedQueryOptions): void {
		const current = this.options.get();
		this.options.set({
			gcTimeMs: Math.max(current.gcTimeMs, options.gcTimeMs),
			retainWhilePending:
				current.retainWhilePending || options.retainWhilePending,
		});
	}

	getResult(): QueryResult<T> {
		return this.state.get();
	}

	dispose(): void {
		this.destroyed.set(true);
		this.source.cancel();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}

function validateGcTime(gcTimeMs: number): number {
	if (typeof gcTimeMs !== "number" || Number.isNaN(gcTimeMs) || gcTimeMs < 0) {
		throw invalidQueryConfiguration(
			"react.query.invalid_gc_time",
			"QueryStore gcTimeMs must be a non-negative number.",
		);
	}
	return gcTimeMs;
}

/** @internal */
export function hashQueryStoreKey(key: QueryStoreKey): string {
	const ancestors = new Set<object>();
	const normalize = (value: unknown): QueryStoreKeyValue => {
		if (
			value === null ||
			typeof value === "boolean" ||
			typeof value === "string"
		) {
			return value;
		}
		if (typeof value === "number") {
			if (!Number.isFinite(value)) {
				throw invalidQueryKey();
			}
			return value;
		}
		if (typeof value !== "object") {
			throw invalidQueryKey();
		}
		if (ancestors.has(value)) {
			throw invalidQueryKey();
		}
		ancestors.add(value);
		try {
			if (Array.isArray(value)) {
				return value.map(normalize);
			}
			const prototype = Object.getPrototypeOf(value);
			if (
				(prototype !== Object.prototype && prototype !== null) ||
				Object.getOwnPropertySymbols(value).length !== 0
			) {
				throw invalidQueryKey();
			}
			const normalized: Record<string, QueryStoreKeyValue> =
				Object.create(null);
			for (const property of Object.keys(value).sort()) {
				normalized[property] = normalize(
					(value as Record<string, unknown>)[property],
				);
			}
			return normalized;
		} finally {
			ancestors.delete(value);
		}
	};
	return JSON.stringify(normalize(key));
}

function invalidQueryKey(): ClientError {
	return invalidQueryConfiguration(
		"react.query.invalid_key",
		"Query keys must contain only finite JSON-compatible values.",
	);
}

function invalidQueryConfiguration(code: string, message: string): ClientError {
	return new ClientError({
		kind: ClientErrorKind.Configuration,
		code,
		message,
		source: QUERY_STORE_ERROR_SOURCE,
	});
}
