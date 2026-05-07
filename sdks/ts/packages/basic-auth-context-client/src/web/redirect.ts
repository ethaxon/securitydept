import type { PageLocationCapability } from "@securitydept/client";
import { assertResolveEnvironment } from "@securitydept/client/web";
import type { AuthGuardResult } from "../types";
import { AuthGuardResultKind } from "../types";

const BASIC_AUTH_PAGE_ENVIRONMENT_ERROR_MESSAGE =
	"basic-auth browser redirect helpers require an explicit page environment.\n" +
	"Create one in your composition root with createBrowserPageClientEnvironment(...).";

export interface PerformRedirectOptions {
	environment?: PageLocationCapability;
}

/**
 * Perform a browser redirect for an `AuthGuardResult` that requires redirection.
 */
export function performRedirect(
	result: AuthGuardResult<unknown>,
	options: PerformRedirectOptions = {},
): void {
	if (result.kind === AuthGuardResultKind.Redirect) {
		const environment = assertResolveEnvironment(
			options.environment,
			failMissingPageEnvironment,
		);
		environment.location.href = result.location;
	}
}

function failMissingPageEnvironment(): never {
	throw new Error(BASIC_AUTH_PAGE_ENVIRONMENT_ERROR_MESSAGE);
}
