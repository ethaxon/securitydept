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

import type { HttpTransport, RecordStore } from "@securitydept/client";
import type {
	SessionContextClientConfig,
	SessionInfo,
} from "@securitydept/session-context-client";
import { SessionContextClient } from "@securitydept/session-context-client";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

export type { SessionContextClientConfig, SessionInfo };
export { SessionContextClient };

/** Value exposed by the session context React provider. */
export interface SessionContextValue {
	/** The underlying SessionContextClient instance. */
	client: SessionContextClient;
	/** Current session info, or null if unauthenticated / not yet loaded. */
	session: SessionInfo | null;
	/** Whether the initial session probe is in progress. */
	loading: boolean;
	/** Trigger a re-fetch of the session info. */
	refresh: () => void;
	/** Persist the intended post-auth redirect. */
	rememberPostAuthRedirect: (postAuthRedirectUri: string) => Promise<void>;
	/** Clear any pending post-auth redirect. */
	clearPostAuthRedirect: () => Promise<void>;
	/** Resolve the current login URL from any pending redirect intent. */
	resolveLoginUrl: () => Promise<string>;
	/** Execute logout through the configured transport and clear local redirect intent. */
	logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionContextProviderProps {
	/** Auth-context config only (baseUrl and path policy). */
	config: SessionContextClientConfig;
	/** Runtime/foundation capability wiring for HTTP. */
	transport: HttpTransport;
	/** Runtime/foundation persistence capability for browser session glue. */
	sessionStore?: RecordStore;
	/** React host glue only. */
	children: ReactNode;
}

export function SessionContextProvider({
	config,
	transport,
	sessionStore,
	children,
}: SessionContextProviderProps) {
	const client = useMemo(
		() => new SessionContextClient(config, { sessionStore }),
		[config, sessionStore],
	);
	const [session, setSession] = useState<SessionInfo | null>(null);
	const [loading, setLoading] = useState(true);
	const [tick, setTick] = useState(0);

	const refresh = useCallback(() => setTick((t) => t + 1), []);
	const rememberPostAuthRedirect = useCallback(
		async (postAuthRedirectUri: string) => {
			await client.rememberPostAuthRedirect(postAuthRedirectUri);
		},
		[client],
	);
	const clearPostAuthRedirect = useCallback(async () => {
		await client.clearPostAuthRedirect();
	}, [client]);
	const resolveLoginUrl = useCallback(async () => {
		return await client.resolveLoginUrl();
	}, [client]);
	const logout = useCallback(async () => {
		await client.logoutAndClearPendingLoginRedirect(transport);
		setSession(null);
		setLoading(false);
	}, [client, transport]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: tick is used to force a refresh
	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		client.fetchUserInfo(transport).then((result) => {
			if (!cancelled) {
				setSession(result);
				setLoading(false);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [client, transport, tick]);

	const value = useMemo(
		() => ({
			client,
			session,
			loading,
			refresh,
			rememberPostAuthRedirect,
			clearPostAuthRedirect,
			resolveLoginUrl,
			logout,
		}),
		[
			client,
			session,
			loading,
			refresh,
			rememberPostAuthRedirect,
			clearPostAuthRedirect,
			resolveLoginUrl,
			logout,
		],
	);

	return (
		<SessionContext.Provider value={value}>{children}</SessionContext.Provider>
	);
}

/** Access the session context from React. */
export function useSessionContext(): SessionContextValue {
	const ctx = useContext(SessionContext);
	if (!ctx) {
		throw new Error(
			"useSessionContext must be used inside <SessionContextProvider>",
		);
	}
	return ctx;
}

/** Convenience hook to get just the session principal. */
export function useSessionPrincipal() {
	const { session } = useSessionContext();
	return session?.principal ?? null;
}
