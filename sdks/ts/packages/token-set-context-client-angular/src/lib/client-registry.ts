import { InjectionToken, type Provider } from "@angular/core";
import { type FoundationEnvironment } from "@securitydept/client";
import {
	ENVIRONMENT,
	provideEnvironmentProvider,
} from "@securitydept/client-angular";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TOKEN_SET_CLIENT_REGISTRY as CORE_TOKEN_SET_CLIENT_REGISTRY,
	type ProvideTokenSetClientRegistryOptions,
	provideTokenSetClientRegistry as provideCoreTokenSetClientRegistry,
	type TokenSetClientRegistry,
} from "@securitydept/token-set-context-client/registry";

export const TOKEN_SET_CLIENT_REGISTRY = new InjectionToken<
	TokenSetClientRegistry<BaseOidcModeClient>
>("TOKEN_SET_CLIENT_REGISTRY");

export { type ProvideTokenSetClientRegistryOptions };

export function provideTokenSetClientRegistry(
	options: ProvideTokenSetClientRegistryOptions = {},
): Provider[] {
	return [
		...provideCoreTokenSetClientRegistry(options).map(
			provideEnvironmentProvider,
		),
		{
			provide: TOKEN_SET_CLIENT_REGISTRY,
			useFactory: (environment: FoundationEnvironment) =>
				environment.injector.get(CORE_TOKEN_SET_CLIENT_REGISTRY),
			deps: [ENVIRONMENT],
		},
	];
}
