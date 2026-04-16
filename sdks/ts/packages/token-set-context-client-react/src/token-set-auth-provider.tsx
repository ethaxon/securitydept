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
	useState,
	useSyncExternalStore,
} from "react";
import type {
	OidcCallbackClient,
	OidcModeClient,
	TokenSetBackendOidcClient,
	TokenSetClientEntry,
	TokenSetReactClient,
} from "./contracts";
import { TokenSetAuthService } from "./token-set-auth-service";

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

// ---------------------------------------------------------------------------
// Callback resume hook + outlet
// ---------------------------------------------------------------------------

export interface UseTokenSetCallbackResumeOptions {
	/**
	 * Source of the current URL. Defaults to `window.location.href` when
	 * available. Tests or SSR can inject their own.
	 */
	getCurrentUrl?: () => string | undefined;
}

/**
 * Tri-state lifecycle of an OIDC callback resume driven by the registry.
 *
 * - `idle`     — the current URL is not an OIDC callback for any registered
 *                client. Outlets should render their `fallback` slot.
 * - `pending`  — a client key was matched; the registry is either
 *                materializing the client (async / lazy factory in flight)
 *                or `handleCallback()` is running. Outlets should render
 *                `pending`.
 * - `resolved` — `handleCallback()` succeeded; `result` is available.
 * - `error`    — either `whenReady()` or `handleCallback()` rejected. The
 *                registry did not side-effect anything that requires
 *                rollback; adopters choose whether to retry or surface the
 *                error.
 */
export const CallbackResumeStatus = {
	Idle: "idle",
	Pending: "pending",
	Resolved: "resolved",
	Error: "error",
} as const;
export type CallbackResumeStatus =
	(typeof CallbackResumeStatus)[keyof typeof CallbackResumeStatus];

export interface CallbackResumeState {
	clientKey: string | null;
	status: CallbackResumeStatus;
	result: { snapshot: unknown; postAuthRedirectUri?: string } | null;
	error: unknown;
}

/**
 * Detect whether the current URL is an OIDC callback for some registered
 * client and drive the canonical resume path:
 *
 * 1. Match the URL to a client key via `registry.clientKeyForCallback()`.
 * 2. Await `registry.whenReady(clientKey)` — this triggers materialization
 *    for lazy clients and waits out async factories for primary clients
 *    that have not yet settled. This is the line that closes the async
 *    readiness gap reported by iteration 110 review-1: the callback path
 *    no longer silently no-ops when the service has not been materialized
 *    yet.
 * 3. Call `service.client.handleCallback(currentUrl)`.
 *
 * The returned state is Suspense-friendly (`status` tracks the lifecycle)
 * and can be consumed directly by `TokenSetCallbackComponent` or by adopter
 * components rendering their own pending UX.
 */
export function useTokenSetCallbackResume(
	options: UseTokenSetCallbackResumeOptions = {},
): CallbackResumeState {
	const registry = useTokenSetAuthRegistry();
	const currentUrl =
		options.getCurrentUrl?.() ??
		(typeof window !== "undefined" ? window.location.href : undefined);

	const clientKey = useMemo(() => {
		if (!currentUrl) return null;
		return registry.clientKeyForCallback(currentUrl) ?? null;
	}, [registry, currentUrl]);

	const [state, setState] = useState<CallbackResumeState>(() => ({
		clientKey,
		status:
			clientKey && currentUrl
				? CallbackResumeStatus.Pending
				: CallbackResumeStatus.Idle,
		result: null,
		error: null,
	}));

	useEffect(() => {
		if (!clientKey || !currentUrl) {
			setState({
				clientKey: null,
				status: CallbackResumeStatus.Idle,
				result: null,
				error: null,
			});
			return;
		}
		let cancelled = false;
		setState({
			clientKey,
			status: CallbackResumeStatus.Pending,
			result: null,
			error: null,
		});
		void (async () => {
			try {
				const service = await registry.whenReady(clientKey);
				if (cancelled) return;
				const result = await service.client.handleCallback(currentUrl);
				if (cancelled) return;
				setState({
					clientKey,
					status: CallbackResumeStatus.Resolved,
					result,
					error: null,
				});
			} catch (error) {
				if (cancelled) return;
				setState({
					clientKey,
					status: CallbackResumeStatus.Error,
					result: null,
					error,
				});
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [registry, clientKey, currentUrl]);

	return state;
}

// Ensure types are referenced so imports are not elided.
export type {
	OidcCallbackClient,
	OidcModeClient,
	TokenSetBackendOidcClient,
	TokenSetReactClient,
};

export interface TokenSetCallbackComponentProps {
	/**
	 * Optional render prop for the pending state (registry warming the
	 * client or `handleCallback()` in flight).
	 */
	pending?: ReactNode;
	/**
	 * Optional render prop for the "not a callback URL" state.
	 */
	fallback?: ReactNode;
	/**
	 * Called after successful callback resolution. Typical adoption uses
	 * this to navigate to `postAuthRedirectUri` via the host router.
	 */
	onResolved?: (result: {
		clientKey: string;
		postAuthRedirectUri: string | undefined;
	}) => void;
	/**
	 * Called when the callback could not be resolved (invalid state, PKCE
	 * mismatch, registry materialization error, etc.). Default behaviour
	 * renders `fallback`.
	 */
	onError?: (error: unknown) => void;
}

/**
 * Drop-in component for an OIDC callback route. Looks at the current URL,
 * finds the matching client via the registry (including async/lazy
 * clients — they are awaited via `registry.whenReady()`), and drives
 * `client.handleCallback(url)`. Renders `pending` while the callback is
 * in flight and `fallback` when the URL is not a recognised callback.
 */
export function TokenSetCallbackComponent({
	pending,
	fallback,
	onResolved,
	onError,
}: TokenSetCallbackComponentProps): ReactNode {
	const state = useTokenSetCallbackResume();
	const resolvedRef = useRef(false);
	const erroredRef = useRef(false);

	useEffect(() => {
		if (
			state.status === CallbackResumeStatus.Resolved &&
			state.clientKey &&
			!resolvedRef.current
		) {
			resolvedRef.current = true;
			onResolved?.({
				clientKey: state.clientKey,
				postAuthRedirectUri: state.result?.postAuthRedirectUri,
			});
		}
		if (state.status === CallbackResumeStatus.Error && !erroredRef.current) {
			erroredRef.current = true;
			onError?.(state.error);
		}
	}, [
		state.status,
		state.clientKey,
		state.result,
		state.error,
		onResolved,
		onError,
	]);

	switch (state.status) {
		case CallbackResumeStatus.Idle:
			return fallback ?? null;
		case CallbackResumeStatus.Pending:
			return pending ?? null;
		case CallbackResumeStatus.Resolved:
			return null;
		case CallbackResumeStatus.Error:
			return fallback ?? null;
		default: {
			const _exhaustive: never = state.status;
			return _exhaustive;
		}
	}
}
