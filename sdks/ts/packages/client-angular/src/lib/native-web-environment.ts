import { InjectionToken, type Provider } from "@angular/core";
import { type NativeWebEnvironment } from "@securitydept/client/web";

export type NativeWebEnvironmentValue = NativeWebEnvironment;

export const NATIVE_WEB_ENVIRONMENT = new InjectionToken<
	NativeWebEnvironmentValue | undefined
>("NATIVE_WEB_ENVIRONMENT", {
	providedIn: "root",
	factory: () => undefined,
});

export interface ProvideNativeWebEnvironmentOptions {
	/**
	 * Stable host-owned native web environment used by Angular page-only helpers.
	 */
	environment: NativeWebEnvironmentValue;
}

export function provideNativeWebEnvironment(
	options: ProvideNativeWebEnvironmentOptions,
): Provider {
	return {
		provide: NATIVE_WEB_ENVIRONMENT,
		useValue: options.environment,
	};
}
