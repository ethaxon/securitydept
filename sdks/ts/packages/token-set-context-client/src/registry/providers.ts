import {
	INJECTOR_TOKEN,
	type SecuritydeptInjectorTrait,
	type SecuritydeptProvider,
} from "@securitydept/client";
import { type BaseOidcModeClient } from "../orchestration/client/base-client";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
} from "./contracts/tokens";
import { type TokenSetClientRegistryEntry } from "./contracts/types";
import { TokenSetClientRegistry } from "./core/client-registry";

export type ProvideTokenSetClientRegistryOptions =
	| {
			readonly clients?: readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[];
			readonly createClients?: never;
	  }
	| {
			readonly clients?: never;
			readonly createClients: (
				injector: SecuritydeptInjectorTrait,
			) => readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[];
	  };

export function provideTokenSetClientRegistry(
	options: ProvideTokenSetClientRegistryOptions = {},
): readonly SecuritydeptProvider[] {
	return [
		options.createClients
			? {
					provide: TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
					useFactory: options.createClients,
					deps: [INJECTOR_TOKEN],
				}
			: {
					provide: TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
					useValue: options.clients ?? [],
				},
		{
			provide: TOKEN_SET_CLIENT_REGISTRY,
			useFactory: (injector: SecuritydeptInjectorTrait) =>
				TokenSetClientRegistry.fromInjector(injector),
			deps: [INJECTOR_TOKEN],
		},
	];
}
