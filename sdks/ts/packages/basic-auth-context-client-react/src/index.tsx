// Basic Auth Context Client — React adapter
//
// Canonical import path:
//   import { ... } from "@securitydept/basic-auth-context-client-react"
//
// Provides React context / hooks for integrating BasicAuthContextClient in a
// React application.  The core client lives in @securitydept/basic-auth-context-client;
// this package supplies the React-specific binding layer only.
//
// Stability: provisional (React adapter)

import type { BasicAuthContextClientConfig } from "@securitydept/basic-auth-context-client";
import { BasicAuthContextClient } from "@securitydept/basic-auth-context-client";
import { createContext, type ReactNode, useContext, useMemo } from "react";

export type { BasicAuthContextClientConfig };
export { BasicAuthContextClient };

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
