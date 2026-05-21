import {
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
} from "@securitydept/client/injection";
import type {
	ClientEnvironment,
	PageClientEnvironment,
	WebClientEnvironment,
} from "@securitydept/client/web";
import { ClientEnvironmentService } from "@securitydept/client/web";

export type SecuritydeptClientEnvironmentService<
	TClientEnvironment extends ClientEnvironment = ClientEnvironment,
	TWebEnvironment extends WebClientEnvironment = WebClientEnvironment,
	TPageEnvironment extends PageClientEnvironment = PageClientEnvironment,
> = ClientEnvironmentService<
	TClientEnvironment,
	TWebEnvironment,
	TPageEnvironment
>;

export const CLIENT_ENVIRONMENT_SERVICE =
	new SecuritydeptInjectionToken<SecuritydeptClientEnvironmentService>(
		"CLIENT_ENVIRONMENT_SERVICE",
	);

export function provideClientEnvironmentService<
	TClientEnvironment extends ClientEnvironment = ClientEnvironment,
	TWebEnvironment extends WebClientEnvironment = WebClientEnvironment,
	TPageEnvironment extends PageClientEnvironment = PageClientEnvironment,
>(
	service?: SecuritydeptClientEnvironmentService<
		TClientEnvironment,
		TWebEnvironment,
		TPageEnvironment
	>,
): SecuritydeptProvider<
	SecuritydeptClientEnvironmentService<
		TClientEnvironment,
		TWebEnvironment,
		TPageEnvironment
	>
> {
	return {
		provide: CLIENT_ENVIRONMENT_SERVICE,
		useValue: service ?? new ClientEnvironmentService(),
	};
}
