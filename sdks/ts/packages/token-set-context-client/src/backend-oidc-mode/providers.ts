import {
	INJECTOR_TOKEN,
	type SecuritydeptInjectorTrait,
	type SecuritydeptProvider,
} from "@securitydept/client";
import { BackendOidcModeClient } from "./client/client";
import {
	BACKEND_OIDC_MODE_CLIENT,
	BACKEND_OIDC_MODE_CLIENT_OPTIONS,
	type BackendOidcModeClientInjectionOptions,
} from "./tokens";

export type ProvideBackendOidcModeClientOptions =
	BackendOidcModeClientInjectionOptions;

export function provideBackendOidcModeClient(
	options: ProvideBackendOidcModeClientOptions,
): readonly SecuritydeptProvider[] {
	return [
		{
			provide: BACKEND_OIDC_MODE_CLIENT_OPTIONS,
			useValue: options,
		},
		{
			provide: BACKEND_OIDC_MODE_CLIENT,
			useFactory: (injector: SecuritydeptInjectorTrait) =>
				BackendOidcModeClient.fromInjector(injector),
			deps: [INJECTOR_TOKEN],
		},
	];
}
