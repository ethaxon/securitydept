import {
	type CreateEnvironmentForNativeWebOptions,
	createEnvironmentForNativeWeb,
	type NativeWebEnvironment,
} from "../web/environment";

export interface CreateEnvironmentForNativeWebTestOptions
	extends CreateEnvironmentForNativeWebOptions {}

export function createEnvironmentForNativeWebTest(
	options: CreateEnvironmentForNativeWebTestOptions,
): NativeWebEnvironment {
	return createEnvironmentForNativeWeb({
		...options,
	});
}
