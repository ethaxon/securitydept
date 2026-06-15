import { InjectionToken, type Provider } from "@angular/core";
import { type FoundationEnvironment } from "@securitydept/client";
import {
	ENVIRONMENT,
	provideEnvironmentProvider,
} from "@securitydept/client-angular";
import {
	SESSION_CONTEXT_CLIENT as CORE_SESSION_CONTEXT_CLIENT,
	type ProvideSessionContextOptions,
	provideSessionContext as provideCoreSessionContext,
	type SessionContextClient,
} from "@securitydept/session-context-client";

export const SESSION_CONTEXT_CLIENT = new InjectionToken<SessionContextClient>(
	"SESSION_CONTEXT_CLIENT",
);

export { type ProvideSessionContextOptions };

export function provideSessionContext(
	options: ProvideSessionContextOptions,
): Provider[] {
	return [
		...provideCoreSessionContext(options).map(provideEnvironmentProvider),
		{
			provide: SESSION_CONTEXT_CLIENT,
			useFactory: (environment: FoundationEnvironment) =>
				environment.injector.get(CORE_SESSION_CONTEXT_CLIENT),
			deps: [ENVIRONMENT],
		},
	];
}
