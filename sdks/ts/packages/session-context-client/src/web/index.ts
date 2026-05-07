// Session Context Client — Browser Adapter
//
// Canonical import path:
//   import { loginWithRedirect } from "@securitydept/session-context-client/web"
//
// Provides browser-specific convenience helpers that trigger full-page
// navigation (redirect) for session-based authentication.  The root
// `SessionContextClient` stays host-neutral; this subpath owns the
// browser side-effect layer.
//
// Stability: provisional

import type { PageLocationCapability } from "@securitydept/client";
import { assertResolveEnvironment } from "@securitydept/client/web";
import type { SessionContextClient } from "../client";

const SESSION_PAGE_ENVIRONMENT_ERROR_MESSAGE =
	"session browser redirect helpers require an explicit page environment.\n" +
	"Create one in your composition root with createBrowserPageClientEnvironment(...).";

/**
 * Options for {@link loginWithRedirect}.
 */
export interface LoginWithRedirectOptions {
	environment?: PageLocationCapability;

	/**
	 * Where to redirect the user after successful authentication.
	 *
	 * When omitted, `environment.location.href` is used as the return URI and
	 * persisted via the client's pending-login-redirect store for post-auth
	 * consumption.
	 */
	postAuthRedirectUri?: string;
}

/**
 * One-shot browser redirect to the session login endpoint.
 *
 * 1. Saves the post-auth redirect intent into the client's pending store
 *    (when a session store is configured).
 * 2. Navigates the current window to the login URL.
 *
 * This is the recommended browser entry point for initiating session-based
 * login.  It is intentionally a standalone function (not a method on
 * `SessionContextClient`) to keep browser-specific side-effects out of the
 * host-neutral client contract.
 */
export async function loginWithRedirect(
	client: SessionContextClient,
	options: LoginWithRedirectOptions = {},
): Promise<void> {
	const environment = assertResolveEnvironment(
		options.environment,
		failMissingPageEnvironment,
	);
	const postAuthRedirectUri =
		options.postAuthRedirectUri ?? environment.location.href;

	await client.savePendingLoginRedirect(postAuthRedirectUri);

	environment.location.href = client.loginUrl(postAuthRedirectUri);
}

function failMissingPageEnvironment(): never {
	throw new Error(SESSION_PAGE_ENVIRONMENT_ERROR_MESSAGE);
}
