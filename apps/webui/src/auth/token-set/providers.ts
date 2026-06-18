import {
	ClientError,
	ClientErrorKind,
	type SecuritydeptProvider,
	UriRelativeString,
} from "@securitydept/client";
import { createBackendOidcModeClientFactory } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	createFrontendOidcModeClientFactory,
	FrontendOidcModeConfigProjectionSourceKind,
	resolveFrontendOidcModeConfigProjection,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	provideTokenSetClientRegistry,
	TokenSetClientInitializationMode,
	type TokenSetClientRegistryEntry,
	TokenSetRequirementKind,
} from "@securitydept/token-set-context-client/registry";
import {
	TOKEN_SET_BACKEND_MODE_CONFIG,
	TOKEN_SET_FRONTEND_MODE_CONFIG,
} from "./config";
import { provideTokenSetTracing, TokenSetTracingService } from "./tracing";

export function provideWebuiTokenSetContext(): readonly SecuritydeptProvider[] {
	return [
		...provideTokenSetTracing(),
		...provideTokenSetClientRegistry({
			createClients: (_injector, _tracingService: TokenSetTracingService) =>
				createWebuiTokenSetClientEntries(),
			dependencies: [TokenSetTracingService],
		}),
	];
}

export function createWebuiTokenSetClientEntries(): readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[] {
	const frontendModeMeta = {
		clientKey: TOKEN_SET_FRONTEND_MODE_CONFIG.clientKey,
		urlPatterns: [],
		callbackUrl: [TOKEN_SET_FRONTEND_MODE_CONFIG.paths.callback],
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
			clientFactory: createBackendOidcModeClientFactory({
				config: {
					baseUrl: "",
					defaultPostAuthRedirectUri: "/",
					loginPath: TOKEN_SET_BACKEND_MODE_CONFIG.paths.login,
					refreshPath: TOKEN_SET_BACKEND_MODE_CONFIG.paths.refresh,
					metadataRedeemPath:
						TOKEN_SET_BACKEND_MODE_CONFIG.paths.metadataRedeem,
					userInfoPath: TOKEN_SET_BACKEND_MODE_CONFIG.paths.userInfo,
				},
			}),
		},
		{
			meta: frontendModeMeta,
			clientFactory: createFrontendOidcModeClientFactory({
				config: async ({ cancellationToken, environment, meta }) => {
					cancellationToken.throwIfCancellationRequested();
					const currentUrl = environment.router?.currentUrl();
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
						clientKey: meta.clientKey,
						environment,
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
					return config;
				},
			}),
		},
	];
}
