// @vitest-environment jsdom

import {
	createEventSubject,
	createSignal,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import {
	SecuritydeptProvider,
	useReplaySignalValue,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import {
	type AuthSnapshot,
	type TokenSetAuthEvent,
} from "@securitydept/token-set-context-client/orchestration";
import {
	ClientInitializationMode,
	type ClientRegistryEntry,
	createClientRegistry,
} from "@securitydept/token-set-context-client/registry";
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
	const dispose = vi.fn(() => {
		state.set(null);
		reactive.emitSnapshot(null);
	});
	state.notify(() => reactive.emitSnapshot(state.get()));
	return {
		...reactive.fields,
		authEvents: createEventSubject<TokenSetAuthEvent>(),
		addWorkflowSource: () => ({ unsubscribe: () => undefined }),
		removeWorkflowSource: () => false,
		start: async () => undefined,
		dispose,
		[SYMBOL_DISPOSE]: dispose,
		restorePersistedState: async () => state.get(),
		loginWithRedirect: async () => undefined,
		logout: async () => undefined,
		loginWithPopup: async () => ({ snapshot }),
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
	const registry = createClientRegistry<TokenSetBackendOidcClient>({
		environment: {},
	});

	for (const client of clients) {
		registry.register(toCoreEntry(client));
	}

	return registry;
}

function toCoreEntry(
	entry: BackendClientEntry,
): ClientRegistryEntry<TokenSetBackendOidcClient> {
	return {
		clientFactory: entry.clientFactory,
		meta: {
			clientKey: entry.key,
			urlPatterns: entry.urlPatterns ?? [],
			callbackPath: entry.callbackPath,
			requirementKind: entry.requirementKind,
			providerFamily: entry.providerFamily,
			initialization:
				entry.initialization ?? ClientInitializationMode.Immediate,
		},
	};
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
		await registry.initialize("main");

		function AuthBadge() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const client = useReplaySignalValue(registry.clientSignalFor("main"));
			return createElement(AuthBadgeForClient, { client });
		}

		function AuthBadgeForClient({ client }: { client: TokenSetReactClient }) {
			const snapshot = useReplaySignalValue(client.authSnapshot, {
				initialValue: null,
			});
			return createElement(
				"output",
				null,
				snapshot ? `token:${snapshot.tokens.accessToken}` : "unauthenticated",
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
		await registry.initialize("main");

		function ClientProbe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const client = useReplaySignalValue(registry.clientSignalFor("main"));
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
