import { InjectionToken, type Provider } from "@angular/core";
import {
	type BasicAuthContextClient,
	BASIC_AUTH_CONTEXT_CLIENT as CORE_BASIC_AUTH_CONTEXT_CLIENT,
	type ProvideBasicAuthContextOptions,
	provideBasicAuthContext as provideCoreBasicAuthContext,
} from "@securitydept/basic-auth-context-client";
import { type FoundationEnvironment } from "@securitydept/client";
import {
	ENVIRONMENT,
	provideEnvironmentProvider,
} from "@securitydept/client-angular";

export const BASIC_AUTH_CONTEXT_CLIENT =
	new InjectionToken<BasicAuthContextClient>("BASIC_AUTH_CONTEXT_CLIENT");

export { type ProvideBasicAuthContextOptions };

export function provideBasicAuthContext(
	options: ProvideBasicAuthContextOptions,
): Provider[] {
	return [
		...provideCoreBasicAuthContext(options).map(provideEnvironmentProvider),
		{
			provide: BASIC_AUTH_CONTEXT_CLIENT,
			useFactory: (environment: FoundationEnvironment) =>
				environment.injector.get(CORE_BASIC_AUTH_CONTEXT_CLIENT),
			deps: [ENVIRONMENT],
		},
	];
}
