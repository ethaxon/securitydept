// @securitydept/token-set-context-client-react/react-query
//
// Subpath exposing optional React Query integration helpers. This module
// lives under the main React package as a subpath rather than a standalone
// @securitydept/...-react-query package.
//
// Adopters must install `@tanstack/react-query` themselves — it is declared
// as an optional peer dependency. If the peer is missing, importing this
// subpath resolves fine (we only use its types), but invoking the helpers
// at runtime without a QueryClient will throw.
//
// Stability: provisional

import { type SecuritydeptInjectorTrait } from "@securitydept/client";
import {
	type QueryClient,
	type QueryKey,
	type UseQueryOptions,
	type UseQueryResult,
	useQuery,
} from "@tanstack/react-query";
import { type TokenSetReactClient } from "../contracts";
import {
	type ReactRegistry,
	TOKEN_SET_AUTH_REGISTRY,
} from "../token-set-auth-registry";

export interface TokenSetReadinessQueryHookOptions
	extends Omit<
		UseQueryOptions<TokenSetReactClient, Error, TokenSetReactClient, QueryKey>,
		"queryKey" | "queryFn"
	> {
	injector?: SecuritydeptInjectorTrait;
	registry?: ReactRegistry;
}

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

/**
 * Namespaced query keys for token-set-aware React Query caches.
 *
 * Adopters should use these as prefixes when caching data that should be
 * invalidated on auth state changes. For example:
 *
 * ```ts
 * useQuery({
 *   queryKey: [...tokenSetQueryKeys.forClient("main"), "profile"],
 *   queryFn: () => fetchProfile(accessToken),
 * });
 * ```
 */
export const tokenSetQueryKeys = {
	all: ["tokenSetContext"] as const,
	forClient: (clientKey: string) =>
		[...tokenSetQueryKeys.all, clientKey] as const,
	readiness: (clientKey: string) =>
		[...tokenSetQueryKeys.forClient(clientKey), "readiness"] as const,
} as const;

// ---------------------------------------------------------------------------
// Readiness query
// ---------------------------------------------------------------------------

/**
 * React Query hook wrapping `registry.initialize(key)`. Useful for gating
 * a route or suspense boundary on async client materialization (primary
 * async or lazy-preloaded clients).
 *
 * The query resolves with the materialized token-set client and stays
 * in `"success"` state as long as the client remains registered.
 */
export function useTokenSetReadinessQuery(
	clientKey: string,
	options?: TokenSetReadinessQueryHookOptions,
): UseQueryResult<TokenSetReactClient, Error> {
	const registry = resolveTokenSetRegistry({
		clientKey,
		injector: options?.injector,
		registry: options?.registry,
	});
	return useQuery<TokenSetReactClient, Error, TokenSetReactClient, QueryKey>({
		queryKey: tokenSetQueryKeys.readiness(clientKey),
		queryFn: async () => registry.initialize(clientKey),
		staleTime: Number.POSITIVE_INFINITY,
		...options,
	});
}

// ---------------------------------------------------------------------------
// Invalidation helper
// ---------------------------------------------------------------------------

/**
 * Imperative helper that invalidates every cached query registered under
 * the token-set namespace for a given client key. Typical usage: wire
 * this into a `signOut()` action so stale user data is re-fetched.
 */
export function invalidateTokenSetQueriesForClient(
	queryClient: QueryClient,
	clientKey: string,
): Promise<void> {
	return queryClient.invalidateQueries({
		queryKey: tokenSetQueryKeys.forClient(clientKey),
	});
}

// ---------------------------------------------------------------------------
// Registry resolution
// ---------------------------------------------------------------------------

function resolveTokenSetRegistry(options: {
	clientKey: string;
	injector?: SecuritydeptInjectorTrait;
	registry?: ReactRegistry;
}): ReactRegistry {
	if (options.registry) {
		return options.registry;
	}

	if (options.injector) {
		return options.injector.get(TOKEN_SET_AUTH_REGISTRY);
	}

	throw new Error(
		`[token-set react-query] ${options.clientKey} requires an explicit registry or injector.`,
	);
}
