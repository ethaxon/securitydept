import {
	INJECTOR_TOKEN,
	type SecuritydeptInjectorTrait,
	type SecuritydeptProvider,
} from "@securitydept/client";
import { BasicAuthContextClient } from "./client";
import {
	BASIC_AUTH_CONTEXT_CLIENT,
	BASIC_AUTH_CONTEXT_CLIENT_CONFIG,
} from "./tokens";
import { type BasicAuthContextClientConfig } from "./types";

export interface ProvideBasicAuthContextOptions {
	readonly config: BasicAuthContextClientConfig;
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
			provide: BASIC_AUTH_CONTEXT_CLIENT,
			useFactory: (injector: SecuritydeptInjectorTrait) =>
				BasicAuthContextClient.fromInjector(injector),
			deps: [INJECTOR_TOKEN],
		},
	];
}
