import {
	InjectionToken,
	Injector,
	Optional,
	type Provider,
} from "@angular/core";
import {
	type FoundationEnvironment,
	type SecuritydeptProvider,
} from "@securitydept/client";

export const ENVIRONMENT = new InjectionToken<FoundationEnvironment>(
	"ENVIRONMENT",
);

export const ENVIRONMENT_PROVIDER = new InjectionToken<SecuritydeptProvider>(
	"ENVIRONMENT_PROVIDER",
);

export interface ProvideEnvironmentOptions {
	/**
	 * Create the host-owned environment with Angular adapter providers included.
	 */
	environment: (
		ngProviders: readonly SecuritydeptProvider[],
	) => FoundationEnvironment;
}

export function provideEnvironment(
	options: ProvideEnvironmentOptions,
): Provider[] {
	return [
		{
			provide: ENVIRONMENT_PROVIDER,
			useFactory: (injector: Injector): SecuritydeptProvider => ({
				useValue: injector,
				provide: Injector,
			}),
			deps: [Injector],
			multi: true,
		},
		{
			provide: ENVIRONMENT,
			useFactory: (providers: readonly SecuritydeptProvider[] | null) =>
				options.environment(providers ?? []),
			deps: [[ENVIRONMENT_PROVIDER, new Optional()]],
		},
	];
}

export function provideEnvironmentProvider(
	provider: SecuritydeptProvider,
): Provider {
	return {
		provide: ENVIRONMENT_PROVIDER,
		useValue: provider,
		multi: true,
	};
}
