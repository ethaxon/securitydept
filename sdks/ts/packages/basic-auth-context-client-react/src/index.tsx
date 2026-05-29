// Basic Auth Context Client — injector tokens and provider factories
//
// Canonical import path:
//   import { ... } from "@securitydept/basic-auth-context-client-react"
//
// Provides injector tokens and plain factories for integrating
// BasicAuthContextClient. React trees compose these through
// SecuritydeptProvider; no domain-specific React Context is created here.
//
// Stability: provisional (React adapter)

import {
	BasicAuthContextClient,
	type BasicAuthContextClientConfig,
} from "@securitydept/basic-auth-context-client";
import {
	type FoundationEnvironment,
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
} from "@securitydept/client";

export const BASIC_AUTH_CONTEXT_CLIENT =
	new SecuritydeptInjectionToken<BasicAuthContextClient>(
		"BASIC_AUTH_CONTEXT_CLIENT",
	);

export interface CreateBasicAuthContextClientOptions {
	config: BasicAuthContextClientConfig;
	environment: FoundationEnvironment;
}

export function createBasicAuthContextClient(
	options: CreateBasicAuthContextClientOptions,
): BasicAuthContextClient {
	return new BasicAuthContextClient(options.config, options.environment);
}

export function provideBasicAuthContextClient(
	client: BasicAuthContextClient,
): SecuritydeptProvider<BasicAuthContextClient> {
	return {
		provide: BASIC_AUTH_CONTEXT_CLIENT,
		useValue: client,
	};
}
