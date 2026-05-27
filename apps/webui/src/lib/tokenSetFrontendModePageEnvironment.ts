import { createRootSpan, createTracing } from "@securitydept/client";
import {
	createEnvironmentForNativeWeb,
	type NativeWebEnvironment,
} from "@securitydept/client/web";

export function createTokenSetFrontendModePageEnvironment(): NativeWebEnvironment {
	return createEnvironmentForNativeWeb({
		span: createRootSpan(),
		tracing: createTracing(),
		routerForNativeWebCreateOptions: {
			location: window.location,
			history: window.history,
		},
		pageLifecycleForNativeWebCreateOptions: {
			document,
			window,
		},
		popupForNativeWebCreateOptions: {
			window,
		},
	});
}
