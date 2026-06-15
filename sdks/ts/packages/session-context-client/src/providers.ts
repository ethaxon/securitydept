import {
	INJECTOR_TOKEN,
	type SecuritydeptInjectorTrait,
	type SecuritydeptProvider,
} from "@securitydept/client";
import { SessionContextClient } from "./client";
import {
	SESSION_CONTEXT_CLIENT,
	SESSION_CONTEXT_CLIENT_CONFIG,
} from "./tokens";
import { type SessionContextClientConfig } from "./types";

export interface ProvideSessionContextOptions {
	readonly config: SessionContextClientConfig;
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
			provide: SESSION_CONTEXT_CLIENT,
			useFactory: (injector: SecuritydeptInjectorTrait) =>
				SessionContextClient.fromInjector(injector),
			deps: [INJECTOR_TOKEN],
		},
	];
}
