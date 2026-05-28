// Shared token-set client instance for the React canonical consumer path.
//
// This module creates a singleton BackendOidcModeClient wrapped as a
// TokenSetReactClient
// for use with the token-set auth runtime and route-level auth checks. The wrapper
// delegates all methods to the underlying BackendOidcModeClient, adapting only
// the two methods whose signatures differ from the TokenSetReactClient contract
// (restorePersistedState, handleCallback).

import {
	createRootSpan,
	createTraceTimelineStore,
	createTracing,
	FetchTransportRedirectKind,
	parseCompatFragment,
	takeCompatFragmentFromRouter,
} from "@securitydept/client";
import { createEnvironmentForNativeWeb } from "@securitydept/client/web";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { type AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import {
	type TokenSetBackendOidcClient,
	type TokenSetReactClient,
} from "@securitydept/token-set-context-client-react";
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

type WrappedTokenSetReactClient = TokenSetReactClient & BackendOidcModeClient;

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
	await client.clearState();
}

// ---------------------------------------------------------------------------
// TokenSetReactClient adapter
// ---------------------------------------------------------------------------

/**
 * Adapt a BackendOidcModeClient to satisfy the TokenSetReactClient contract while
 * preserving full access to the BackendOidcModeClient surface.
 *
 * The wrapper is built via Proxy so every property/method of the underlying
 * client remains accessible at runtime through the registered client object.
 * Only the two contract-divergent methods are overridden:
 *
 * - `restorePersistedState()` remains a manual persistence re-sync command
 * - `handleCallback(url)` extracts the compat fragment and delegates
 */
function wrapAsTokenSetReactClient(
	client: BackendOidcModeClient,
): WrappedTokenSetReactClient {
	const overrides = {
		async restorePersistedState(): Promise<AuthSnapshot | null> {
			return await client.restorePersistedState();
		},

		async handleCallback(
			callbackUrl: string,
		): Promise<{ snapshot: AuthSnapshot; postAuthRedirectUri?: string }> {
			const fragment = parseCompatFragment(new URL(callbackUrl));
			if (!fragment) {
				throw new Error(
					"Token-set backend callback URL has no compat fragment.",
				);
			}
			const snapshot = await client.handleCallback(fragment.parameters);
			return { snapshot };
		},
	};

	return new Proxy(client, {
		get(target, prop, receiver) {
			// Override methods take precedence.
			if (prop in overrides) {
				return (overrides as Record<string | symbol, unknown>)[prop];
			}
			const value = Reflect.get(target, prop, receiver);
			// Bind methods so `this` is the original client, not the proxy.
			if (typeof value === "function") {
				return value.bind(target);
			}
			return value;
		},
	}) as WrappedTokenSetReactClient;
}

const reactTokenSetBackendModeClient = wrapAsTokenSetReactClient(
	tokenSetBackendModeClient,
);

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Factory for the token-set auth runtime registry entry.
 *
 * Creates the BackendOidcModeClient (with browser defaults and the shared
 * trace timeline) and wraps it as a TokenSetReactClient via Proxy. The
 * resulting
 * client is accessed exclusively through the service returned by
 * injector.get(TOKEN_SET_AUTH_REGISTRY).require(key).
 */
export function tokenSetBackendModeClientFactory(): TokenSetReactClient {
	return reactTokenSetBackendModeClient;
}

export const ensureTokenSetBackendClientReady =
	ensureTokenSetBackendModeClientReady;
export const getTokenSetBackendAuthSnapshot =
	getTokenSetBackendModeAuthSnapshot;
export const clearTokenSetBackendBrowserState =
	clearTokenSetBackendModeBrowserState;
export const tokenSetBackendClientFactory = tokenSetBackendModeClientFactory;
