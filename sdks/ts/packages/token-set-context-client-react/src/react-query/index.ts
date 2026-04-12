// @securitydept/token-set-context-client-react/react-query
//
// Subpath exposing optional React Query integration helpers. This module
// lives under the main React package (per the iteration 110 constraint:
// "no standalone @securitydept/...-react-query package — sub-path +
// devDependencies + optional peerDependencies").
//
// Adopters must install `@tanstack/react-query` themselves — it is declared
// as an optional peer dependency. If the peer is missing, importing this
// subpath resolves fine (we only use its types), but invoking the helpers
// at runtime without a QueryClient will throw.
//
// Stability: provisional (new in iteration 110)

import type {
	QueryClient,
	QueryKey,
	UseQueryOptions,
	UseQueryResult,
} from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	useTokenSetAccessToken,
	useTokenSetAuthRegistry,
	useTokenSetAuthService,
} from "../token-set-auth-provider";
import type { TokenSetAuthService } from "../token-set-auth-service";

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
	authState: (clientKey: string) =>
		[...tokenSetQueryKeys.forClient(clientKey), "authState"] as const,
} as const;

// ---------------------------------------------------------------------------
// Readiness query
// ---------------------------------------------------------------------------

/**
 * React Query hook wrapping `registry.whenReady(key)`. Useful for gating
 * a route or suspense boundary on async client materialization (primary
 * async or lazy-preloaded clients).
 *
 * The query resolves with the materialized `TokenSetAuthService` and stays
 * in `"success"` state as long as the client remains registered.
 */
export function useTokenSetReadinessQuery(
	clientKey: string,
	options?: Omit<
		UseQueryOptions<TokenSetAuthService, Error, TokenSetAuthService, QueryKey>,
		"queryKey" | "queryFn"
	>,
): UseQueryResult<TokenSetAuthService, Error> {
	const registry = useTokenSetAuthRegistry();
	return useQuery<TokenSetAuthService, Error, TokenSetAuthService, QueryKey>({
		queryKey: tokenSetQueryKeys.readiness(clientKey),
		queryFn: async () => registry.whenReady(clientKey),
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
// Authorization header convenience
// ---------------------------------------------------------------------------

/**
 * Build a `useQuery` enabled flag + `Authorization` headers tuple for the
 * given client key. Returns `null` when the client is not ready yet so
 * adopters can short-circuit the query.
 */
export function useTokenSetAuthorizationHeader(clientKey: string): {
	enabled: boolean;
	authorization: string | null;
} {
	// This throws if not ready — callers can use useTokenSetReadinessQuery first.
	useTokenSetAuthService(clientKey);
	const accessToken = useTokenSetAccessToken(clientKey);

	return useMemo(
		() => ({
			enabled: accessToken !== null,
			authorization: accessToken ? `Bearer ${accessToken}` : null,
		}),
		[accessToken],
	);
}
