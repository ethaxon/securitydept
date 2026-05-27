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

import {
	type FoundationEnvironment,
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
	tryInjectInInjectionContext,
} from "@securitydept/client";
import {
	TokenSetAuthRegistry as CoreTokenSetAuthRegistry,
	createTokenSetOidcAuthRegistry,
} from "@securitydept/token-set-context-client/registry";
import {
	type TokenSetClientEntry,
	type TokenSetReactClient,
} from "./contracts";

export type ReactRegistry = CoreTokenSetAuthRegistry<
	TokenSetReactClient,
	TokenSetReactClient
>;

export const TOKEN_SET_AUTH_REGISTRY =
	new SecuritydeptInjectionToken<ReactRegistry>("TOKEN_SET_AUTH_REGISTRY");

export interface ProvideTokenSetAuthRegistryOptions {
	clients: readonly TokenSetClientEntry[];
	environment?: FoundationEnvironment;
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
		useFactory: () => createReactTokenSetAuthRegistry(input),
	};
}

function createReactTokenSetAuthRegistry({
	clients,
	environment,
}: ProvideTokenSetAuthRegistryOptions): ReactRegistry {
	const registry = createTokenSetOidcAuthRegistry<TokenSetReactClient>({
		environment,
	});
	tryInjectInInjectionContext(SecuritydeptDestroyRef, {
		optional: true,
	})?.onDestroy(() => registry.dispose());
	registerTokenSetClients(registry, clients);
	return registry;
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
