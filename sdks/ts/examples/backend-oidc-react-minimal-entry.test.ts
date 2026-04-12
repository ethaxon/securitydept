// @vitest-environment jsdom

// Backend OIDC mode React minimal entry — standalone adopter-facing evidence
//
// This test proves the standalone React entry path for
// @securitydept/token-set-context-client/backend-oidc-mode/react.
//
// An adopter reading this file should understand "how do I wire up
// backend-OIDC auth state in React?" in one glance.

import { createInMemoryRecordStore } from "@securitydept/client";
import type { BackendOidcModeContextProviderProps } from "@securitydept/token-set-context-client-react";
import {
	BackendOidcModeContextProvider,
	useAccessToken,
	useAuthState,
	useBackendOidcModeContext,
} from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

function render(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	act(() => {
		root.render(element);
	});

	return {
		container,
		unmount() {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	};
}

function ProviderEntry(
	props: Omit<BackendOidcModeContextProviderProps, "children"> & {
		children?: ReactNode;
	},
) {
	return createElement(
		BackendOidcModeContextProvider,
		props as unknown as BackendOidcModeContextProviderProps,
	);
}

// Minimal runtime stubs — just enough to construct a client.
const minimalRuntime = {
	transport: {
		async execute() {
			return { status: 500, headers: {}, body: null };
		},
	},
	scheduler: {
		setTimeout() {
			return { cancel() {} };
		},
	},
	clock: { now: () => Date.now() },
	persistentStore: createInMemoryRecordStore(),
	sessionStore: createInMemoryRecordStore(),
};

describe("backend-oidc-mode react minimal entry", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("shows the standalone React entry path: provider → hook → auth state consumption", () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		// 1. A consumer that reads auth state via the convenience hooks.
		function AuthBadge() {
			const authState = useAuthState();
			const accessToken = useAccessToken();
			return createElement(
				"output",
				null,
				accessToken
					? `token:${accessToken}`
					: `unauthenticated(state:${authState === null ? "null" : "present"})`,
			);
		}

		// 2. Wire up the provider with minimal config + runtime.
		const view = render(
			createElement(
				ProviderEntry,
				{
					config: { baseUrl: "https://auth.example.com" },
					...minimalRuntime,
				} satisfies Omit<BackendOidcModeContextProviderProps, "children">,
				createElement(AuthBadge),
			),
		);

		// 3. Initially no auth state — renders "unauthenticated".
		expect(view.container.textContent).toBe("unauthenticated(state:null)");

		view.unmount();
	});

	it("shows the full context hook usage: access to client and state", () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		function ContextProbe() {
			const { client, state } = useBackendOidcModeContext();
			// The client is accessible for advanced operations (e.g. restoreState).
			// The state is the current auth snapshot (null when unauthenticated).
			return createElement(
				"output",
				null,
				`client:${client ? "yes" : "no"},state:${state ? "active" : "empty"}`,
			);
		}

		const view = render(
			createElement(
				ProviderEntry,
				{
					config: { baseUrl: "https://auth.example.com" },
					...minimalRuntime,
				} satisfies Omit<BackendOidcModeContextProviderProps, "children">,
				createElement(ContextProbe),
			),
		);

		expect(view.container.textContent).toBe("client:yes,state:empty");

		view.unmount();
	});
});
