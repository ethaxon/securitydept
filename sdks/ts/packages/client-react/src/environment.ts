import {
	type FoundationEnvironment,
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
} from "@securitydept/client";

export const ENVIRONMENT =
	new SecuritydeptInjectionToken<FoundationEnvironment>("ENVIRONMENT");

export interface ProvideEnvironmentOptions {
	environment: FoundationEnvironment;
}

export function provideEnvironment(
	options: ProvideEnvironmentOptions,
): SecuritydeptProvider<FoundationEnvironment> {
	return {
		provide: ENVIRONMENT,
		useValue: options.environment,
	};
}
