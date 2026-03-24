import { createContext, type ReactNode, useContext, useMemo } from "react";
import { BasicAuthContextClient } from "../client";
import type { BasicAuthContextClientConfig } from "../types";

const BasicAuthContext = createContext<BasicAuthContextClient | null>(null);

export interface BasicAuthContextProviderProps {
	config: BasicAuthContextClientConfig;
	children: ReactNode;
}

export function BasicAuthContextProvider({
	config,
	children,
}: BasicAuthContextProviderProps) {
	const client = useMemo(() => new BasicAuthContextClient(config), [config]);

	return (
		<BasicAuthContext.Provider value={client}>
			{children}
		</BasicAuthContext.Provider>
	);
}

/** Access the `BasicAuthContextClient` from React context. */
export function useBasicAuthContext(): BasicAuthContextClient {
	const ctx = useContext(BasicAuthContext);
	if (!ctx) {
		throw new Error(
			"useBasicAuthContext must be used inside <BasicAuthContextProvider>",
		);
	}
	return ctx;
}
