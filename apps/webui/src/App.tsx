import {
	type FoundationEnvironment,
	type SecuritydeptProvider as SecuritydeptDependencyProvider,
} from "@securitydept/client";
import {
	SecuritydeptProvider,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { createTanStackRouterContext } from "@securitydept/client-react/tanstack-router";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, useMemo } from "react";
import { AuthRuntime } from "@/auth/runtime";
import { createAppRouter } from "@/router";
import { ThemeProvider } from "@/theme/react";
import { type ThemeService } from "@/theme/theme.service";

export interface AppProps {
	readonly environment: FoundationEnvironment;
	readonly providers: readonly SecuritydeptDependencyProvider[];
	readonly queryClient: QueryClient;
	readonly themeService: ThemeService;
}

export function App({
	environment,
	providers,
	queryClient,
	themeService,
}: AppProps) {
	return (
		<ThemeProvider service={themeService}>
			<QueryClientProvider client={queryClient}>
				<SecuritydeptProvider
					parentInjector={environment.injector}
					providers={providers}
				>
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
			<AuthRuntime />
			<RouterProvider router={router} />
		</StrictMode>
	);
}
