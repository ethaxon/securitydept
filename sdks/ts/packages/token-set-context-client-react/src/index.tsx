// Backend OIDC Mode — React adapter
//
// Canonical import path:
//   import { ... } from "@securitydept/token-set-context-client-react"
//
// Provides React context / hooks for integrating BackendOidcModeClient in a
// React application.  The core client lives in @securitydept/token-set-context-client;
// this package supplies the React-specific binding layer only.
//
// Stability: provisional (React adapter)

import type {
	Clock,
	HttpTransport,
	LoggerTrait,
	RecordStore,
	Scheduler,
	TraceEventSinkTrait,
} from "@securitydept/client";
import type {
	AuthStateSnapshot,
	BackendOidcModeClientConfig,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";

export {
	type ClientFilter,
	ClientInitializationPriority,
	type ClientKeySelector,
	type ClientMeta,
	type ClientQueryOptions,
	type ClientReadinessState,
} from "@securitydept/token-set-context-client/registry";
// Multi-client registry-based productization (iteration 110).
export type {
	OidcCallbackClient,
	OidcModeClient,
	TokenSetBackendOidcClient,
	TokenSetClientEntry,
	TokenSetReactClient,
} from "./contracts";
export {
	TokenSetAuthProvider,
	type TokenSetAuthProviderProps,
	useTokenSetAccessToken,
	useTokenSetAuthRegistry,
	useTokenSetAuthService,
	useTokenSetAuthState,
	useTokenSetBackendOidcClient,
} from "./token-set-auth-provider";
export { TokenSetAuthService } from "./token-set-auth-service";
export {
	type CallbackResumeErrorDetails,
	type CallbackResumeState,
	CallbackResumeStatus,
	readCallbackResumeErrorDetails,
	TokenSetCallbackComponent,
	type TokenSetCallbackComponentProps,
	type UseTokenSetCallbackResumeOptions,
	useTokenSetCallbackResume,
} from "./token-set-callback";
export type { AuthStateSnapshot, BackendOidcModeClientConfig };
export { BackendOidcModeClient };

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface BackendOidcModeContextValue {
	client: BackendOidcModeClient;
	state: AuthStateSnapshot | null;
}

const BackendOidcModeContext =
	createContext<BackendOidcModeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface BackendOidcModeContextProviderProps {
	config: BackendOidcModeClientConfig;
	transport: HttpTransport;
	scheduler: Scheduler;
	clock: Clock;
	logger?: LoggerTrait;
	traceSink?: TraceEventSinkTrait;
	persistentStore?: RecordStore;
	sessionStore?: RecordStore;
	children: ReactNode;
}

/**
 * React context provider that creates and owns a `BackendOidcModeClient`
 * scoped to the subtree.  Disposes the client on unmount, tolerating
 * React 18 StrictMode double-invocation via a mount-count ref guard.
 */
export function BackendOidcModeContextProvider({
	config,
	transport,
	scheduler,
	clock,
	logger,
	traceSink,
	persistentStore,
	sessionStore,
	children,
}: BackendOidcModeContextProviderProps) {
	const client = useMemo(
		() =>
			new BackendOidcModeClient(config, {
				transport,
				scheduler,
				clock,
				logger,
				traceSink,
				persistentStore,
				sessionStore,
			}),
		[
			config,
			transport,
			scheduler,
			clock,
			logger,
			traceSink,
			persistentStore,
			sessionStore,
		],
	);
	const lifecycleMountsRef = useRef(new Map<BackendOidcModeClient, number>());

	// Bridge the signal to React via useSyncExternalStore.
	const state = useSyncExternalStore(
		useCallback(
			(onStoreChange: () => void) => client.state.subscribe(onStoreChange),
			[client],
		),
		() => client.state.get(),
	);

	// Clean up on unmount, tolerating React 18 StrictMode effect replays.
	useEffect(() => {
		const lifecycleMounts = lifecycleMountsRef.current;
		lifecycleMounts.set(client, (lifecycleMounts.get(client) ?? 0) + 1);

		return () => {
			const nextMounts = (lifecycleMounts.get(client) ?? 1) - 1;
			if (nextMounts <= 0) {
				lifecycleMounts.delete(client);
			} else {
				lifecycleMounts.set(client, nextMounts);
			}

			queueMicrotask(() => {
				if (!lifecycleMounts.has(client)) {
					client.dispose();
				}
			});
		};
	}, [client]);

	const value = useMemo(() => ({ client, state }), [client, state]);

	return (
		<BackendOidcModeContext.Provider value={value}>
			{children}
		</BackendOidcModeContext.Provider>
	);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Access the full token set context value (client + current state). */
export function useBackendOidcModeContext(): BackendOidcModeContextValue {
	const ctx = useContext(BackendOidcModeContext);
	if (!ctx) {
		throw new Error(
			"useBackendOidcModeContext must be used inside <BackendOidcModeContextProvider>",
		);
	}
	return ctx;
}

/** Convenience hook: current auth state snapshot. */
export function useAuthState(): AuthStateSnapshot | null {
	return useBackendOidcModeContext().state;
}

/** Convenience hook: current access token string, or null if unauthenticated. */
export function useAccessToken(): string | null {
	const state = useAuthState();
	return state?.tokens.accessToken ?? null;
}
