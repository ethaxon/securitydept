// Session Context Client — injector tokens and provider factories
//
// Canonical import path:
//   import { ... } from "@securitydept/session-context-client-react"
//
// Provides injector tokens and plain factories for integrating
// SessionContextClient and SessionContextController. React trees compose
// these through SecuritydeptProvider; no domain-specific React Context is
// created here.
//
// Stability: provisional (React adapter)

import type { WebClientEnvironment } from "@securitydept/client";
import {
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
} from "@securitydept/client/injection";
import type {
	SessionContextClientConfig,
	SessionInfo,
} from "@securitydept/session-context-client";
import {
	SessionContextClient,
	SessionContextController,
} from "@securitydept/session-context-client";

export type { SessionContextClientConfig, SessionInfo };
export { SessionContextClient, SessionContextController };

export const SESSION_CONTEXT_CLIENT =
	new SecuritydeptInjectionToken<SessionContextClient>(
		"SESSION_CONTEXT_CLIENT",
	);

export const SESSION_CONTEXT_CONTROLLER =
	new SecuritydeptInjectionToken<SessionContextController>(
		"SESSION_CONTEXT_CONTROLLER",
	);

export interface CreateSessionContextControllerOptions {
	config: SessionContextClientConfig;
	environment: WebClientEnvironment;
}

export function createSessionContextController({
	config,
	environment,
}: CreateSessionContextControllerOptions): SessionContextController {
	return new SessionContextController({
		client: new SessionContextClient(config, {
			sessionStore: environment.sessionStore,
		}),
		transport: environment.transport,
	});
}

export function provideSessionContextController(
	controller: SessionContextController,
): readonly SecuritydeptProvider[] {
	return [
		{
			provide: SESSION_CONTEXT_CONTROLLER,
			useValue: controller,
		},
		{
			provide: SESSION_CONTEXT_CLIENT,
			useValue: controller.client,
		},
	];
}
