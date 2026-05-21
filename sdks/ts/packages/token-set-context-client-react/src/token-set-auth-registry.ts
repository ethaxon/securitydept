// Multi-client token-set runtime helpers for React integration.
//
// Canonical usage wires keyed registry access through SecuritydeptProvider:
//   <SecuritydeptProvider providers={[provideTokenSetAuthRegistry({ clients })]}>
//     <App />
//   </SecuritydeptProvider>
//
// Callback resume wiring is opt-in and composed separately through
// `provideTokenSetCallbackResumeController(...)` when a host actually needs it.
//
// No domain-specific React Context or provider components are defined here.
// Stability: provisional

import { createDefaultIdleScheduler } from "@securitydept/client";
import {
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
	tryInjectInInjectionContext,
} from "@securitydept/client/injection";
import {
	TokenSetAuthRegistry as CoreTokenSetAuthRegistry,
	TokenSetAuthService as CoreTokenSetAuthService,
} from "@securitydept/token-set-context-client/registry";
import type { TokenSetClientEntry, TokenSetReactClient } from "./contracts";

type ReactTokenSetAuthService = CoreTokenSetAuthService<TokenSetReactClient>;

export type ReactRegistry = CoreTokenSetAuthRegistry<
	TokenSetReactClient,
	ReactTokenSetAuthService
>;

export const TOKEN_SET_AUTH_REGISTRY =
	new SecuritydeptInjectionToken<ReactRegistry>("TOKEN_SET_AUTH_REGISTRY");

export interface ProvideTokenSetAuthRegistryOptions {
	clients: readonly TokenSetClientEntry[];
}

class ReactTokenSetAuthRegistry extends CoreTokenSetAuthRegistry<
	TokenSetReactClient,
	ReactTokenSetAuthService
> {
	constructor({ clients }: ProvideTokenSetAuthRegistryOptions) {
		super({
			materialize: CoreTokenSetAuthService.materializeService,
			dispose: CoreTokenSetAuthService.dispose,
			accessTokenOf: CoreTokenSetAuthService.accessTokenOf,
			ensureAccessTokenOf: CoreTokenSetAuthService.ensureAccessTokenOf,
			ensureAuthorizationHeaderOf:
				CoreTokenSetAuthService.ensureAuthorizationHeaderOf,
			ensureAuthForResourceOf: CoreTokenSetAuthService.ensureAuthForResourceOf,
			authEventsOf: CoreTokenSetAuthService.authEventsOf,
			idleScheduler: createDefaultIdleScheduler(),
		});

		tryInjectInInjectionContext(SecuritydeptDestroyRef, {
			optional: true,
		})?.onDestroy(() => this.dispose());
		registerTokenSetClients(this, clients);
	}
}

export function provideTokenSetAuthRegistry(
	options: ProvideTokenSetAuthRegistryOptions,
): SecuritydeptProvider<ReactRegistry>;
export function provideTokenSetAuthRegistry(
	registry: ReactRegistry,
): SecuritydeptProvider<ReactRegistry>;
export function provideTokenSetAuthRegistry(
	input: ReactRegistry | ProvideTokenSetAuthRegistryOptions,
): SecuritydeptProvider<ReactRegistry> {
	if (input instanceof CoreTokenSetAuthRegistry) {
		return {
			provide: TOKEN_SET_AUTH_REGISTRY,
			useValue: input,
		};
	}

	return {
		provide: TOKEN_SET_AUTH_REGISTRY,
		useFactory: () => new ReactTokenSetAuthRegistry(input),
	};
}

function registerTokenSetClients(
	registry: ReactRegistry,
	clients: readonly TokenSetClientEntry[],
): void {
	for (const entry of clients) {
		const result = registry.register(entry);
		if (result instanceof Promise) {
			result.catch(() => {});
		}
	}
}
