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
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionContextProviderProps {
	config: SessionContextClientConfig;
	transport: HttpTransport;
	sessionStore?: RecordStore;
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
		() => ({ client, session, loading, refresh }),
		[client, session, loading, refresh],
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
