import { InjectionToken, type Provider } from "@angular/core";
import { type FoundationEnvironment } from "@securitydept/client";

export const ENVIRONMENT = new InjectionToken<FoundationEnvironment>(
	"ENVIRONMENT",
);

export interface ProvideEnvironmentOptions {
	/**
	 * Stable host-owned environment used by Angular adapters.
	 */
	environment: FoundationEnvironment;
}

export function provideEnvironment(
	options: ProvideEnvironmentOptions,
): Provider {
	return {
		provide: ENVIRONMENT,
		useValue: options.environment,
	};
}
