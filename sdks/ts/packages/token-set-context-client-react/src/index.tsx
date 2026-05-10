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

import { fromSignal } from "@securitydept/client";
import type {
	AuthStateSnapshot,
	BackendOidcModeClientConfig,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	type BackendOidcModeWebClientEnvironment,
	createBackendOidcModeWebClient,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import type { TokenSetResumeReconciliationOptions } from "@securitydept/token-set-context-client/orchestration";
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
// Multi-client registry-based adapter surface.
export type {
	OidcCallbackClient,
	OidcModeClient,
	OidcRedirectLoginClient,
	OidcRedirectLoginOptions,
	TokenSetBackendOidcClient,
	TokenSetClientEntry,
	TokenSetOidcRedirectLoginClient,
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
	useTokenSetCallbackResumeController,
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
	/** Auth-context config only (issuer/baseUrl/endpoints/redirect policy). */
	config: BackendOidcModeClientConfig;
	/** Framework composition-root environment for backend-oidc browser runtime. */
	environment: BackendOidcModeWebClientEnvironment;
	/** Override resume reconciliation installation when parity with old provider is needed. */
	resumeReconciliation?: boolean;
	resumeReconciliationOptions?: TokenSetResumeReconciliationOptions;
	/** React host glue only. */
	children: ReactNode;
}

/**
 * React context provider that creates and owns a `BackendOidcModeClient`
 * scoped to the subtree.  Disposes the client on unmount, tolerating
 * React 18 StrictMode double-invocation via a mount-count ref guard.
 */
export function BackendOidcModeContextProvider({
	config,
	environment,
	resumeReconciliation,
	resumeReconciliationOptions,
	children,
}: BackendOidcModeContextProviderProps) {
	const client = useMemo(
		() =>
			createBackendOidcModeWebClient({
				...config,
				environment,
				resumeReconciliation,
				resumeReconciliationOptions,
			}),
		[config, environment, resumeReconciliation, resumeReconciliationOptions],
	);
	const lifecycleMountsRef = useRef(new Map<BackendOidcModeClient, number>());

	// Bridge the signal to React via useSyncExternalStore.
	const state = useSyncExternalStore(
		useCallback(
			(onStoreChange: () => void) => {
				const subscription = fromSignal({
					signal: client.state,
					callback: () => {
						onStoreChange();
					},
				});
				return () => {
					subscription.unsubscribe();
				};
			},
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
