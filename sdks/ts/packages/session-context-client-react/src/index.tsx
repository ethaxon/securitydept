// Session Context Client — React adapter
//
// Canonical import path:
//   import { ... } from "@securitydept/session-context-client-react"
//
// Provides React context / hooks for integrating SessionContextClient in a
// React application.  The core client lives in @securitydept/session-context-client;
// this package supplies the React-specific binding layer only.
//
// Stability: provisional (React adapter)

import type { WebClientEnvironment } from "@securitydept/client";
import type {
	SessionContextClientConfig,
	SessionContextControllerState,
	SessionInfo,
} from "@securitydept/session-context-client";
import {
	SessionContextClient,
	SessionContextController,
	SessionContextControllerStatus,
} from "@securitydept/session-context-client";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from "react";

export type {
	SessionContextClientConfig,
	SessionContextControllerState,
	SessionInfo,
};
export { SessionContextClient, SessionContextController };

/** Value exposed by the session context React provider. */
export interface SessionContextValue {
	/** The underlying SessionContextClient instance. */
	client: SessionContextClient;
	/** Current session info, or null if unauthenticated / not yet loaded. */
	session: SessionInfo | null;
	/** Whether the initial session probe is in progress. */
	loading: boolean;
	/** Full framework-neutral controller state. */
	state: SessionContextControllerState;
	/** Trigger a re-fetch of the session info. */
	refresh: () => Promise<SessionInfo | null>;
	/** Persist the intended post-auth redirect. */
	rememberPostAuthRedirect: (postAuthRedirectUri: string) => Promise<void>;
	/** Clear any pending post-auth redirect. */
	clearPostAuthRedirect: () => Promise<void>;
	/** Resolve the current login URL from any pending redirect intent. */
	resolveLoginUrl: () => Promise<string>;
	/** Execute logout through the configured transport and clear local redirect intent. */
	logout: () => Promise<void>;
}

interface SessionControllerContextValue {
	controller: SessionContextController;
	initialRefresh: boolean;
}

const SessionControllerContext =
	createContext<SessionControllerContextValue | null>(null);

export interface SessionContextProviderProps {
	/** Auth-context config only (baseUrl and path policy). */
	config?: SessionContextClientConfig;
	/** Framework composition-root environment for transport and session state. */
	environment?: WebClientEnvironment;
	/** Host-created framework-neutral controller. */
	controller?: SessionContextController;
	/** Explicitly start an initial session probe from the adapter. */
	initialRefresh?: boolean;
	/** React host glue only. */
	children: ReactNode;
}

export function SessionContextProvider({
	config,
	environment,
	controller,
	initialRefresh = false,
	children,
}: SessionContextProviderProps) {
	const resolvedController = useMemo(() => {
		if (controller) {
			return controller;
		}
		if (!config || !environment) {
			throw new Error(
				"SessionContextProvider requires either controller or both config and environment.",
			);
		}
		return new SessionContextController({
			client: new SessionContextClient(config, {
				sessionStore: environment.sessionStore,
			}),
			transport: environment.transport,
		});
	}, [config, controller, environment]);

	useEffect(() => {
		if (initialRefresh) {
			resolvedController.refresh().catch(() => {});
		}
	}, [initialRefresh, resolvedController]);

	const contextValue = useMemo(
		() => ({ controller: resolvedController, initialRefresh }),
		[resolvedController, initialRefresh],
	);

	return (
		<SessionControllerContext.Provider value={contextValue}>
			{children}
		</SessionControllerContext.Provider>
	);
}

/** Access the session context from React. */
export function useSessionContext(): SessionContextValue {
	const context = useContext(SessionControllerContext);
	if (!context) {
		throw new Error(
			"useSessionContext must be used inside <SessionContextProvider>",
		);
	}
	const { controller, initialRefresh } = context;

	const state = useSyncExternalStore(
		useCallback((listener) => controller.subscribe(listener), [controller]),
		useCallback(() => controller.getState(), [controller]),
		useCallback(() => controller.getState(), [controller]),
	);
	const refresh = useCallback(() => controller.refresh(), [controller]);
	const rememberPostAuthRedirect = useCallback(
		(postAuthRedirectUri: string) =>
			controller.rememberPostAuthRedirect(postAuthRedirectUri),
		[controller],
	);
	const clearPostAuthRedirect = useCallback(
		() => controller.clearPostAuthRedirect(),
		[controller],
	);
	const resolveLoginUrl = useCallback(
		() => controller.resolveLoginUrl(),
		[controller],
	);
	const logout = useCallback(() => controller.logout(), [controller]);

	return useMemo(
		() => ({
			client: controller.client,
			session: state.session,
			loading:
				state.status === SessionContextControllerStatus.Loading ||
				(initialRefresh &&
					state.status === SessionContextControllerStatus.Idle),
			state,
			refresh,
			rememberPostAuthRedirect,
			clearPostAuthRedirect,
			resolveLoginUrl,
			logout,
		}),
		[
			controller,
			initialRefresh,
			state,
			refresh,
			rememberPostAuthRedirect,
			clearPostAuthRedirect,
			resolveLoginUrl,
			logout,
		],
	);
}

/** Convenience hook to get just the session principal. */
export function useSessionPrincipal() {
	const { session } = useSessionContext();
	return session?.principal ?? null;
}
