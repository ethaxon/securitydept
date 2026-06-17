// @vitest-environment jsdom

import {
	createEnvironmentForReact,
	SecuritydeptProvider,
	useSuspenseResourceValue,
} from "@securitydept/client-react";
import { createBackendOidcModeClientFactory } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	provideTokenSetClientRegistry,
	TokenSetClientInitializationMode,
	TokenSetRequirementKind,
} from "@securitydept/token-set-context-client/registry";
import { useTokenSetClientRegistry } from "@securitydept/token-set-context-client-react";
import {
	act,
	createElement,
	Fragment,
	type ReactElement,
	Suspense,
} from "react";
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

function createEntry(clientKey: string) {
	return {
		clientFactory: createBackendOidcModeClientFactory({
			config: {
				id: clientKey,
				baseUrl: `https://${clientKey}.example.com`,
			},
			callbackInputResolver: null,
		}),
		meta: {
			clientKey,
			urlPatterns: [],
			requirementKind: TokenSetRequirementKind.BackendOidc,
			initialization: TokenSetClientInitializationMode.Lazy,
		},
	};
}

describe("React multi-client registry baseline", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("materializes keyed clients through shared registry resources", async () => {
		const environment = createEnvironmentForReact({
			providers: provideTokenSetClientRegistry({
				clients: [createEntry("main"), createEntry("admin")],
			}),
		});

		function ClientName({ clientKey }: { readonly clientKey: string }) {
			const registry = useTokenSetClientRegistry();
			const client = useSuspenseResourceValue(
				registry.clientResourceFor(clientKey),
			);
			return createElement("output", null, client.id);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(
					Suspense,
					{ fallback: createElement("output", null, "loading") },
					createElement(
						Fragment,
						null,
						createElement(ClientName, { clientKey: "main" }),
						createElement(ClientName, { clientKey: "admin" }),
					),
				),
			),
		);

		expect(view.container.textContent).toBe("loading");

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("mainadmin");
		view.unmount();
	});
});
