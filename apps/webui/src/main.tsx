/// <reference types="vite/client" />

import { provideBasicAuthContext } from "@securitydept/basic-auth-context-client-react";
import { createEnvironmentForNativeWeb } from "@securitydept/client/web";
import { provideSessionContext } from "@securitydept/session-context-client-react";
import { QueryClient } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { provideAuthService } from "./auth/auth.service";
import { basicAuthContextConfig } from "./auth/basic/config";
import { sessionContextConfig } from "./auth/session/config";
import "./app.css";
import { ThemeService } from "./theme/theme.service";

function bootstrap(): void {
	const root = document.getElementById("root");
	if (!root) {
		throw new Error("Root element not found");
	}

	const environment = createEnvironmentForNativeWeb({});
	const themeService = new ThemeService({ window, document });
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				staleTime: 30_000,
			},
		},
	});
	const providers = [
		...provideSessionContext({ config: sessionContextConfig }),
		...provideBasicAuthContext({ config: basicAuthContextConfig }),
		...provideAuthService(),
	];

	createRoot(root).render(
		<App
			environment={environment}
			providers={providers}
			queryClient={queryClient}
			themeService={themeService}
		/>,
	);
}

bootstrap();
