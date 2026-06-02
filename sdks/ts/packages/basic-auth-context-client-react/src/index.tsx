// React adapter for @securitydept/basic-auth-context-client
//
// Canonical import path:
//   import { ... } from "@securitydept/basic-auth-context-client-react"
//
// Provides Securitydept DI integration: injection tokens, provider factory,
// and a BasicAuthContextClient subclass.

import {
	BasicAuthContextClient,
	type BasicAuthContextClientConfig,
} from "@securitydept/basic-auth-context-client";
import {
	ENVIRONMENT_TOKEN,
	INJECTOR_TOKEN,
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	type SecuritydeptInjector,
	type SecuritydeptProvider,
} from "@securitydept/client";

export { BasicAuthContextClient, type BasicAuthContextClientConfig };

export const BASIC_AUTH_CONTEXT_CLIENT =
	new SecuritydeptInjectionToken<BasicAuthContextClient>(
		"BASIC_AUTH_CONTEXT_CLIENT",
	);

export const BASIC_AUTH_CONTEXT_CLIENT_CONFIG =
	new SecuritydeptInjectionToken<BasicAuthContextClientConfig>(
		"BASIC_AUTH_CONTEXT_CLIENT_CONFIG",
	);

export class BasicAuthContextService extends BasicAuthContextClient {
	constructor(injector: SecuritydeptInjector) {
		const config = injector.get(BASIC_AUTH_CONTEXT_CLIENT_CONFIG);
		const environment = injector.get(ENVIRONMENT_TOKEN);
		super(config, environment);
		injector.get(SecuritydeptDestroyRef, null)?.onDestroy(() => this.dispose());
	}
}

export interface ProvideBasicAuthContextOptions {
	config: BasicAuthContextClientConfig;
}

export function provideBasicAuthContext(
	options: ProvideBasicAuthContextOptions,
): readonly SecuritydeptProvider[] {
	return [
		{
			provide: BASIC_AUTH_CONTEXT_CLIENT_CONFIG,
			useValue: options.config,
		},
		{
			provide: BasicAuthContextService,
			useFactory: (injector: SecuritydeptInjector) =>
				new BasicAuthContextService(injector),
			deps: [INJECTOR_TOKEN],
		},
		{
			provide: BASIC_AUTH_CONTEXT_CLIENT,
			useExisting: BasicAuthContextService,
		},
	];
}
