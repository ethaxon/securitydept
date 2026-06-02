// Shared token-set client instance for the React canonical consumer path.
//
// This module creates a singleton BackendOidcModeClient wrapped as a
// BaseOidcModeClient for use with the token-set auth runtime and route-level
// auth checks.

import {
	createRootSpan,
	createTraceTimelineStore,
	createTracing,
	FetchTransportRedirectKind,
	takeCompatFragmentFromRouter,
} from "@securitydept/client";
import { createEnvironmentForNativeWeb } from "@securitydept/client/web";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { type AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import { type TokenSetBackendOidcClient } from "@/lib/tokenSetClientAssertions";
import {
	TOKEN_SET_BACKEND_MODE_LOGIN_PATH,
	TOKEN_SET_BACKEND_MODE_METADATA_REDEEM_PATH,
	TOKEN_SET_BACKEND_MODE_REFRESH_PATH,
	TOKEN_SET_BACKEND_MODE_USER_INFO_PATH,
} from "@/lib/tokenSetConfig";

// ---------------------------------------------------------------------------
// Shared trace timeline
// ---------------------------------------------------------------------------

/**
 * Global trace timeline shared between the client and the reference page.
 * The backend-mode playground subscribes to events from this store for its
 * trace UI.
 */
export const tokenSetBackendTraceTimeline = createTraceTimelineStore();

export const tokenSetBackendModeTraceTimeline = tokenSetBackendTraceTimeline;
export const tokenSetBackendModeTracing = createTracing({
	subscribers: [tokenSetBackendTraceTimeline],
});

const tokenSetBackendModeRootSpan = createRootSpan();
export const tokenSetBackendModeHostSpan = tokenSetBackendModeRootSpan.fork({
	attributes: {
		target: "apps.webui.token-set-backend",
		role: "host",
	},
});

const tokenSetBackendModeEnvironment = createEnvironmentForNativeWeb({
	span: tokenSetBackendModeRootSpan,
	tracing: tokenSetBackendModeTracing,
	transportForStdFetchCreateOptions: {
		redirect: FetchTransportRedirectKind.Manual,
	},
});

const tokenSetBackendModeClient = new BackendOidcModeClient(
	{
		baseUrl: "",
		defaultPostAuthRedirectUri: "/",
		// Override SDK defaults to match the reference app's backend-mode route
		// family.
		loginPath: TOKEN_SET_BACKEND_MODE_LOGIN_PATH,
		refreshPath: TOKEN_SET_BACKEND_MODE_REFRESH_PATH,
		metadataRedeemPath: TOKEN_SET_BACKEND_MODE_METADATA_REDEEM_PATH,
		userInfoPath: TOKEN_SET_BACKEND_MODE_USER_INFO_PATH,
	},
	tokenSetBackendModeEnvironment,
);

let tokenSetBackendModeBootstrapPromise: Promise<AuthSnapshot | null> | null =
	null;

function createBackendModePageEnvironment() {
	const location = globalThis.location;
	const history = globalThis.history;
	return {
		time: tokenSetBackendModeEnvironment.time,
		currentUrl() {
			return new URL(location.href);
		},
		canNavigate() {
			return true;
		},
		async navigate(request: {
			url: string | URL;
			intent?: string;
			mode: "push" | "replace" | "external";
		}) {
			const target =
				typeof request.url === "string" ? request.url : request.url.toString();
			if (request.mode === "replace") {
				history.replaceState(undefined, "", target);
				return;
			}
			location.assign(target);
		},
	};
}

export async function ensureTokenSetBackendModeClientReady(): Promise<AuthSnapshot | null> {
	if (!tokenSetBackendModeBootstrapPromise) {
		tokenSetBackendModeBootstrapPromise = (async () => {
			const fragment = await takeCompatFragmentFromRouter(
				createBackendModePageEnvironment(),
			);
			if (fragment) {
				return await tokenSetBackendModeClient.handleCallback(
					fragment.parameters,
				);
			} else {
				return await tokenSetBackendModeClient.start();
			}
		})();
	}

	return await tokenSetBackendModeBootstrapPromise;
}

export function getTokenSetBackendModeAuthSnapshot(): AuthSnapshot | null {
	const slot = tokenSetBackendModeClient.authSnapshot.get();
	return slot.kind === "value" ? slot.value : null;
}

export async function clearTokenSetBackendModeBrowserState(
	client: TokenSetBackendOidcClient,
): Promise<void> {
	await client.logout();
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Factory for the token-set auth runtime registry entry.
 *
 * Returns the singleton BackendOidcModeClient with browser defaults and the
 * shared trace timeline.
 */
export function tokenSetBackendModeClientFactory(): BackendOidcModeClient {
	return tokenSetBackendModeClient;
}

export const ensureTokenSetBackendClientReady =
	ensureTokenSetBackendModeClientReady;
export const getTokenSetBackendAuthSnapshot =
	getTokenSetBackendModeAuthSnapshot;
export const clearTokenSetBackendBrowserState =
	clearTokenSetBackendModeBrowserState;
export const tokenSetBackendClientFactory = tokenSetBackendModeClientFactory;
