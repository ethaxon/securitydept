import {
	ClientError,
	ClientErrorKind,
	type FoundationEnvironment,
	UriRelativeString,
} from "@securitydept/client";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	FrontendOidcModeClient,
	FrontendOidcModeConfigProjectionSourceKind,
	resolveFrontendOidcModeConfigProjection,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientRegistryEntry,
	TokenSetRequirementKind,
} from "@securitydept/token-set-context-client/registry";
import {
	TOKEN_SET_BACKEND_MODE_CONFIG,
	TOKEN_SET_FRONTEND_MODE_CONFIG,
} from "./config";

export interface CreateWebuiTokenSetClientEntriesOptions {
	readonly environment: FoundationEnvironment;
}

export function createWebuiTokenSetClientEntries(
	options: CreateWebuiTokenSetClientEntriesOptions,
): readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[] {
	const frontendModeMeta = {
		clientKey: TOKEN_SET_FRONTEND_MODE_CONFIG.clientKey,
		urlPatterns: [],
		callbackPath: TOKEN_SET_FRONTEND_MODE_CONFIG.paths.callback,
		requirementKind: TokenSetRequirementKind.FrontendOidc,
		initialization: TokenSetClientInitializationMode.Lazy,
	} as const;

	return [
		{
			meta: {
				clientKey: TOKEN_SET_BACKEND_MODE_CONFIG.clientKey,
				urlPatterns: [],
				requirementKind: TokenSetRequirementKind.BackendOidc,
				initialization: TokenSetClientInitializationMode.Lazy,
			},
			clientFactory: async ({ cancellationToken }) => {
				cancellationToken.throwIfCancellationRequested();
				const client = new BackendOidcModeClient(
					{
						baseUrl: "",
						defaultPostAuthRedirectUri: "/",
						loginPath: TOKEN_SET_BACKEND_MODE_CONFIG.paths.login,
						refreshPath: TOKEN_SET_BACKEND_MODE_CONFIG.paths.refresh,
						metadataRedeemPath:
							TOKEN_SET_BACKEND_MODE_CONFIG.paths.metadataRedeem,
						userInfoPath: TOKEN_SET_BACKEND_MODE_CONFIG.paths.userInfo,
					},
					{
						environment: options.environment,
						callbackRoutingKey: TOKEN_SET_BACKEND_MODE_CONFIG.clientKey,
					},
				);
				try {
					await client.start();
					cancellationToken.throwIfCancellationRequested();
					return client;
				} catch (error) {
					client.dispose();
					throw error;
				}
			},
		},
		{
			meta: frontendModeMeta,
			clientFactory: async ({ cancellationToken }) => {
				cancellationToken.throwIfCancellationRequested();
				const currentUrl = options.environment.router?.currentUrl();
				if (!currentUrl?.isAbsolute()) {
					throw new ClientError({
						kind: ClientErrorKind.Configuration,
						code: "webui.frontend_oidc.current_url_unavailable",
						message:
							"Frontend OIDC client creation requires an absolute current URL from environment.router",
						source: "webui.auth",
					});
				}

				const redirectUri = UriRelativeString.parse(
					TOKEN_SET_FRONTEND_MODE_CONFIG.paths.callback,
				)
					.toURL(currentUrl.toString())
					.toString();
				const configEndpoint = UriRelativeString.parse(
					TOKEN_SET_FRONTEND_MODE_CONFIG.paths.configProjection,
				).setSearchParams({ redirect_uri: redirectUri });
				const { config } = await resolveFrontendOidcModeConfigProjection({
					clientKey: frontendModeMeta.clientKey,
					environment: options.environment,
					sources: [
						{
							kind: FrontendOidcModeConfigProjectionSourceKind.Realm,
						},
						{
							kind: FrontendOidcModeConfigProjectionSourceKind.Persisted,
						},
						{
							kind: FrontendOidcModeConfigProjectionSourceKind.Network,
							endpoint: configEndpoint.toString(),
						},
					],
					overrides: {
						redirectUri,
						defaultPostAuthRedirectUri: "/",
					},
					cancellationToken,
				});
				cancellationToken.throwIfCancellationRequested();
				const client = new FrontendOidcModeClient(config, {
					environment: options.environment,
				});
				try {
					await client.start();
					cancellationToken.throwIfCancellationRequested();
					return client;
				} catch (error) {
					client.dispose();
					throw error;
				}
			},
		},
	];
}
