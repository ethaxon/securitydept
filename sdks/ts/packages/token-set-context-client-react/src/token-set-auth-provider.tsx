// Multi-client React productization of the shared TokenSetAuthRegistry
//
// Canonical import:
//   import {
//     TokenSetAuthProvider,
//     useTokenSetAuthRegistry,
//     useTokenSetAuthService,
//     useTokenSetAuthState,
//     useTokenSetAccessToken,
//     TokenSetCallbackOutlet,
//   } from "@securitydept/token-set-context-client-react";
//
// Iteration 110: mirrors the Angular `provideTokenSetAuth` surface using React
// 19 primitives. Adopters can register N token-set clients in a single tree;
// hooks key into the registry to retrieve the right `TokenSetAuthService`.
//
// Stability: provisional (new in iteration 110)

import {
	type TokenSetAuthRegistry as CoreTokenSetAuthRegistry,
	createTokenSetAuthRegistry,
} from "@securitydept/token-set-context-client/registry";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useDebugValue,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import type {
	TokenSetBackendOidcClient,
	TokenSetClientEntry,
	TokenSetReactClient,
} from "./contracts";
import { TokenSetAuthService } from "./token-set-auth-service";
import { disposeCallbackResumeCache } from "./token-set-callback";

// ---------------------------------------------------------------------------
// Registry context
// ---------------------------------------------------------------------------

export type ReactRegistry = CoreTokenSetAuthRegistry<
	TokenSetReactClient,
	TokenSetAuthService
>;

const TokenSetAuthRegistryContext = createContext<ReactRegistry | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface TokenSetAuthProviderProps {
	/** Client entries registered eagerly (primary) or lazily on mount. */
	clients: readonly TokenSetClientEntry[];
	/**
	 * When true (default), the provider schedules `registry.idleWarmup()` on
	 * first mount so lazy clients get preloaded during idle time. Disable
	 * for tests that want deterministic materialization control.
	 */
	idleWarmup?: boolean;
	children?: ReactNode;
}

/**
 * React provider that owns a multi-client `TokenSetAuthRegistry` scoped to
 * its subtree. The registry is built once per provider lifecycle and
 * disposed on unmount, tolerating React 19 StrictMode double-invocation
 * via a mount-count ref guard (same pattern as
 * `BackendOidcModeContextProvider`).
 */
export function TokenSetAuthProvider({
	clients,
	idleWarmup = true,
	children,
}: TokenSetAuthProviderProps) {
	// A registry instance is stable for the lifetime of a provider mount.
	// React 19 StrictMode invokes the render twice; we rely on the
	// mount-count ref in the cleanup effect to delay `dispose()` until the
	// *final* unmount has actually settled.
	const registry = useMemo(
		() =>
			createTokenSetAuthRegistry<TokenSetReactClient, TokenSetAuthService>({
				materialize: (client, entry) =>
					new TokenSetAuthService(client, entry.autoRestore ?? true),
				dispose: (service) => service.dispose(),
				accessTokenOf: (service) => service.accessToken(),
			}),
		[],
	);
	const registeredRef = useRef(false);
	const mountCountRef = useRef(0);

	if (!registeredRef.current) {
		registeredRef.current = true;
		for (const entry of clients) {
			try {
				const result = registry.register(entry);
				if (result instanceof Promise) {
					// Attach a noop catch so unhandled rejections don't leak;
					// callers opt-in to awaiting via `whenReady(key)`.
					result.catch(() => {});
				}
			} catch (error) {
				// Register errors are developer bugs (e.g. duplicate key) —
				// surface them loudly on the next render cycle.
				throw error instanceof Error ? error : new Error(String(error));
			}
		}
	}

	useEffect(() => {
		mountCountRef.current += 1;
		const cancelWarmup = idleWarmup ? registry.idleWarmup() : undefined;

		return () => {
			mountCountRef.current -= 1;
			cancelWarmup?.();
			if (mountCountRef.current > 0) {
				return;
			}
			queueMicrotask(() => {
				if (mountCountRef.current <= 0) {
					disposeCallbackResumeCache(registry);
					registry.dispose();
				}
			});
		};
	}, [registry, idleWarmup]);

	return (
		<TokenSetAuthRegistryContext.Provider value={registry}>
			{children}
		</TokenSetAuthRegistryContext.Provider>
	);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Access the multi-client `TokenSetAuthRegistry` in scope. */
export function useTokenSetAuthRegistry(): ReactRegistry {
	const registry = useContext(TokenSetAuthRegistryContext);
	if (!registry) {
		throw new Error(
			"useTokenSetAuthRegistry must be used inside <TokenSetAuthProvider>",
		);
	}
	return registry;
}

/**
 * Retrieve the materialized {@link TokenSetAuthService} for a client key.
 *
 * Throws if the registry does not yet have the client ready. For async
 * / lazy clients, call `useTokenSetAuthRegistry().whenReady(key)` inside
 * a suspense boundary or await before rendering dependent components.
 */
export function useTokenSetAuthService(key: string): TokenSetAuthService {
	const registry = useTokenSetAuthRegistry();
	const service = registry.require(key);
	useDebugValue(`TokenSetAuthService(${key})`);
	return service;
}

/**
 * SDK-owned keyed lower-level accessor for backend-oidc token-set clients.
 *
 * Use this when a keyed React consumer needs backend-oidc-specific behavior
 * such as `authorizeUrl()`, `authorizationHeader()`, or `refresh()`.
 */
export function useTokenSetBackendOidcClient(
	key: string,
): TokenSetBackendOidcClient {
	const service = useTokenSetAuthService(key);
	useDebugValue(`TokenSetBackendOidcClient(${key})`);
	return service.client;
}

/**
 * Subscribe to the auth snapshot for a given client key. Re-renders
 * whenever the underlying signal changes.
 */
export function useTokenSetAuthState(
	key: string,
): ReturnType<TokenSetAuthService["getState"]> {
	const service = useTokenSetAuthService(key);
	const subscribe = useCallback(
		(listener: () => void) => service.subscribe(listener),
		[service],
	);
	const getSnapshot = useCallback(() => service.getState(), [service]);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Convenience: current access token for a client key (or null). */
export function useTokenSetAccessToken(key: string): string | null {
	const snapshot = useTokenSetAuthState(key);
	return snapshot?.tokens.accessToken ?? null;
}
