import {
	type DisposableTrait,
	type ReadableSignalTrait,
	ResourceStatus,
	type ResourceTrait,
	readonlySignal,
	resourceFromSnapshots,
} from "@securitydept/client";
import {
	RxEventStream,
	RxStateSignal,
	type RxStateSignalCompat,
} from "@securitydept/client/rx";
import {
	combineLatest,
	EmptyError,
	filter,
	firstValueFrom,
	from,
	fromEventPattern,
	map,
	NEVER,
	of,
	Subject,
	switchMap,
	take,
	takeUntil,
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
	TokenSetClientRegistryEntryStatus,
	type TokenSetClientRegistryEvent,
	type TokenSetClientResourceOptions,
} from "../contracts/types";
import { TokenSetClientRecord } from "./client-record";
import {
	TokenSetClientRegistryError,
	TokenSetClientRegistryErrorCode,
} from "./error";

type TokenSetClientRecordSignal<TClient extends DisposableTrait> =
	RxStateSignalCompat<TokenSetClientRecord<TClient>>;

interface TokenSetClientRecordSlot<TClient extends DisposableTrait> {
	recordSignal: TokenSetClientRecordSignal<TClient>;
	clientResource: ResourceTrait<TClient>;
}

export class TokenSetClientRegistry<
	TClient extends DisposableTrait = BaseOidcModeClient,
> {
	private readonly _destroyed = RxStateSignal.fromInitialValue(false);
	private readonly destroyed$ = from(this._destroyed).pipe(
		filter((value): value is true => value),
	);

	private readonly recordsSignal = RxStateSignal.fromInitialValue(
		new Map<string, TokenSetClientRecordSlot<TClient>>(),
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
		from(this.recordsSignal)
			.pipe(
				switchMap((records) => {
					const recordSignals = [...records.values()].map(
						(slot) => slot.recordSignal,
					);
					return recordSignals.length === 0
						? of([] as TokenSetClientRecord<TClient>[])
						: combineLatest(
								recordSignals.map((recordSignal) => from(recordSignal)),
							);
				}),
				map((records) => records.map((record) => record.toView())),
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
		const recordSignal = RxStateSignal.fromInitialValue(record, {
			equals: () => false,
		});
		const clientResource = resourceFromSnapshots<TClient>(() => {
			const current = recordSignal.get();
			switch (current.status) {
				case TokenSetClientRegistryEntryStatus.Registered:
					return { status: ResourceStatus.Idle };
				case TokenSetClientRegistryEntryStatus.Initializing:
					return { status: ResourceStatus.Loading };
				case TokenSetClientRegistryEntryStatus.Ready:
					return {
						status: ResourceStatus.Resolved,
						value: current.client as TClient,
					};
				case TokenSetClientRegistryEntryStatus.Failed:
					return {
						status: ResourceStatus.LoadingError,
						error: current.error,
					};
			}
		});
		this.updateRecords((records) => {
			records.set(clientKey, { recordSignal, clientResource });
		});
		from(recordSignal)
			.pipe(takeUntil(record.destroyed$))
			.subscribe((record) => {
				this.eventsSubject.next(record.toEvent());
			});

		this.initializeTrigger
			.pipe(
				filter((id) => id === record.id),
				take(1),
				takeUntil(record.destroyed$),
				switchMap(() => from(record.initialize())),
			)
			.subscribe((record) => {
				recordSignal.set(record);
			});

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

	async initialize(
		key: string,
	): Promise<TokenSetClientReadyRecordView<TClient>> {
		const recordSignal = this.clientRecordSignalFor(key);
		const record = recordSignal.get();

		this.initializeTrigger.next(record.id);

		let result: TokenSetClientRecord<TClient>;
		try {
			result = await firstValueFrom(
				from(recordSignal).pipe(
					filter(
						(record) =>
							record.status === TokenSetClientRegistryEntryStatus.Ready ||
							record.status === TokenSetClientRegistryEntryStatus.Failed,
					),
					take(1),
					takeUntil(record.destroyed$),
				),
			);
		} catch (error) {
			if (error instanceof EmptyError) {
				result = recordSignal.get();
			} else {
				throw error;
			}
		}

		if (result.status === TokenSetClientRegistryEntryStatus.Ready) {
			const view = result.toView();
			if (view.status === TokenSetClientRegistryEntryStatus.Ready) {
				return view;
			}
		}
		if (result.status === TokenSetClientRegistryEntryStatus.Failed) {
			throw result.error;
		}
		throw new TokenSetClientRegistryError({
			code: TokenSetClientRegistryErrorCode.ClientUnregistered,
			clientKey: key,
		});
	}

	has(key: string): boolean {
		return this.recordsSignal.get().has(key);
	}

	unregister(key: string): boolean {
		const slot = this.recordsSignal.get().get(key);
		if (!slot) {
			return false;
		}
		const record = slot.recordSignal.get();
		this.updateRecords((records) => {
			records.delete(key);
		});
		record.dispose();
		slot.clientResource.dispose();
		this.eventsSubject.next(record.toDisposedEvent());
		return true;
	}

	dispose(): void {
		if (this._destroyed.get()) {
			return;
		}
		for (const key of [...this.recordsSignal.get().keys()]) {
			this.unregister(key);
		}
		this._destroyed.set(true);
	}

	private clientRecordSignalFor(
		key: string,
	): TokenSetClientRecordSignal<TClient> {
		const slot = this.recordsSignal.get().get(key);
		if (!slot) {
			throw new TokenSetClientRegistryError({
				code: TokenSetClientRegistryErrorCode.ClientUnregistered,
				clientKey: key,
			});
		}
		return slot.recordSignal;
	}

	clientRecordFor(
		key: string,
	): ReadableSignalTrait<TokenSetClientRecord<TClient>> {
		return TokenSetClientRecord.toSignal(this.clientRecordSignalFor(key));
	}

	clientRecordOptionFor(
		key: string,
	): ReadableSignalTrait<TokenSetClientRecord<TClient>> | undefined {
		const slot = this.recordsSignal.get().get(key);
		return slot ? TokenSetClientRecord.toSignal(slot.recordSignal) : undefined;
	}

	private *clientRecordSignalGenForQuery(
		query: TokenSetClientQueryOptions,
	): Generator<TokenSetClientRecordSignal<TClient>, void, unknown> {
		const filters = Array.isArray(query) ? query : [query];
		const seen = new Set<string>();
		for (const filter of filters) {
			let index = 0;
			for (const { recordSignal } of this.recordsSignal.get().values()) {
				const record = recordSignal.get();
				if (
					matchesTokenSetClientQuery(record, filter) &&
					(!filter.selector || filter.selector(record.meta, index))
				) {
					index++;
					if (!seen.has(record.id)) {
						seen.add(record.id);
						yield recordSignal;
					}
				}
			}
		}
	}

	clientResourceFor(
		key: string,
		options: TokenSetClientResourceOptions = {},
	): ResourceTrait<TClient> {
		const slot = this.recordsSignal.get().get(key);
		if (!slot) {
			throw new TokenSetClientRegistryError({
				code: TokenSetClientRegistryErrorCode.ClientUnregistered,
				clientKey: key,
			});
		}
		if (options.initialize ?? true) {
			this.initializeTrigger.next(slot.recordSignal.get().id);
		}
		return slot.clientResource;
	}

	*clientRecordGenForQuery(
		query: TokenSetClientQueryOptions,
	): Generator<
		ReadableSignalTrait<TokenSetClientRecord<TClient>>,
		void,
		unknown
	> {
		for (const recordSignal of this.clientRecordSignalGenForQuery(query)) {
			yield TokenSetClientRecord.toSignal(recordSignal);
		}
	}

	clientRecordForQuery(
		query: TokenSetClientQueryOptions,
	): ReadableSignalTrait<TokenSetClientRecord<TClient>> | undefined {
		const result = this.clientRecordGenForQuery(query).next();
		return result.done ? undefined : result.value;
	}

	*clientResourceGenForQuery(
		query: TokenSetClientQueryOptions,
		options: TokenSetClientResourceOptions = {},
	): Generator<ResourceTrait<TClient>, void, unknown> {
		for (const recordSignal of this.clientRecordSignalGenForQuery(query)) {
			if (options.initialize ?? true) {
				this.initializeTrigger.next(recordSignal.get().id);
			}
			const clientKey = recordSignal.get().meta.clientKey;
			const slot = this.recordsSignal.get().get(clientKey);
			if (slot) {
				yield slot.clientResource;
			}
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
		mutate: (records: Map<string, TokenSetClientRecordSlot<TClient>>) => void,
	): void {
		const records = new Map(this.recordsSignal.get());
		mutate(records);
		this.recordsSignal.set(records);
	}
}

export function createTokenSetClientRegistry<
	TClient extends DisposableTrait = BaseOidcModeClient,
>(
	options: CreateTokenSetClientRegistryOptions,
): TokenSetClientRegistry<TClient> {
	return new TokenSetClientRegistry<TClient>(options);
}
