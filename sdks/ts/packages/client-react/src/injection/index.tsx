import { type SecuritydeptInjectorTrait } from "@securitydept/client";
import { createContext, type ReactNode, useContext } from "react";

export const SecuritydeptContext =
	createContext<SecuritydeptInjectorTrait | null>(null);

export interface SecuritydeptProviderProps {
	readonly injector: SecuritydeptInjectorTrait;
	readonly children?: ReactNode;
}

export function SecuritydeptProvider({
	injector,
	children,
}: SecuritydeptProviderProps) {
	return (
		<SecuritydeptContext.Provider value={injector}>
			{children}
		</SecuritydeptContext.Provider>
	);
}

export function useSecuritydeptContext(): SecuritydeptInjectorTrait {
	const injector = useContext(SecuritydeptContext);
	if (!injector) {
		throw new Error(
			"[useSecuritydeptContext] No SecuritydeptProvider found in the component tree.",
		);
	}
	return injector;
}
