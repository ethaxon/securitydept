// Basic Auth Context Client — Browser login redirect convenience
//
// Provides a one-shot browser redirect to a zone's login page, matching the
// convenience pattern established by session-context-client/web.
//
// Unlike session-context where there is a single login URL, basic-auth is
// zone-based: the adopter must identify which zone to target. This helper
// resolves the zone from a path and performs the redirect.
//
// Stability: provisional

import type { PageLocationCapability } from "@securitydept/client";
import { assertResolveEnvironment } from "@securitydept/client/web";
import type { BasicAuthContextClient } from "../client";

const BASIC_AUTH_PAGE_ENVIRONMENT_ERROR_MESSAGE =
	"basic-auth browser redirect helpers require an explicit page environment.\n" +
	"Create one in your composition root with createBrowserPageClientEnvironment(...).";

/**
 * Options for {@link loginWithRedirect}.
 */
export interface LoginWithRedirectOptions {
	environment?: PageLocationCapability;

	/**
	 * The current request path to resolve the target zone.
	 *
	 * When omitted, `environment.location.pathname` is used.
	 */
	currentPath?: string;

	/**
	 * Where to redirect the user after successful authentication.
	 *
	 * When omitted, `environment.location.href` is used as the return URI.
	 */
	postAuthRedirectUri?: string;
}

/**
 * One-shot browser redirect to the zone login endpoint for the given path.
 *
 * 1. Resolves the zone for the current (or specified) path.
 * 2. Navigates the current window to the zone's login URL with a
 *    post-auth redirect parameter.
 *
 * Returns `false` if no zone matches the path (no redirect performed).
 * Returns `true` if the redirect was initiated.
 *
 * This is the recommended browser entry point for initiating basic-auth
 * login. It is intentionally a standalone function (not a method on
 * `BasicAuthContextClient`) to keep browser-specific side-effects out
 * of the host-neutral client contract.
 */
export function loginWithRedirect(
	client: BasicAuthContextClient,
	options: LoginWithRedirectOptions = {},
): boolean {
	const environment = assertResolveEnvironment(
		options.environment,
		failMissingPageEnvironment,
	);
	const currentPath =
		options.currentPath ??
		environment.location.pathname ??
		new URL(environment.location.href).pathname;
	const zone = client.zoneForPath(currentPath);
	if (!zone) {
		return false;
	}

	const postAuthRedirectUri =
		options.postAuthRedirectUri ?? environment.location.href;
	environment.location.href = client.loginUrl(zone, postAuthRedirectUri);
	return true;
}

function failMissingPageEnvironment(): never {
	throw new Error(BASIC_AUTH_PAGE_ENVIRONMENT_ERROR_MESSAGE);
}
