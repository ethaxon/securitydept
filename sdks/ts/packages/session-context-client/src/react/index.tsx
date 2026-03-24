import type { HttpTransport, RecordStore } from "@securitydept/client";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { SessionContextClient } from "../client";
import type { SessionContextClientConfig, SessionInfo } from "../types";

interface SessionContextValue {
	client: SessionContextClient;
	session: SessionInfo | null;
	loading: boolean;
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
		client.fetchMe(transport).then((result) => {
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
