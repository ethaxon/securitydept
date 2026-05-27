import { type RouterTrait } from "@securitydept/client";
import { type AuthGuardResult, AuthGuardResultKind } from "../types";

const BASIC_AUTH_PAGE_ENVIRONMENT_ERROR_MESSAGE =
	"basic-auth browser redirect helpers require an explicit page environment.\n" +
	"Create one in your composition root with createEnvironmentForNativeWeb(...).";

export interface PerformRedirectOptions {
	environment?: RouterTrait;
}

/**
 * Perform a browser redirect for an `AuthGuardResult` that requires redirection.
 */
export async function performRedirect(
	result: AuthGuardResult<unknown>,
	options: PerformRedirectOptions = {},
): Promise<void> {
	if (result.kind === AuthGuardResultKind.Redirect) {
		const environment = options.environment ?? failMissingPageEnvironment();
		await environment.navigate({
			url: result.location,
			intent: "auth_redirect",
			mode: "external",
		});
	}
}

function failMissingPageEnvironment(): never {
	throw new Error(BASIC_AUTH_PAGE_ENVIRONMENT_ERROR_MESSAGE);
}
