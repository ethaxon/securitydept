import {
	createEnvironmentForNativeWeb,
	type NativeWebEnvironment,
} from "@securitydept/client/web";

export function createTokenSetFrontendModePageEnvironment(): NativeWebEnvironment {
	return createEnvironmentForNativeWeb({
		location: window.location,
		history: window.history,
		document,
		window,
	});
}
