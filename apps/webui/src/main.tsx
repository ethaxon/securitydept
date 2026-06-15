/// <reference types="vite/client" />

import { provideBasicAuthContext } from "@securitydept/basic-auth-context-client";
import { createEnvironmentForNativeWeb } from "@securitydept/client/web";
import { createEnvironmentForReact } from "@securitydept/client-react";
import { provideSessionContext } from "@securitydept/session-context-client";
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

	const environment = createEnvironmentForReact({
		createBaseEnvironment: createEnvironmentForNativeWeb,
		providers: [
			...provideSessionContext({ config: sessionContextConfig }),
			...provideBasicAuthContext({ config: basicAuthContextConfig }),
			...provideAuthService(),
		],
	});
	const themeService = new ThemeService({ window, document });
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				staleTime: 30_000,
			},
		},
	});
	createRoot(root).render(
		<App
			injector={environment.injector}
			queryClient={queryClient}
			themeService={themeService}
		/>,
	);
}

bootstrap();
