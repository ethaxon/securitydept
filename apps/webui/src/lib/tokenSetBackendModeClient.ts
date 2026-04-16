// Shared token-set client instance for the React canonical consumer path.
//
// This module creates a singleton BackendOidcModeClient wrapped as a
// TokenSetReactClient
// for use with TokenSetAuthProvider and route-level auth checks. The wrapper
// delegates all methods to the underlying BackendOidcModeClient, adapting only
// the two methods whose signatures differ from the TokenSetReactClient contract
// (restorePersistedState, handleCallback).

import type { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	bootstrapBackendOidcModeClient,
	createBackendOidcModeBrowserClient,
	createBackendOidcModeCallbackFragmentStore,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import type {
	TokenSetBackendOidcClient,
	TokenSetReactClient,
} from "@securitydept/token-set-context-client-react";
import {
	TOKEN_SET_BACKEND_MODE_LOGIN_PATH,
	TOKEN_SET_BACKEND_MODE_METADATA_REDEEM_PATH,
	TOKEN_SET_BACKEND_MODE_REFRESH_PATH,
	TOKEN_SET_BACKEND_MODE_USER_INFO_PATH,
} from "@/lib/tokenSetConfig";
import { createTraceTimelineStore } from "@/lib/traceTimeline";

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

type WrappedTokenSetReactClient = TokenSetReactClient & BackendOidcModeClient;

const tokenSetBackendModeClient = createBackendOidcModeBrowserClient({
	defaultPostAuthRedirectUri: "/",
	traceSink: tokenSetBackendModeTraceTimeline,
	// Override SDK defaults to match the reference app's backend-mode route
	// family.
	loginPath: TOKEN_SET_BACKEND_MODE_LOGIN_PATH,
	refreshPath: TOKEN_SET_BACKEND_MODE_REFRESH_PATH,
	metadataRedeemPath: TOKEN_SET_BACKEND_MODE_METADATA_REDEEM_PATH,
	userInfoPath: TOKEN_SET_BACKEND_MODE_USER_INFO_PATH,
});

let tokenSetBackendModeBootstrapPromise: Promise<AuthSnapshot | null> | null =
	null;

export async function ensureTokenSetBackendModeClientReady(): Promise<AuthSnapshot | null> {
	if (!tokenSetBackendModeBootstrapPromise) {
		tokenSetBackendModeBootstrapPromise = bootstrapBackendOidcModeClient(
			tokenSetBackendModeClient,
		).then(() => tokenSetBackendModeClient.state.get());
	}

	return await tokenSetBackendModeBootstrapPromise;
}

export function getTokenSetBackendModeAuthSnapshot(): AuthSnapshot | null {
	return tokenSetBackendModeClient.state.get();
}

export async function clearTokenSetBackendModeBrowserState(
	client: TokenSetBackendOidcClient,
): Promise<void> {
	await createBackendOidcModeCallbackFragmentStore().clear();
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
 * client remains accessible at runtime through `service.client`. Only the
 * two contract-divergent methods are overridden:
 *
 * - `restorePersistedState()` runs the full browser bootstrap
 *   (fragment capture → handleCallback → persistent restore)
 * - `handleCallback(url)` extracts the URL fragment and delegates
 */
function wrapAsTokenSetReactClient(
	client: BackendOidcModeClient,
): WrappedTokenSetReactClient {
	const overrides: Partial<TokenSetReactClient> = {
		async restorePersistedState(): Promise<AuthSnapshot | null> {
			return await ensureTokenSetBackendModeClientReady();
		},

		async handleCallback(
			callbackUrl: string,
		): Promise<{ snapshot: AuthSnapshot; postAuthRedirectUri?: string }> {
			const url = new URL(callbackUrl);
			const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
			const snapshot = await client.handleCallback(fragment);
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
 * Factory for the TokenSetAuthProvider registry entry.
 *
 * Creates the BackendOidcModeClient (with browser defaults and the shared
 * trace timeline) and wraps it as a TokenSetReactClient via Proxy. The
 * resulting
 * client is accessed exclusively through the service returned by
 * useTokenSetAuthService().
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
