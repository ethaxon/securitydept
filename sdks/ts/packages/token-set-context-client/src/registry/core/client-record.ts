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
	type ClientDisposedRecordView,
	type ClientMeta,
	type ClientRecordView,
	type ClientRegistryEntry,
	ClientRegistryEntryStatus,
	type ClientRegistryEvent,
	ClientRegistryEventType,
} from "../contracts/types";

export class ClientRecord<TClient extends DisposableTrait>
	implements DisposableTrait
{
	status: ClientRegistryEntryStatus;
	client: TClient | undefined;
	error: unknown | null;
	destroyed = new ReplaySubject<true>(1);

	protected constructor(
		readonly id: string,
		readonly entry: ClientRegistryEntry<TClient>,
		status: ClientRegistryEntryStatus,
		client: TClient | undefined,
		error: unknown | null,
	) {
		this.status = status;
		this.client = client;
		this.error = error;
	}

	get meta(): ClientMeta {
		return this.entry.meta;
	}

	static idFactory() {
		return uuidv7();
	}

	static fromRegistered<TClient extends DisposableTrait>(
		entry: ClientRegistryEntry<TClient>,
	): ClientRecord<TClient> {
		return new ClientRecord(
			ClientRecord.idFactory(),
			entry,
			ClientRegistryEntryStatus.Registered,
			undefined,
			null,
		);
	}

	static toSignal<TClient extends DisposableTrait>(
		recordSubject: BehaviorSubject<ClientRecord<TClient>>,
	): ReadableSignalTrait<ClientRecord<TClient>> {
		return readonlySignal(behaviorSubjectToSignal(() => recordSubject));
	}

	static toClientSignal<TClient extends DisposableTrait>(
		recordSubject: BehaviorSubject<ClientRecord<TClient>>,
	): ReadableReplaySignalTrait<TClient> {
		return observableToReplaySignal<TClient>(
			recordSubject.pipe(
				filter((record) => record.status === ClientRegistryEntryStatus.Ready),
				map((record) => record.client as TClient),
			),
		);
	}

	async *initialize(): AsyncGenerator<ClientRecord<TClient>> {
		if (this.status !== ClientRegistryEntryStatus.Registered) {
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
			this.status = ClientRegistryEntryStatus.Initializing;
			yield this;
			const client = await this.entry.clientFactory();
			this.client = client;
			this.status = ClientRegistryEntryStatus.Ready;
			this.error = null;
			return yield this;
		} catch (error) {
			this.client = undefined;
			this.status = ClientRegistryEntryStatus.Failed;
			this.error = error;
			return yield this;
		}
	}

	toView(): ClientRecordView<TClient> {
		const base = {
			id: this.id,
			entry: this.entry,
			meta: this.meta,
		};
		if (this.status === ClientRegistryEntryStatus.Ready) {
			return {
				...base,
				status: this.status,
				client: this.client as TClient,
			};
		}
		if (this.status === ClientRegistryEntryStatus.Failed) {
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

	toEvent(): ClientRegistryEvent<TClient> {
		const view = this.toView();
		switch (view.status) {
			case ClientRegistryEntryStatus.Registered:
				return {
					...view,
					type: ClientRegistryEventType.Registered,
				};
			case ClientRegistryEntryStatus.Initializing:
				return {
					...view,
					type: ClientRegistryEventType.Initializing,
				};
			case ClientRegistryEntryStatus.Ready:
				return {
					...view,
					type: ClientRegistryEventType.Ready,
				};
			case ClientRegistryEntryStatus.Failed:
				return {
					...view,
					type: ClientRegistryEventType.Failed,
				};
		}
	}

	toDisposedView(): ClientDisposedRecordView<TClient> {
		return {
			id: this.id,
			entry: this.entry,
			meta: this.meta,
			status: ClientRegistryEventType.Disposed,
		};
	}

	toDisposedEvent(): ClientRegistryEvent<TClient> {
		return {
			...this.toDisposedView(),
			type: ClientRegistryEventType.Disposed,
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
