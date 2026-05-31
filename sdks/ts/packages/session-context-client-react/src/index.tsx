// Session Context Client — injector tokens and provider factories

import {
	type FoundationEnvironment,
	SecuritydeptInjectionToken,
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

export interface CreateSessionContextClientOptions {
	config: SessionContextClientConfig;
	environment: FoundationEnvironment;
}

export function createSessionContextClient({
	config,
	environment,
}: CreateSessionContextClientOptions): SessionContextClient {
	return new SessionContextClient(config, environment);
}

export function provideSessionContextClient(
	client: SessionContextClient,
): readonly SecuritydeptProvider[] {
	return [
		{
			provide: SESSION_CONTEXT_CLIENT,
			useValue: client,
		},
	];
}
