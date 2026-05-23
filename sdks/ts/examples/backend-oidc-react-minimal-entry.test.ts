// @vitest-environment jsdom

import { createSignal, createSubject } from "@securitydept/client";
import {
	SecuritydeptProvider,
	useReadableSignal,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import type {
	AuthSnapshot,
	TokenSetAuthEvent,
} from "@securitydept/token-set-context-client/orchestration";
import { createTokenSetOidcAuthRegistry } from "@securitydept/token-set-context-client/registry";
import {
	provideTokenSetAuthRegistry,
	type ReactRegistry,
	TOKEN_SET_AUTH_REGISTRY,
	type TokenSetBackendOidcClient,
	type TokenSetClientEntry,
	type TokenSetReactClient,
} from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestTokenSetReactiveFields } from "./test-token-set-client";

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

function createSnapshot(accessToken: string): AuthSnapshot {
	return {
		tokens: { accessToken },
		metadata: {},
	};
}

function createBackendClient(
	snapshot: AuthSnapshot,
): TokenSetBackendOidcClient {
	const state = createSignal<AuthSnapshot | null>(snapshot);
	const reactive = createTestTokenSetReactiveFields(snapshot);
	state.subscribe(() => reactive.emitSnapshot(state.get()));
	return {
		...reactive.fields,
		authEvents: createSubject<TokenSetAuthEvent>(),
		addWorkflowSource: () => ({ unsubscribe: () => undefined }),
		removeWorkflowSource: () => false,
		start: async () => undefined,
		dispose: vi.fn(() => {
			state.set(null);
			reactive.emitSnapshot(null);
		}),
		restorePersistedState: async () => state.get(),
		handleCallback: async () => ({ snapshot }),
		loginWithRedirect: async () => undefined,
		authorizeUrl: () => "/authorize",
		refreshState: async () => snapshot,
		clearState: async () => {
			state.set(null);
			reactive.emitSnapshot(null);
		},
	};
}

type BackendClientEntry = Omit<TokenSetClientEntry, "clientFactory"> & {
	clientFactory: () =>
		| TokenSetBackendOidcClient
		| Promise<TokenSetBackendOidcClient>;
};

function createManualRegistry(
	clients: readonly BackendClientEntry[],
): ReactRegistry {
	const registry = createTokenSetOidcAuthRegistry<TokenSetBackendOidcClient>();

	for (const client of clients) {
		const registration = registry.register(client);
		if (registration instanceof Promise) {
			registration.catch(() => {});
		}
	}

	return registry;
}

describe("backend-oidc react minimal entry", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("shows the minimal injector path for consuming backend-OIDC auth state in React", async () => {
		const registry = createManualRegistry([
			{
				key: "main",
				clientFactory: () => createBackendClient(createSnapshot("backend-at")),
			},
		]);
		await registry.whenReady("main");

		function AuthBadge() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const clientSlot = useReadableSignal(registry.clientSignalFor("main"));
			return clientSlot.kind === "value"
				? createElement(AuthBadgeForClient, { client: clientSlot.value })
				: createElement("output", null, "unauthenticated");
		}

		function AuthBadgeForClient({ client }: { client: TokenSetReactClient }) {
			const snapshot = useReadableSignal(client.authSnapshot);
			return createElement(
				"output",
				null,
				snapshot.kind === "value" && snapshot.value
					? `token:${snapshot.value.tokens.accessToken}`
					: "unauthenticated",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideTokenSetAuthRegistry(registry)] },
				createElement(AuthBadge),
			),
		);

		expect(view.container.textContent).toBe("token:backend-at");
		view.unmount();
		registry.dispose();
	});

	it("shows advanced client access through the keyed registry service", async () => {
		const registry = createManualRegistry([
			{
				key: "main",
				clientFactory: () => createBackendClient(createSnapshot("backend-at")),
			},
		]);
		await registry.whenReady("main");

		function ClientProbe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const clientSlot = useReadableSignal(registry.clientSignalFor("main"));
			if (clientSlot.kind !== "value") {
				return createElement("output", null, "empty");
			}
			const client = clientSlot.value;
			if (
				!("authorizeUrl" in client) ||
				typeof client.authorizeUrl !== "function"
			) {
				throw new Error("Expected backend-specific client surface");
			}
			return createElement(
				"output",
				null,
				(client as TokenSetBackendOidcClient).authorizeUrl(),
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideTokenSetAuthRegistry(registry)] },
				createElement(ClientProbe),
			),
		);

		expect(view.container.textContent).toBe("/authorize");
		view.unmount();
		registry.dispose();
	});
});
