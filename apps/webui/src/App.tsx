import { type SecuritydeptInjectorTrait } from "@securitydept/client";
import {
	SecuritydeptProvider,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { createTanStackRouterContext } from "@securitydept/client-react/tanstack-router";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, Suspense, useMemo } from "react";
import { createAppRouter } from "@/router";
import { ThemeProvider } from "@/theme/react";
import { type ThemeService } from "@/theme/theme.service";

export interface AppProps {
	readonly injector: SecuritydeptInjectorTrait;
	readonly queryClient: QueryClient;
	readonly themeService: ThemeService;
}

export function App({ injector, queryClient, themeService }: AppProps) {
	return (
		<ThemeProvider service={themeService}>
			<QueryClientProvider client={queryClient}>
				<SecuritydeptProvider injector={injector}>
					<AppRouterProvider />
				</SecuritydeptProvider>
			</QueryClientProvider>
		</ThemeProvider>
	);
}

function AppRouterProvider() {
	const injector = useSecuritydeptContext();
	const router = useMemo(
		() => createAppRouter(createTanStackRouterContext({ injector })),
		[injector],
	);
	return (
		<StrictMode>
			<Suspense fallback={null}>
				<RouterProvider router={router} />
			</Suspense>
		</StrictMode>
	);
}
