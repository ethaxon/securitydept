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

import type { BasicAuthContextClientConfig } from "@securitydept/basic-auth-context-client";
import { BasicAuthContextClient } from "@securitydept/basic-auth-context-client";
import {
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
} from "@securitydept/client/injection";

export type { BasicAuthContextClientConfig };
export { BasicAuthContextClient };

export const BASIC_AUTH_CONTEXT_CLIENT =
	new SecuritydeptInjectionToken<BasicAuthContextClient>(
		"BASIC_AUTH_CONTEXT_CLIENT",
	);

export function createBasicAuthContextClient(
	config: BasicAuthContextClientConfig,
): BasicAuthContextClient {
	return new BasicAuthContextClient(config);
}

export function provideBasicAuthContextClient(
	client: BasicAuthContextClient,
): SecuritydeptProvider<BasicAuthContextClient> {
	return {
		provide: BASIC_AUTH_CONTEXT_CLIENT,
		useValue: client,
	};
}
