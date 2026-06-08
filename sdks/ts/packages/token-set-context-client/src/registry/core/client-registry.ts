import {
	createCancellationTokenSource,
	type DisposableTrait,
	type ReadableSignalTrait,
	type ResourceTrait,
	readonlySignal,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import { RxEventStream, RxStateSignal } from "@securitydept/client/rx";
import {
	catchError,
	combineLatest,
	EMPTY,
	filter,
	from,
	fromEventPattern,
	NEVER,
	of,
	Subject,
	switchMap,
	take,
	takeUntil,
	tap,
} from "rxjs";
import { type BaseOidcModeClient } from "../../orchestration/client/base-client";
import {
	matchesTokenSetClientQuery,
	type TokenSetClientQueryOptions,
} from "../contracts/query";
import {
	type CreateTokenSetClientRegistryOptions,
	TokenSetClientInitializationMode,
	type TokenSetClientReadyRecordView,
	type TokenSetClientRecordView,
	type TokenSetClientRegistryEntry,
	type TokenSetClientRegistryEvent,
	type TokenSetClientResourceOptions,
} from "../contracts/types";
import { TokenSetClientRecord } from "./client-record";
import {
	TokenSetClientRegistryError,
	TokenSetClientRegistryErrorCode,
} from "./error";

export class TokenSetClientRegistry<
	TClient extends DisposableTrait = BaseOidcModeClient,
> implements DisposableTrait
{
	private readonly _destroyed = RxStateSignal.fromInitialValue(false);
	private readonly destroyed$ = from(this._destroyed).pipe(
		filter((value): value is true => value),
		take(1),
	);

	private readonly recordsSignal = RxStateSignal.fromInitialValue(
		new Map<string, TokenSetClientRecord<TClient>>(),
	);
	private readonly eventsSubject = new Subject<
		TokenSetClientRegistryEvent<TClient>
	>();
	private readonly entriesSignal = RxStateSignal.fromInitialValue<
		readonly TokenSetClientRecordView<TClient>[]
	>([]);

	readonly events = RxEventStream.fromObservableInput(this.eventsSubject);
	readonly entries = readonlySignal(this.entriesSignal);

	private readonly initializeTrigger = new Subject<string>();

	constructor(private readonly options: CreateTokenSetClientRegistryOptions) {
		this.destroyed$.subscribe(() => {
			for (const key of [...this.recordsSignal.get().keys()]) {
				this.unregister(key);
			}
		});
		from(this.recordsSignal)
			.pipe(
				switchMap((records) => {
					const recordList = [...records.values()];
					return recordList.length === 0
						? of([] as TokenSetClientRecordView<TClient>[])
						: combineLatest(recordList.map((record) => from(record.view)));
				}),
				takeUntil(this.destroyed$),
			)
			.subscribe((entries) => {
				this.entriesSignal.set(entries);
			});
	}

	register(entry: TokenSetClientRegistryEntry<TClient>): void {
		const clientKey = entry.meta.clientKey;
		if (this.recordsSignal.get().has(clientKey)) {
			throw new TokenSetClientRegistryError({
				code: TokenSetClientRegistryErrorCode.ClientRegistered,
				clientKey,
			});
		}

		const record = TokenSetClientRecord.fromRegistered(entry);
		this.updateRecords((records) => {
			records.set(clientKey, record);
		});
		from(record.view)
			.pipe(takeUntil(record.destroyed$))
			.subscribe(() => {
				this.eventsSubject.next(record.toEvent());
			});

		this.initializeTrigger
			.pipe(
				filter((id) => id === record.id),
				takeUntil(record.destroyed$),
				take(1),
				switchMap(() => {
					const cancellation = createCancellationTokenSource();
					return from(
						record.initialize({ cancellationToken: cancellation.token }),
					).pipe(
						catchError(() => EMPTY),
						takeUntil(record.destroyed$.pipe(tap(() => cancellation.cancel()))),
					);
				}),
			)
			.subscribe();

		if (
			record.entry.meta.initialization ===
			TokenSetClientInitializationMode.Immediate
		) {
			this.initializeTrigger.next(record.id);
		} else if (
			record.entry.meta.initialization === TokenSetClientInitializationMode.Idle
		) {
			const idleCallback = this.options.environment.idleCallback;
			(idleCallback
				? fromEventPattern<void>(
						(handler) => idleCallback.requestIdleCallback(() => handler()),
						(_handler, handle) => idleCallback.cancelIdleCallback(handle),
					)
				: NEVER
			)
				.pipe(takeUntil(record.destroyed$))
				.subscribe(() => {
					this.initializeTrigger.next(record.id);
				});
		}
	}

	protected async initialize(
		key: string,
	): Promise<TokenSetClientReadyRecordView<TClient>> {
		const record = this.clientRecordForKey(key);

		this.initializeTrigger.next(record.id);
		await record.clientResource.whenValue();
		return record.view.get() as TokenSetClientReadyRecordView<TClient>;
	}

	has(key: string): boolean {
		return this.recordsSignal.get().has(key);
	}

	unregister(key: string): boolean {
		const record = this.recordsSignal.get().get(key);
		if (!record) {
			return false;
		}
		this.updateRecords((records) => {
			records.delete(key);
		});
		record.dispose();
		this.eventsSubject.next(record.toDisposedEvent());
		return true;
	}

	private clientRecordForKey(key: string): TokenSetClientRecord<TClient> {
		const record = this.recordsSignal.get().get(key);
		if (!record) {
			throw new TokenSetClientRegistryError({
				code: TokenSetClientRegistryErrorCode.ClientUnregistered,
				clientKey: key,
			});
		}
		return record;
	}

	clientRecordFor(
		key: string,
		options: { readonly initialize: true },
	): Promise<TokenSetClientReadyRecordView<TClient>>;
	clientRecordFor(
		key: string,
		options?: { readonly initialize?: false },
	): ReadableSignalTrait<TokenSetClientRecordView<TClient>>;
	clientRecordFor(
		key: string,
		options: { readonly initialize?: boolean } = {},
	):
		| Promise<TokenSetClientReadyRecordView<TClient>>
		| ReadableSignalTrait<TokenSetClientRecordView<TClient>> {
		const record = this.clientRecordForKey(key);
		return options.initialize ? this.initialize(key) : record.view;
	}

	clientRecordOptionFor(
		key: string,
		options: { readonly initialize: true },
	): Promise<TokenSetClientReadyRecordView<TClient> | undefined>;
	clientRecordOptionFor(
		key: string,
		options?: { readonly initialize?: false },
	): ReadableSignalTrait<TokenSetClientRecordView<TClient>> | undefined;
	clientRecordOptionFor(
		key: string,
		options: { readonly initialize?: boolean } = {},
	):
		| Promise<TokenSetClientReadyRecordView<TClient> | undefined>
		| ReadableSignalTrait<TokenSetClientRecordView<TClient>>
		| undefined {
		const record = this.recordsSignal.get().get(key);
		if (!record) {
			return options.initialize ? Promise.resolve(undefined) : undefined;
		}
		return options.initialize ? this.initialize(key) : record.view;
	}

	private *clientRecordGenForQueryInternal(
		query: TokenSetClientQueryOptions,
	): Generator<TokenSetClientRecord<TClient>, void, unknown> {
		const filters = Array.isArray(query) ? query : [query];
		const seen = new Set<string>();
		for (const filter of filters) {
			let index = 0;
			for (const record of this.recordsSignal.get().values()) {
				if (
					matchesTokenSetClientQuery(record, filter) &&
					(!filter.selector || filter.selector(record.meta, index))
				) {
					index++;
					if (!seen.has(record.id)) {
						seen.add(record.id);
						yield record;
					}
				}
			}
		}
	}

	clientResourceFor(
		key: string,
		options: TokenSetClientResourceOptions = {},
	): ResourceTrait<TClient> {
		const record = this.recordsSignal.get().get(key);
		if (!record) {
			throw new TokenSetClientRegistryError({
				code: TokenSetClientRegistryErrorCode.ClientUnregistered,
				clientKey: key,
			});
		}
		if (options.initialize ?? true) {
			this.initializeTrigger.next(record.id);
		}
		return record.clientResource;
	}

	*clientRecordGenForQuery(
		query: TokenSetClientQueryOptions,
	): Generator<
		ReadableSignalTrait<TokenSetClientRecordView<TClient>>,
		void,
		unknown
	> {
		for (const record of this.clientRecordGenForQueryInternal(query)) {
			yield record.view;
		}
	}

	clientRecordForQuery(
		query: TokenSetClientQueryOptions,
		options: { readonly initialize: true },
	): Promise<TokenSetClientReadyRecordView<TClient> | undefined>;
	clientRecordForQuery(
		query: TokenSetClientQueryOptions,
		options?: { readonly initialize?: false },
	): ReadableSignalTrait<TokenSetClientRecordView<TClient>> | undefined;
	clientRecordForQuery(
		query: TokenSetClientQueryOptions,
		options: { readonly initialize?: boolean } = {},
	):
		| Promise<TokenSetClientReadyRecordView<TClient> | undefined>
		| ReadableSignalTrait<TokenSetClientRecordView<TClient>>
		| undefined {
		const result = this.clientRecordGenForQueryInternal(query).next();
		if (result.done) {
			return options.initialize ? Promise.resolve(undefined) : undefined;
		}
		return options.initialize
			? this.initialize(result.value.meta.clientKey)
			: result.value.view;
	}

	*clientResourceGenForQuery(
		query: TokenSetClientQueryOptions,
		options: TokenSetClientResourceOptions = {},
	): Generator<ResourceTrait<TClient>, void, unknown> {
		for (const record of this.clientRecordGenForQueryInternal(query)) {
			if (options.initialize ?? true) {
				this.initializeTrigger.next(record.id);
			}
			yield record.clientResource;
		}
	}

	clientResourceForQuery(
		query: TokenSetClientQueryOptions,
		options: TokenSetClientResourceOptions = {},
	): ResourceTrait<TClient> | undefined {
		const result = this.clientResourceGenForQuery(query, options).next();
		return result.done ? undefined : result.value;
	}

	private updateRecords(
		mutate: (records: Map<string, TokenSetClientRecord<TClient>>) => void,
	): void {
		const records = new Map(this.recordsSignal.get());
		mutate(records);
		this.recordsSignal.set(records);
	}

	dispose(): void {
		this._destroyed.set(true);
	}

	[SYMBOL_DISPOSE]() {
		this.dispose();
	}
}

export function createTokenSetClientRegistry<
	TClient extends DisposableTrait = BaseOidcModeClient,
>(
	options: CreateTokenSetClientRegistryOptions,
): TokenSetClientRegistry<TClient> {
	return new TokenSetClientRegistry<TClient>(options);
}
