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
	useRef,
	useSyncExternalStore,
} from "react";
import { BackendOidcModeClient } from "../client";
import type { AuthStateSnapshot, BackendOidcModeClientConfig } from "../types";

interface BackendOidcModeContextValue {
	client: BackendOidcModeClient;
	state: AuthStateSnapshot | null;
}

const BackendOidcModeContext =
	createContext<BackendOidcModeContextValue | null>(null);

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

	// Clean up on unmount, while tolerating React 18 StrictMode effect replays.
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

/** Access the full token set context. */
export function useBackendOidcModeContext(): BackendOidcModeContextValue {
	const ctx = useContext(BackendOidcModeContext);
	if (!ctx) {
		throw new Error(
			"useBackendOidcModeContext must be used inside <BackendOidcModeContextProvider>",
		);
	}
	return ctx;
}

/** Convenience hook to get the current auth state snapshot. */
export function useAuthState(): AuthStateSnapshot | null {
	return useBackendOidcModeContext().state;
}

/** Convenience hook to get the current access token. */
export function useAccessToken(): string | null {
	const state = useAuthState();
	return state?.tokens.accessToken ?? null;
}
