import {
	type DisposableTrait,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
	readonlySignal,
} from "@securitydept/client";
import {
	behaviorSubjectToSignal,
	observableToEventStream,
} from "@securitydept/client/rx";
import {
	BehaviorSubject,
	combineLatest,
	filter,
	firstValueFrom,
	from,
	fromEventPattern,
	map,
	NEVER,
	of,
	ReplaySubject,
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
	type TokenSetClientSignalOptions,
} from "../contracts/types";
import { TokenSetClientRecord } from "./client-record";
import {
	TokenSetClientRegistryError,
	TokenSetClientRegistryErrorCode,
} from "./error";

export class TokenSetClientRegistry<
	TClient extends DisposableTrait = BaseOidcModeClient,
> {
	private readonly destroyed = new ReplaySubject<true>(1);

	private readonly recordsSubject = new BehaviorSubject(
		new Map<string, BehaviorSubject<TokenSetClientRecord<TClient>>>(),
	);
	private readonly eventsSubject = new Subject<
		TokenSetClientRegistryEvent<TClient>
	>();

	readonly events = observableToEventStream(this.eventsSubject);
	readonly entries = readonlySignal(
		behaviorSubjectToSignal(() => {
			const entriesSubject = new BehaviorSubject<
				readonly TokenSetClientRecordView<TClient>[]
			>([]);
			this.recordsSubject
				.pipe(
					switchMap((records) => {
						const recordSubjects = [...records.values()];
						return recordSubjects.length === 0
							? of([] as TokenSetClientRecord<TClient>[])
							: combineLatest(recordSubjects);
					}),
					map((records) => records.map((record) => record.toView())),
					takeUntil(this.destroyed),
				)
				.subscribe((entries) => {
					entriesSubject.next(entries);
				});
			return entriesSubject;
		}),
	);

	private readonly initializeTrigger = new Subject<string>();

	constructor(private readonly options: CreateTokenSetClientRegistryOptions) {}

	register(entry: TokenSetClientRegistryEntry<TClient>): void {
		const clientKey = entry.meta.clientKey;
		if (this.recordsSubject.getValue().has(clientKey)) {
			throw new TokenSetClientRegistryError({
				code: TokenSetClientRegistryErrorCode.ClientRegistered,
				clientKey,
			});
		}

		const record = TokenSetClientRecord.fromRegistered(entry);
		const recordSubject = new BehaviorSubject(record);
		this.updateRecords((records) => {
			records.set(clientKey, recordSubject);
		});
		recordSubject.pipe(takeUntil(record.destroyed)).subscribe((record) => {
			this.eventsSubject.next(record.toEvent());
		});

		this.initializeTrigger
			.pipe(
				filter((id) => id === record.id),
				take(1),
				switchMap(() => from(record.initialize())),
				takeUntil(record.destroyed),
			)
			.subscribe((record) => {
				recordSubject.next(record);
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
				.pipe(takeUntil(record.destroyed))
				.subscribe(() => {
					this.initializeTrigger.next(record.id);
				});
		}
	}

	async initialize(
		key: string,
	): Promise<TokenSetClientReadyRecordView<TClient>> {
		const clientRecord = this.clientRecordSubjectFor(key);
		const record = clientRecord.getValue();

		this.initializeTrigger.next(record.id);

		const result = await firstValueFrom(
			clientRecord.pipe(
				filter(
					(record) =>
						record.status === TokenSetClientRegistryEntryStatus.Ready ||
						record.status === TokenSetClientRegistryEntryStatus.Failed,
				),
				take(1),
				takeUntil(record.destroyed),
			),
		);
		if (result.status === TokenSetClientRegistryEntryStatus.Ready) {
			const view = result.toView();
			if (view.status === TokenSetClientRegistryEntryStatus.Ready) {
				return view;
			}
		}
		throw result.error;
	}

	has(key: string): boolean {
		return this.recordsSubject.getValue().has(key);
	}

	unregister(key: string): boolean {
		const recordSubject = this.recordsSubject.getValue().get(key);
		if (!recordSubject) {
			return false;
		}
		const record = recordSubject.getValue();
		this.updateRecords((records) => {
			records.delete(key);
		});
		record.dispose();
		recordSubject.complete();
		this.eventsSubject.next(record.toDisposedEvent());
		return true;
	}

	dispose(): void {
		for (const key of this.recordsSubject.getValue().keys()) {
			this.unregister(key);
		}
		this.destroyed.next(true);
		this.destroyed.complete();
	}

	private clientRecordSubjectFor(
		key: string,
	): BehaviorSubject<TokenSetClientRecord<TClient>> {
		const recordSubject = this.recordsSubject.getValue().get(key);
		if (!recordSubject) {
			throw new TokenSetClientRegistryError({
				code: TokenSetClientRegistryErrorCode.ClientUnregistered,
				clientKey: key,
			});
		}
		return recordSubject;
	}

	clientRecordFor(
		key: string,
	): ReadableSignalTrait<TokenSetClientRecord<TClient>> {
		return TokenSetClientRecord.toSignal(this.clientRecordSubjectFor(key));
	}

	clientRecordOptionFor(
		key: string,
	): ReadableSignalTrait<TokenSetClientRecord<TClient>> | undefined {
		const recordSubject = this.recordsSubject.getValue().get(key);
		return recordSubject
			? TokenSetClientRecord.toSignal(recordSubject)
			: undefined;
	}

	private *clientSubjectGenForQuery(
		query: TokenSetClientQueryOptions,
	): Generator<BehaviorSubject<TokenSetClientRecord<TClient>>, void, unknown> {
		const filters = Array.isArray(query) ? query : [query];
		const seen = new Set<string>();
		for (const filter of filters) {
			let index = 0;
			for (const recordSubject of this.recordsSubject.getValue().values()) {
				const record = recordSubject.getValue();
				if (
					matchesTokenSetClientQuery(record, filter) &&
					(!filter.selector || filter.selector(record.meta, index))
				) {
					index++;
					if (!seen.has(record.id)) {
						seen.add(record.id);
						yield recordSubject;
					}
				}
			}
		}
	}

	clientSignalFor(
		key: string,
		options: TokenSetClientSignalOptions = {},
	): ReadableReplaySignalTrait<TClient> {
		const recordSubject = this.clientRecordSubjectFor(key);
		if (options.initialize ?? true) {
			this.initializeTrigger.next(recordSubject.getValue().id);
		}
		return TokenSetClientRecord.toClientSignal(recordSubject);
	}

	*clientRecordGenForQuery(
		query: TokenSetClientQueryOptions,
	): Generator<
		ReadableSignalTrait<TokenSetClientRecord<TClient>>,
		void,
		unknown
	> {
		for (const recordSubject of this.clientSubjectGenForQuery(query)) {
			yield TokenSetClientRecord.toSignal(recordSubject);
		}
	}

	clientRecordForQuery(
		query: TokenSetClientQueryOptions,
	): ReadableSignalTrait<TokenSetClientRecord<TClient>> | undefined {
		const result = this.clientRecordGenForQuery(query).next();
		return result.done ? undefined : result.value;
	}

	*clientSignalGenForQuery(
		query: TokenSetClientQueryOptions,
		options: TokenSetClientSignalOptions = {},
	): Generator<ReadableReplaySignalTrait<TClient>, void, unknown> {
		for (const recordSubject of this.clientSubjectGenForQuery(query)) {
			if (options.initialize ?? true) {
				this.initializeTrigger.next(recordSubject.getValue().id);
			}
			yield TokenSetClientRecord.toClientSignal(recordSubject);
		}
	}

	clientSignalForQuery(
		query: TokenSetClientQueryOptions,
		options: TokenSetClientSignalOptions = {},
	): ReadableReplaySignalTrait<TClient> | undefined {
		const result = this.clientSignalGenForQuery(query, options).next();
		return result.done ? undefined : result.value;
	}

	private updateRecords(
		mutate: (
			records: Map<string, BehaviorSubject<TokenSetClientRecord<TClient>>>,
		) => void,
	): void {
		const records = this.recordsSubject.getValue();
		mutate(records);
		this.recordsSubject.next(records);
	}
}

export function createTokenSetClientRegistry<
	TClient extends DisposableTrait = BaseOidcModeClient,
>(
	options: CreateTokenSetClientRegistryOptions,
): TokenSetClientRegistry<TClient> {
	return new TokenSetClientRegistry<TClient>(options);
}
