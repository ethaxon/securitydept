import {
	ClientError,
	ClientErrorKind,
	type DisposableTrait,
	type ReadableSignalTrait,
	ResourceStatus,
	type ResourceTrait,
	readonlySignal,
	resourceFromSnapshots,
	SYMBOL_DISPOSE,
	UserRecovery,
} from "@securitydept/client";
import {
	RxStateSignal,
	type RxStateSignalCompat,
} from "@securitydept/client/rx";
import { filter, from, take } from "rxjs";
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
	implements DisposableTrait {
	private readonly _destroyed = RxStateSignal.fromInitialValue(false);
	private readonly _signal: RxStateSignalCompat<
		TokenSetClientRecordView<TClient>
	>;
	readonly destroyed$ = from(this._destroyed).pipe(
		filter((value): value is true => value),
		take(1),
	);
	readonly view: ReadableSignalTrait<TokenSetClientRecordView<TClient>>;
	readonly clientResource: ResourceTrait<TClient>;

	protected constructor(
		readonly id: string,
		readonly entry: TokenSetClientRegistryEntry<TClient>,
	) {
		this._signal = RxStateSignal.fromInitialValue<
			TokenSetClientRecordView<TClient>
		>({
			id,
			entry,
			meta: entry.meta,
			status: TokenSetClientRegistryEntryStatus.Registered,
		});
		this.view = readonlySignal(this._signal);
		this.clientResource = resourceFromSnapshots<TClient>(() => {
			const current = this._signal.get();
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
		this.destroyed$.subscribe(() => {
			this.client?.dispose();
			this.clientResource.dispose();
		});
	}

	get meta(): TokenSetClientMeta {
		return this.entry.meta;
	}

	get status(): TokenSetClientRegistryEntryStatus {
		return this._signal.get().status;
	}

	get client(): TClient | undefined {
		const view = this._signal.get();
		return view.status === TokenSetClientRegistryEntryStatus.Ready
			? view.client
			: undefined;
	}

	get error(): unknown | null {
		const view = this._signal.get();
		return view.status === TokenSetClientRegistryEntryStatus.Failed
			? view.error
			: null;
	}

	static idFactory() {
		return uuidv7();
	}

	static fromRegistered<TClient extends DisposableTrait>(
		entry: TokenSetClientRegistryEntry<TClient>,
	): TokenSetClientRecord<TClient> {
		return new TokenSetClientRecord(TokenSetClientRecord.idFactory(), entry);
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
			this._signal.set({
				id: this.id,
				entry: this.entry,
				meta: this.meta,
				status: TokenSetClientRegistryEntryStatus.Initializing,
			});
			yield this;
			const client = await this.entry.clientFactory();
			this._signal.set({
				id: this.id,
				entry: this.entry,
				meta: this.meta,
				status: TokenSetClientRegistryEntryStatus.Ready,
				client,
			});
			if (this._destroyed.get()) {
				yield this;
				client.dispose();
				return yield this;
			}
			return yield this;
		} catch (error) {
			this._signal.set({
				id: this.id,
				entry: this.entry,
				meta: this.meta,
				status: TokenSetClientRegistryEntryStatus.Failed,
				error,
			});
			if (this._destroyed.get()) {
				yield this;
				return yield this;
			}
			return yield this;
		}
	}

	toEvent(): TokenSetClientRegistryEvent<TClient> {
		const view = this.view.get();
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

	toDisposedEvent(): TokenSetClientRegistryEvent<TClient> {
		return {
			id: this.id,
			entry: this.entry,
			meta: this.meta,
			status: TokenSetClientRegistryEventType.Disposed,
			type: TokenSetClientRegistryEventType.Disposed,
		};
	}

	dispose(): void {
		this._destroyed.set(true);
	}

	[SYMBOL_DISPOSE]() {
		this.dispose();
	}
}
