import {
	INJECTOR_TOKEN,
	type SecuritydeptInjectorTrait,
	type SecuritydeptProvider,
} from "@securitydept/client";
import { FrontendOidcModeClient } from "./client/client";
import {
	FRONTEND_OIDC_MODE_CLIENT,
	FRONTEND_OIDC_MODE_CLIENT_OPTIONS,
	type FrontendOidcModeClientInjectionOptions,
} from "./tokens";

export type ProvideFrontendOidcModeClientOptions =
	FrontendOidcModeClientInjectionOptions;

export function provideFrontendOidcModeClient(
	options: ProvideFrontendOidcModeClientOptions,
): readonly SecuritydeptProvider[] {
	return [
		{
			provide: FRONTEND_OIDC_MODE_CLIENT_OPTIONS,
			useValue: options,
		},
		{
			provide: FRONTEND_OIDC_MODE_CLIENT,
			useFactory: (injector: SecuritydeptInjectorTrait) =>
				FrontendOidcModeClient.fromInjector(injector),
			deps: [INJECTOR_TOKEN],
		},
	];
}
