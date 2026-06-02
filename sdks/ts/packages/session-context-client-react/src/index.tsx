// React adapter for @securitydept/session-context-client
//
// Canonical import path:
//   import { ... } from "@securitydept/session-context-client-react"
//
// Provides Securitydept DI integration: injection tokens, provider factory,
// and a SessionContextClient subclass.

import {
	ENVIRONMENT_TOKEN,
	INJECTOR_TOKEN,
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	type SecuritydeptInjector,
	type SecuritydeptProvider,
} from "@securitydept/client";
import {
	SessionContextClient,
	type SessionContextClientConfig,
	type SessionInfo,
} from "@securitydept/session-context-client";

export {
	SessionContextClient,
	type SessionContextClientConfig,
	type SessionInfo,
};

export const SESSION_CONTEXT_CLIENT =
	new SecuritydeptInjectionToken<SessionContextClient>(
		"SESSION_CONTEXT_CLIENT",
	);

export const SESSION_CONTEXT_CLIENT_CONFIG =
	new SecuritydeptInjectionToken<SessionContextClientConfig>(
		"SESSION_CONTEXT_CLIENT_CONFIG",
	);

export class SessionContextService extends SessionContextClient {
	constructor(injector: SecuritydeptInjector) {
		const config = injector.get(SESSION_CONTEXT_CLIENT_CONFIG);
		const environment = injector.get(ENVIRONMENT_TOKEN);
		super(config, environment);
		injector.get(SecuritydeptDestroyRef, null)?.onDestroy(() => this.dispose());
	}
}

export interface ProvideSessionContextOptions {
	config: SessionContextClientConfig;
}

export function provideSessionContext(
	options: ProvideSessionContextOptions,
): readonly SecuritydeptProvider[] {
	return [
		{
			provide: SESSION_CONTEXT_CLIENT_CONFIG,
			useValue: options.config,
		},
		{
			provide: SessionContextService,
			useFactory: (injector: SecuritydeptInjector) =>
				new SessionContextService(injector),
			deps: [INJECTOR_TOKEN],
		},
		{
			provide: SESSION_CONTEXT_CLIENT,
			useExisting: SessionContextService,
		},
	];
}
