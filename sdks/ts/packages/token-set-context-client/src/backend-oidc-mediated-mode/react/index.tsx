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
import { BackendOidcMediatedModeClient } from "../client";
import type {
	AuthStateSnapshot,
	BackendOidcMediatedModeClientConfig,
} from "../types";

interface BackendOidcMediatedModeContextValue {
	client: BackendOidcMediatedModeClient;
	state: AuthStateSnapshot | null;
}

const BackendOidcMediatedModeContext =
	createContext<BackendOidcMediatedModeContextValue | null>(null);

export interface BackendOidcMediatedModeContextProviderProps {
	config: BackendOidcMediatedModeClientConfig;
	transport: HttpTransport;
	scheduler: Scheduler;
	clock: Clock;
	logger?: LoggerTrait;
	traceSink?: TraceEventSinkTrait;
	persistentStore?: RecordStore;
	sessionStore?: RecordStore;
	children: ReactNode;
}

export function BackendOidcMediatedModeContextProvider({
	config,
	transport,
	scheduler,
	clock,
	logger,
	traceSink,
	persistentStore,
	sessionStore,
	children,
}: BackendOidcMediatedModeContextProviderProps) {
	const client = useMemo(
		() =>
			new BackendOidcMediatedModeClient(config, {
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
	const lifecycleMountsRef = useRef(
		new Map<BackendOidcMediatedModeClient, number>(),
	);

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
		<BackendOidcMediatedModeContext.Provider value={value}>
			{children}
		</BackendOidcMediatedModeContext.Provider>
	);
}

/** Access the full token set context. */
export function useBackendOidcMediatedModeContext(): BackendOidcMediatedModeContextValue {
	const ctx = useContext(BackendOidcMediatedModeContext);
	if (!ctx) {
		throw new Error(
			"useBackendOidcMediatedModeContext must be used inside <BackendOidcMediatedModeContextProvider>",
		);
	}
	return ctx;
}

/** Convenience hook to get the current auth state snapshot. */
export function useAuthState(): AuthStateSnapshot | null {
	return useBackendOidcMediatedModeContext().state;
}

/** Convenience hook to get the current access token. */
export function useAccessToken(): string | null {
	const state = useAuthState();
	return state?.tokens.accessToken ?? null;
}
