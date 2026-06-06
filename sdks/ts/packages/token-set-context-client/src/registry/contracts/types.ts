import {
	type DisposableTrait,
	type FoundationEnvironment,
} from "@securitydept/client";

export const TokenSetClientInitializationMode = {
	Immediate: "immediate",
	Idle: "idle",
	Lazy: "lazy",
} as const;

export type TokenSetClientInitializationMode =
	(typeof TokenSetClientInitializationMode)[keyof typeof TokenSetClientInitializationMode];

export const TokenSetClientRegistryEntryStatus = {
	Registered: "registered",
	Initializing: "initializing",
	Ready: "ready",
	Failed: "failed",
} as const;

export type TokenSetClientRegistryEntryStatus =
	(typeof TokenSetClientRegistryEntryStatus)[keyof typeof TokenSetClientRegistryEntryStatus];

export const TokenSetClientRegistryEventType = {
	Registered: "registered",
	Initializing: "initializing",
	Ready: "ready",
	Failed: "failed",
	Disposed: "disposed",
} as const;

export type TokenSetClientRegistryEventType =
	(typeof TokenSetClientRegistryEventType)[keyof typeof TokenSetClientRegistryEventType];

export const TokenSetRequirementKind = {
	FrontendOidc: "frontend_oidc",
	BackendOidc: "backend_oidc",
} as const;

export type TokenSetRequirementKind =
	(typeof TokenSetRequirementKind)[keyof typeof TokenSetRequirementKind];

export interface TokenSetClientRegistryEntry<TClient extends DisposableTrait> {
	clientFactory: () => TClient | Promise<TClient>;
	meta: TokenSetClientMeta;
}

export interface TokenSetClientResourceOptions {
	readonly initialize?: boolean;
}

export interface TokenSetClientMeta {
	readonly clientKey: string;
	readonly urlPatterns: ReadonlyArray<
		string | RegExp | ((url: string) => boolean)
	>;
	readonly callbackPath: string | undefined;
	readonly requirementKind: TokenSetRequirementKind | string | undefined;
	readonly providerFamily: string | undefined;
	readonly initialization: TokenSetClientInitializationMode;
}

export interface TokenSetClientRecordViewBase<TClient extends DisposableTrait> {
	readonly id: string;
	readonly entry: TokenSetClientRegistryEntry<TClient>;
	readonly meta: TokenSetClientMeta;
}

export type TokenSetClientRegisteredRecordView<
	TClient extends DisposableTrait,
> = TokenSetClientRecordViewBase<TClient> & {
	readonly status: typeof TokenSetClientRegistryEntryStatus.Registered;
	readonly client?: undefined;
	readonly error?: undefined;
};

export type TokenSetClientInitializingRecordView<
	TClient extends DisposableTrait,
> = TokenSetClientRecordViewBase<TClient> & {
	readonly status: typeof TokenSetClientRegistryEntryStatus.Initializing;
	readonly client?: undefined;
	readonly error?: undefined;
};

export type TokenSetClientReadyRecordView<TClient extends DisposableTrait> =
	TokenSetClientRecordViewBase<TClient> & {
		readonly status: typeof TokenSetClientRegistryEntryStatus.Ready;
		readonly client: TClient;
		readonly error?: undefined;
	};

export type TokenSetClientFailedRecordView<TClient extends DisposableTrait> =
	TokenSetClientRecordViewBase<TClient> & {
		readonly status: typeof TokenSetClientRegistryEntryStatus.Failed;
		readonly client?: undefined;
		readonly error: unknown;
	};

export type TokenSetClientDisposedRecordView<TClient extends DisposableTrait> =
	TokenSetClientRecordViewBase<TClient> & {
		readonly status: typeof TokenSetClientRegistryEventType.Disposed;
		readonly client?: undefined;
		readonly error?: undefined;
	};

export type TokenSetClientRecordView<TClient extends DisposableTrait> =
	| TokenSetClientRegisteredRecordView<TClient>
	| TokenSetClientInitializingRecordView<TClient>
	| TokenSetClientReadyRecordView<TClient>
	| TokenSetClientFailedRecordView<TClient>;

export type TokenSetClientRegistryEvent<TClient extends DisposableTrait> =
	| (TokenSetClientRegisteredRecordView<TClient> & {
			type: typeof TokenSetClientRegistryEventType.Registered;
	  })
	| (TokenSetClientInitializingRecordView<TClient> & {
			type: typeof TokenSetClientRegistryEventType.Initializing;
	  })
	| (TokenSetClientReadyRecordView<TClient> & {
			type: typeof TokenSetClientRegistryEventType.Ready;
	  })
	| (TokenSetClientFailedRecordView<TClient> & {
			type: typeof TokenSetClientRegistryEventType.Failed;
	  })
	| (TokenSetClientDisposedRecordView<TClient> & {
			type: typeof TokenSetClientRegistryEventType.Disposed;
	  });

export interface CreateTokenSetClientRegistryOptions {
	environment: Pick<FoundationEnvironment, "idleCallback">;
}
