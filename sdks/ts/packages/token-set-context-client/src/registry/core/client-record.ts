import {
	ClientError,
	ClientErrorKind,
	type DisposableTrait,
	type ReadableReplaySignalTrait,
	type ReadableSignalTrait,
	readonlySignal,
	SYMBOL_DISPOSE,
	UserRecovery,
} from "@securitydept/client";
import {
	behaviorSubjectToSignal,
	observableToReplaySignal,
} from "@securitydept/client/rx";
import { type BehaviorSubject, filter, map, ReplaySubject } from "rxjs";
import { v7 as uuidv7 } from "uuid";
import {
	type TokenSetClientDisposedRecordView,
	type TokenSetClientMeta,
	type TokenSetClientRecordView,
	type TokenSetClientRegistryEntry,
	TokenSetClientRegistryEntryStatus,
	type TokenSetClientRegistryEvent,
	TokenSetClientRegistryEventType,
} from "../contracts/types";

export class TokenSetClientRecord<TClient extends DisposableTrait>
	implements DisposableTrait
{
	status: TokenSetClientRegistryEntryStatus;
	client: TClient | undefined;
	error: unknown | null;
	destroyed = new ReplaySubject<true>(1);

	protected constructor(
		readonly id: string,
		readonly entry: TokenSetClientRegistryEntry<TClient>,
		status: TokenSetClientRegistryEntryStatus,
		client: TClient | undefined,
		error: unknown | null,
	) {
		this.status = status;
		this.client = client;
		this.error = error;
	}

	get meta(): TokenSetClientMeta {
		return this.entry.meta;
	}

	static idFactory() {
		return uuidv7();
	}

	static fromRegistered<TClient extends DisposableTrait>(
		entry: TokenSetClientRegistryEntry<TClient>,
	): TokenSetClientRecord<TClient> {
		return new TokenSetClientRecord(
			TokenSetClientRecord.idFactory(),
			entry,
			TokenSetClientRegistryEntryStatus.Registered,
			undefined,
			null,
		);
	}

	static toSignal<TClient extends DisposableTrait>(
		recordSubject: BehaviorSubject<TokenSetClientRecord<TClient>>,
	): ReadableSignalTrait<TokenSetClientRecord<TClient>> {
		return readonlySignal(behaviorSubjectToSignal(() => recordSubject));
	}

	static toClientSignal<TClient extends DisposableTrait>(
		recordSubject: BehaviorSubject<TokenSetClientRecord<TClient>>,
	): ReadableReplaySignalTrait<TClient> {
		return observableToReplaySignal<TClient>(
			recordSubject.pipe(
				filter(
					(record) => record.status === TokenSetClientRegistryEntryStatus.Ready,
				),
				map((record) => record.client as TClient),
			),
		);
	}

	async *initialize(): AsyncGenerator<TokenSetClientRecord<TClient>> {
		if (this.status !== TokenSetClientRegistryEntryStatus.Registered) {
			throw new ClientError({
				kind: ClientErrorKind.Unreachable,
				code: `client_record.initialize.${this.status}`,
				message: `[ClientRecord] Cannot initialize a ${this.status} client record; initialize() is non-idempotent.`,
				recovery: UserRecovery.ContactSupport,
				retryable: false,
				source: "client_registry",
			});
		}
		try {
			this.status = TokenSetClientRegistryEntryStatus.Initializing;
			yield this;
			const client = await this.entry.clientFactory();
			this.client = client;
			this.status = TokenSetClientRegistryEntryStatus.Ready;
			this.error = null;
			return yield this;
		} catch (error) {
			this.client = undefined;
			this.status = TokenSetClientRegistryEntryStatus.Failed;
			this.error = error;
			return yield this;
		}
	}

	toView(): TokenSetClientRecordView<TClient> {
		const base = {
			id: this.id,
			entry: this.entry,
			meta: this.meta,
		};
		if (this.status === TokenSetClientRegistryEntryStatus.Ready) {
			return {
				...base,
				status: this.status,
				client: this.client as TClient,
			};
		}
		if (this.status === TokenSetClientRegistryEntryStatus.Failed) {
			return {
				...base,
				status: this.status,
				error: this.error,
			};
		}
		return {
			...base,
			status: this.status,
		};
	}

	toEvent(): TokenSetClientRegistryEvent<TClient> {
		const view = this.toView();
		switch (view.status) {
			case TokenSetClientRegistryEntryStatus.Registered:
				return {
					...view,
					type: TokenSetClientRegistryEventType.Registered,
				};
			case TokenSetClientRegistryEntryStatus.Initializing:
				return {
					...view,
					type: TokenSetClientRegistryEventType.Initializing,
				};
			case TokenSetClientRegistryEntryStatus.Ready:
				return {
					...view,
					type: TokenSetClientRegistryEventType.Ready,
				};
			case TokenSetClientRegistryEntryStatus.Failed:
				return {
					...view,
					type: TokenSetClientRegistryEventType.Failed,
				};
		}
	}

	toDisposedView(): TokenSetClientDisposedRecordView<TClient> {
		return {
			id: this.id,
			entry: this.entry,
			meta: this.meta,
			status: TokenSetClientRegistryEventType.Disposed,
		};
	}

	toDisposedEvent(): TokenSetClientRegistryEvent<TClient> {
		return {
			...this.toDisposedView(),
			type: TokenSetClientRegistryEventType.Disposed,
		};
	}

	dispose(): void {
		this.destroyed.next(true);
		this.destroyed.complete();
		this.client?.dispose();
	}

	[SYMBOL_DISPOSE]() {
		this.dispose();
	}
}
