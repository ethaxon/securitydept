// @vitest-environment jsdom

import {
	createEnvironmentForReact,
	SecuritydeptProvider,
	useSecuritydeptContext,
	useSuspenseResourceValue,
} from "@securitydept/client-react";
import {
	BACKEND_OIDC_MODE_CLIENT,
	provideBackendOidcModeClient,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

function render(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	act(() => root.render(element));

	return {
		container,
		unmount() {
			act(() => root.unmount());
			container.remove();
		},
	};
}

describe("backend-oidc React minimal entry", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("injects the core single-client provider without a React-owned client wrapper", async () => {
		const environment = createEnvironmentForReact({
			providers: provideBackendOidcModeClient({
				config: { baseUrl: "https://auth.example.com" },
				callbackInputResolver: null,
			}),
		});
		const client = environment.injector.get(BACKEND_OIDC_MODE_CLIENT);
		await client.restoreState({
			tokens: { accessToken: "backend-at" },
			metadata: {},
		});

		function AuthBadge() {
			const injectedClient = useSecuritydeptContext().get(
				BACKEND_OIDC_MODE_CLIENT,
			);
			const snapshot = useSuspenseResourceValue(injectedClient.authResource);
			return createElement(
				"output",
				null,
				snapshot?.tokens.accessToken ?? "guest",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(AuthBadge),
			),
		);

		expect(view.container.textContent).toBe("backend-at");
		view.unmount();
	});
});
