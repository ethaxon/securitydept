import { type OidcModeCallbackResolutionOptions } from "../../orchestration/client/types";
import {
	type TokenSetClientFactory,
	type TokenSetClientFactoryOptions,
} from "../../registry/contracts/types";
import { type BackendOidcModeCallbackInput } from "../contracts/callback";
import { createDefaultBackendOidcModeCallbackInputResolver } from "./callback-input-resolver";
import { BackendOidcModeClient } from "./client";
import { type BackendOidcModeClientConfig } from "./types";

interface CreateBackendOidcModeClientFactoryOptionsBase {
	readonly config:
		| BackendOidcModeClientConfig
		| ((
				options: TokenSetClientFactoryOptions,
		  ) => BackendOidcModeClientConfig | Promise<BackendOidcModeClientConfig>);
	/** Defaults to the registry entry's client key. Pass null for kind-only routing. */
	readonly callbackRoutingKey?: string | null;
}

export type CreateBackendOidcModeClientFactoryOptions =
	CreateBackendOidcModeClientFactoryOptionsBase &
		OidcModeCallbackResolutionOptions<BackendOidcModeCallbackInput>;

export function createBackendOidcModeClientFactory(
	options: CreateBackendOidcModeClientFactoryOptions,
): TokenSetClientFactory<BackendOidcModeClient> {
	return async (factoryOptions) => {
		const { cancellationToken, environment, meta } = factoryOptions;
		cancellationToken.throwIfCancellationRequested();
		const config =
			typeof options.config === "function"
				? await options.config(factoryOptions)
				: options.config;
		cancellationToken.throwIfCancellationRequested();

		const callbackRoutingKey =
			options.callbackRoutingKey === undefined
				? meta.clientKey
				: (options.callbackRoutingKey ?? undefined);
		const callbackInputResolver =
			options.callbackInputResolver === undefined
				? createDefaultBackendOidcModeCallbackInputResolver({
						callbackRoutingKey,
						callbackInputPredicate: options.callbackInputPredicate,
					})
				: options.callbackInputResolver;
		const client = new BackendOidcModeClient(config, {
			environment,
			callbackRoutingKey,
			callbackInputResolver,
		});
		try {
			await client.start();
			cancellationToken.throwIfCancellationRequested();
			return client;
		} catch (error) {
			client.dispose();
			throw error;
		}
	};
}
