// Shared token-set client instance for the React canonical consumer path.
//
// This module creates a singleton BackendOidcModeClient wrapped as a ReactClient
// for use with TokenSetAuthProvider and route-level auth checks. The wrapper
// delegates all methods to the underlying BackendOidcModeClient, adapting only
// the two methods whose signatures differ from the ReactClient contract
// (restorePersistedState, handleCallback).

import type { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	bootstrapBackendOidcModeClient,
	createBackendOidcModeBrowserClient,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import type { ReactClient } from "@securitydept/token-set-context-client-react";
import { createTraceTimelineStore } from "@/lib/traceTimeline";

// ---------------------------------------------------------------------------
// Shared trace timeline
// ---------------------------------------------------------------------------

/**
 * Global trace timeline shared between the client and the reference page.
 * The TokenSetPage subscribes to events from this store for its trace UI.
 */
export const tokenSetTraceTimeline = createTraceTimelineStore();

// ---------------------------------------------------------------------------
// Extended ReactClient type
// ---------------------------------------------------------------------------

/**
 * ReactClient that also carries the BackendOidcModeClient surface.
 *
 * The registry and hooks type `service.client` as `OidcModeClient &
 * OidcCallbackClient`, but at runtime the wrapper delegates every method
 * to the underlying BackendOidcModeClient. Consumers that need the
 * lower-level surface (e.g. authorizationHeader, refresh, authorizeUrl)
 * can narrow via this type.
 */
export type BackendOidcModeReactClient = ReactClient & BackendOidcModeClient;

const tokenSetClient = createBackendOidcModeBrowserClient({
	defaultPostAuthRedirectUri: "/",
	traceSink: tokenSetTraceTimeline,
	// Override SDK defaults (/auth/oidc/*) to match securitydept-server's
	// actual token-set route family (/auth/token-set/*).
	loginPath: "/auth/token-set/login",
	refreshPath: "/auth/token-set/refresh",
	metadataRedeemPath: "/auth/token-set/metadata/redeem",
	userInfoPath: "/auth/token-set/user-info",
});

let tokenSetBootstrapPromise: Promise<AuthSnapshot | null> | null = null;

export async function ensureTokenSetClientReady(): Promise<AuthSnapshot | null> {
	if (!tokenSetBootstrapPromise) {
		tokenSetBootstrapPromise = bootstrapBackendOidcModeClient(
			tokenSetClient,
		).then(() => tokenSetClient.state.get());
	}

	return await tokenSetBootstrapPromise;
}

export function getTokenSetAuthSnapshot(): AuthSnapshot | null {
	return tokenSetClient.state.get();
}

// ---------------------------------------------------------------------------
// ReactClient adapter
// ---------------------------------------------------------------------------

/**
 * Adapt a BackendOidcModeClient to satisfy the ReactClient contract while
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
function wrapAsReactClient(
	client: BackendOidcModeClient,
): BackendOidcModeReactClient {
	const overrides: Partial<ReactClient> = {
		async restorePersistedState(): Promise<AuthSnapshot | null> {
			return await ensureTokenSetClientReady();
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
	}) as BackendOidcModeReactClient;
}

const reactTokenSetClient = wrapAsReactClient(tokenSetClient);

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Factory for the TokenSetAuthProvider registry entry.
 *
 * Creates the BackendOidcModeClient (with browser defaults and the shared
 * trace timeline) and wraps it as a ReactClient via Proxy. The resulting
 * client is accessed exclusively through the service returned by
 * useTokenSetAuthService().
 */
export function tokenSetClientFactory(): ReactClient {
	return reactTokenSetClient;
}

export function getTokenSetClient(): BackendOidcModeReactClient {
	return reactTokenSetClient;
}
