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
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
	tryInjectInInjectionContext,
} from "@securitydept/client";
import {
	ClientInitializationMode,
	ClientRegistry as CoreClientRegistry,
	type ClientRegistryEntry as CoreClientRegistryEntry,
	createClientRegistry,
} from "@securitydept/token-set-context-client/registry";
import {
	type TokenSetClientEntry,
	type TokenSetReactClient,
} from "./contracts";

export type ReactRegistry = CoreClientRegistry<TokenSetReactClient>;

export const TOKEN_SET_AUTH_REGISTRY =
	new SecuritydeptInjectionToken<ReactRegistry>("TOKEN_SET_AUTH_REGISTRY");

export interface ProvideTokenSetAuthRegistryOptions {
	clients: readonly TokenSetClientEntry[];
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
	if (input instanceof CoreClientRegistry) {
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
}: ProvideTokenSetAuthRegistryOptions): ReactRegistry {
	const registry = createClientRegistry<TokenSetReactClient>({
		environment: {},
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
		registry.register(toCoreEntry(entry));
	}
}

function toCoreEntry(
	entry: TokenSetClientEntry,
): CoreClientRegistryEntry<TokenSetReactClient> {
	return {
		clientFactory: entry.clientFactory,
		meta: {
			clientKey: entry.key,
			urlPatterns: entry.urlPatterns ?? [],
			callbackPath: entry.callbackPath,
			requirementKind: entry.requirementKind,
			providerFamily: entry.providerFamily,
			initialization:
				entry.initialization ?? ClientInitializationMode.Immediate,
		},
	};
}
