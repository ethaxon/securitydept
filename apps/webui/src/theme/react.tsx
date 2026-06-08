import { useSignal } from "@securitydept/client-react";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import {
	type ThemePreference as ThemePreferenceValue,
	type ThemeService,
} from "./theme.service";

const ThemeServiceContext = createContext<ThemeService | null>(null);

export function ThemeProvider({
	service,
	children,
}: {
	service: ThemeService;
	children: ReactNode;
}) {
	useEffect(() => {
		service.start();
		return () => service.stop();
	}, [service]);

	return (
		<ThemeServiceContext.Provider value={service}>
			{children}
		</ThemeServiceContext.Provider>
	);
}

export function useThemeService(): ThemeService {
	const service = useContext(ThemeServiceContext);
	if (service === null) {
		throw new Error("ThemeProvider is missing.");
	}
	return service;
}

export function useThemePreference(): {
	preference: ThemePreferenceValue;
	setPreference(preference: ThemePreferenceValue): void;
} {
	const service = useThemeService();
	return {
		preference: useSignal(service.preference),
		setPreference: (preference) => service.setPreference(preference),
	};
}

export { ThemePreference } from "./theme.service";
