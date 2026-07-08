import { type FoundationEnvironment } from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { type BaseOidcModeClient } from "../orchestration/client/base-client";
import {
	type TokenSetClientFactory,
	TokenSetClientInitializationMode,
	type TokenSetClientMeta,
	type TokenSetClientRegistryClient,
	type TokenSetClientRegistryEntry,
} from "../registry/contracts/types";
import { TokenSetClientRegistry } from "../registry/core/client-registry";

interface CreateTokenSetClientRegistryEntryForTestOptionsBase {
	readonly clientKey: string;
	readonly urlPatterns?: TokenSetClientMeta["urlPatterns"];
	readonly callbackUrl?: TokenSetClientMeta["callbackUrl"];
	readonly requirementKind?: TokenSetClientMeta["requirementKind"];
	readonly providerFamily?: string;
	readonly initialization?: TokenSetClientInitializationMode;
}

export type CreateTokenSetClientRegistryEntryForTestOptions<
	TClient extends TokenSetClientRegistryClient,
> = CreateTokenSetClientRegistryEntryForTestOptionsBase &
	(
		| {
				readonly client: TClient;
				readonly clientFactory?: never;
		  }
		| {
				readonly client?: never;
				readonly clientFactory: TokenSetClientFactory<TClient>;
		  }
	);

export function createTokenSetClientRegistryEntryForTest<
	TClient extends TokenSetClientRegistryClient,
>(
	options: CreateTokenSetClientRegistryEntryForTestOptions<TClient>,
): TokenSetClientRegistryEntry<TClient> {
	const clientFactory = options.clientFactory
		? options.clientFactory
		: () => options.client;
	return {
		clientFactory,
		meta: {
			clientKey: options.clientKey,
			urlPatterns: options.urlPatterns ?? [],
			callbackUrl: options.callbackUrl,
			requirementKind: options.requirementKind,
			providerFamily: options.providerFamily,
			initialization:
				options.initialization ?? TokenSetClientInitializationMode.Lazy,
		},
	};
}

export interface CreateTokenSetClientRegistryForTestOptions<
	TClient extends TokenSetClientRegistryClient = BaseOidcModeClient,
> {
	readonly environment?: FoundationEnvironment;
	readonly entries?: readonly TokenSetClientRegistryEntry<TClient>[];
}

export function createTokenSetClientRegistryForTest<
	TClient extends TokenSetClientRegistryClient = BaseOidcModeClient,
>(
	options: CreateTokenSetClientRegistryForTestOptions<TClient> = {},
): TokenSetClientRegistry<TClient> {
	return TokenSetClientRegistry.fromEnvironmentConfig({
		environment: options.environment ?? createEnvironmentForTest(),
		entries: options.entries,
	});
}
