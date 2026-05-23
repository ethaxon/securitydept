import {
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
} from "@securitydept/client/injection";
import type { NativeWebEnvironment } from "@securitydept/client/web";

export const CLIENT_ENVIRONMENT =
	new SecuritydeptInjectionToken<NativeWebEnvironment>("CLIENT_ENVIRONMENT");

export function provideClientEnvironment(
	environment: NativeWebEnvironment,
): SecuritydeptProvider<NativeWebEnvironment> {
	return {
		provide: CLIENT_ENVIRONMENT,
		useValue: environment,
	};
}
