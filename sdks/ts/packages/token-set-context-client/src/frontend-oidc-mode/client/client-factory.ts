import { type OidcModeCallbackResolutionOptions } from "../../orchestration/client/types";
import {
	type TokenSetClientFactory,
	type TokenSetClientFactoryOptions,
} from "../../registry/contracts/types";
import { type FrontendOidcModeCallbackInput } from "../contracts/callback";
import { createDefaultFrontendOidcModeCallbackInputResolver } from "./callback-input-resolver";
import { FrontendOidcModeClient } from "./client";
import { type FrontendOidcModeClientConfig } from "./types";

interface CreateFrontendOidcModeClientFactoryOptionsBase {
	readonly config:
		| FrontendOidcModeClientConfig
		| ((
				options: TokenSetClientFactoryOptions,
		  ) =>
				| FrontendOidcModeClientConfig
				| Promise<FrontendOidcModeClientConfig>);
}

export type CreateFrontendOidcModeClientFactoryOptions =
	CreateFrontendOidcModeClientFactoryOptionsBase &
		OidcModeCallbackResolutionOptions<FrontendOidcModeCallbackInput>;

export function createFrontendOidcModeClientFactory(
	options: CreateFrontendOidcModeClientFactoryOptions,
): TokenSetClientFactory<FrontendOidcModeClient> {
	return async (factoryOptions) => {
		const { cancellationToken, environment, meta } = factoryOptions;
		cancellationToken.throwIfCancellationRequested();
		const config =
			typeof options.config === "function"
				? await options.config(factoryOptions)
				: options.config;
		cancellationToken.throwIfCancellationRequested();

		const callbackInputResolver =
			options.callbackInputResolver === undefined
				? createDefaultFrontendOidcModeCallbackInputResolver({
						redirectUriCandidates: meta.callbackUrl ?? config.redirectUri,
						callbackInputPredicate: options.callbackInputPredicate,
					})
				: options.callbackInputResolver;
		const client = FrontendOidcModeClient.fromEnvironmentConfig({
			config,
			environment,
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
