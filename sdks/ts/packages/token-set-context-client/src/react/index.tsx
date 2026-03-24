import type {
	Clock,
	HttpTransport,
	LoggerTrait,
	RecordStore,
	Scheduler,
	TraceEventSinkTrait,
} from "@securitydept/client";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from "react";
import { TokenSetContextClient } from "../client";
import type { AuthStateSnapshot, TokenSetContextClientConfig } from "../types";

interface TokenSetContextValue {
	client: TokenSetContextClient;
	state: AuthStateSnapshot | null;
}

const TokenSetContext = createContext<TokenSetContextValue | null>(null);

export interface TokenSetContextProviderProps {
	config: TokenSetContextClientConfig;
	transport: HttpTransport;
	scheduler: Scheduler;
	clock: Clock;
	logger?: LoggerTrait;
	traceSink?: TraceEventSinkTrait;
	persistentStore?: RecordStore;
	sessionStore?: RecordStore;
	children: ReactNode;
}

export function TokenSetContextProvider({
	config,
	transport,
	scheduler,
	clock,
	logger,
	traceSink,
	persistentStore,
	sessionStore,
	children,
}: TokenSetContextProviderProps) {
	const client = useMemo(
		() =>
			new TokenSetContextClient(config, {
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

	// Bridge the signal to React via useSyncExternalStore.
	const state = useSyncExternalStore(
		useCallback(
			(onStoreChange: () => void) => client.state.subscribe(onStoreChange),
			[client],
		),
		() => client.state.get(),
	);

	// Clean up on unmount.
	useEffect(() => () => client.dispose(), [client]);

	const value = useMemo(() => ({ client, state }), [client, state]);

	return (
		<TokenSetContext.Provider value={value}>
			{children}
		</TokenSetContext.Provider>
	);
}

/** Access the full token set context. */
export function useTokenSetContext(): TokenSetContextValue {
	const ctx = useContext(TokenSetContext);
	if (!ctx) {
		throw new Error(
			"useTokenSetContext must be used inside <TokenSetContextProvider>",
		);
	}
	return ctx;
}

/** Convenience hook to get the current auth state snapshot. */
export function useAuthState(): AuthStateSnapshot | null {
	return useTokenSetContext().state;
}

/** Convenience hook to get the current access token. */
export function useAccessToken(): string | null {
	const state = useAuthState();
	return state?.tokens.accessToken ?? null;
}
