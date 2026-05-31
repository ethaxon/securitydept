import {
	type DisposableTrait,
	type FoundationEnvironment,
} from "@securitydept/client";

export const ClientInitializationMode = {
	Immediate: "immediate",
	Idle: "idle",
	Lazy: "lazy",
} as const;

export type ClientInitializationMode =
	(typeof ClientInitializationMode)[keyof typeof ClientInitializationMode];

export const ClientRegistryEntryStatus = {
	Registered: "registered",
	Initializing: "initializing",
	Ready: "ready",
	Failed: "failed",
} as const;

export type ClientRegistryEntryStatus =
	(typeof ClientRegistryEntryStatus)[keyof typeof ClientRegistryEntryStatus];

export const ClientRegistryEventType = {
	Registered: "registered",
	Initializing: "initializing",
	Ready: "ready",
	Failed: "failed",
	Disposed: "disposed",
} as const;

export type ClientRegistryEventType =
	(typeof ClientRegistryEventType)[keyof typeof ClientRegistryEventType];

export interface ClientRegistryEntry<TClient extends DisposableTrait> {
	clientFactory: () => TClient | Promise<TClient>;
	meta: ClientMeta;
}

export interface ClientSignalOptions {
	readonly initialize?: boolean;
}

export interface ClientMeta {
	readonly clientKey: string;
	readonly urlPatterns: ReadonlyArray<
		string | RegExp | ((url: string) => boolean)
	>;
	readonly callbackPath: string | undefined;
	readonly requirementKind: string | undefined;
	readonly providerFamily: string | undefined;
	readonly initialization: ClientInitializationMode;
}

export interface ClientRecordViewBase<TClient extends DisposableTrait> {
	readonly id: string;
	readonly entry: ClientRegistryEntry<TClient>;
	readonly meta: ClientMeta;
}

export type ClientRegisteredRecordView<TClient extends DisposableTrait> =
	ClientRecordViewBase<TClient> & {
		readonly status: typeof ClientRegistryEntryStatus.Registered;
		readonly client?: undefined;
		readonly error?: undefined;
	};

export type ClientInitializingRecordView<TClient extends DisposableTrait> =
	ClientRecordViewBase<TClient> & {
		readonly status: typeof ClientRegistryEntryStatus.Initializing;
		readonly client?: undefined;
		readonly error?: undefined;
	};

export type ClientReadyRecordView<TClient extends DisposableTrait> =
	ClientRecordViewBase<TClient> & {
		readonly status: typeof ClientRegistryEntryStatus.Ready;
		readonly client: TClient;
		readonly error?: undefined;
	};

export type ClientFailedRecordView<TClient extends DisposableTrait> =
	ClientRecordViewBase<TClient> & {
		readonly status: typeof ClientRegistryEntryStatus.Failed;
		readonly client?: undefined;
		readonly error: unknown;
	};

export type ClientDisposedRecordView<TClient extends DisposableTrait> =
	ClientRecordViewBase<TClient> & {
		readonly status: typeof ClientRegistryEventType.Disposed;
		readonly client?: undefined;
		readonly error?: undefined;
	};

export type ClientRecordView<TClient extends DisposableTrait> =
	| ClientRegisteredRecordView<TClient>
	| ClientInitializingRecordView<TClient>
	| ClientReadyRecordView<TClient>
	| ClientFailedRecordView<TClient>;

export type ClientRegistryEvent<TClient extends DisposableTrait> =
	| (ClientRegisteredRecordView<TClient> & {
			type: typeof ClientRegistryEventType.Registered;
	  })
	| (ClientInitializingRecordView<TClient> & {
			type: typeof ClientRegistryEventType.Initializing;
	  })
	| (ClientReadyRecordView<TClient> & {
			type: typeof ClientRegistryEventType.Ready;
	  })
	| (ClientFailedRecordView<TClient> & {
			type: typeof ClientRegistryEventType.Failed;
	  })
	| (ClientDisposedRecordView<TClient> & {
			type: typeof ClientRegistryEventType.Disposed;
	  });

export interface CreateClientRegistryOptions {
	environment: Pick<FoundationEnvironment, "idleCallback">;
}
