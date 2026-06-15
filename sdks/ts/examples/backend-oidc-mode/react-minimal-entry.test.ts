// @vitest-environment jsdom

import {
	createEventSubject,
	createSignal,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { SecuritydeptProvider } from "@securitydept/client-react";
import {
	type BaseOidcModeClient,
	type TokenSetAuthEvent,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	provideTokenSetClientRegistry,
	TokenSetClientInitializationMode,
	type TokenSetClientRegistry,
	type TokenSetClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";
import { useTokenSetClientRegistry } from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestTokenSetReactiveFields } from "../_helpers/test-token-set-client";

type BackendViewClient = BaseOidcModeClient & {
	authorizeUrl(): string;
};

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

function createSnapshot(accessToken: string): TokenSetAuthSnapshot {
	return {
		tokens: { accessToken },
		metadata: {},
	};
}

function createBackendClient(
	snapshot: TokenSetAuthSnapshot,
): BackendViewClient {
	const state = createSignal<TokenSetAuthSnapshot | null>(snapshot);
	const reactive = createTestTokenSetReactiveFields(snapshot);
	const dispose = vi.fn(() => {
		state.set(null);
		reactive.emitSnapshot(null);
	});
	state.watchStream().subscribe({
		next() {
			reactive.emitSnapshot(state.get());
		},
	});
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
	} as unknown as BackendViewClient;
}

function createEntry(
	clientFactory: () => BackendViewClient,
): TokenSetClientRegistryEntry<BaseOidcModeClient> {
	return {
		clientFactory,
		meta: {
			clientKey: "main",
			urlPatterns: [],
			callbackUrl: undefined,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Lazy,
		},
	};
}

describe("backend-oidc react minimal entry", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("shows the minimal injector path for consuming backend-OIDC auth state in React", async () => {
		const environment = createEnvironmentForTest({
			providers: provideTokenSetClientRegistry({
				clients: [
					createEntry(() => createBackendClient(createSnapshot("backend-at"))),
				],
			}),
		});
		let registry: TokenSetClientRegistry<BaseOidcModeClient> | undefined;

		function AuthBadge() {
			registry = useTokenSetClientRegistry();
			return createElement("output", null, "ready");
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(AuthBadge),
			),
		);

		await act(async () => {
			await Promise.resolve();
		});

		const client = (
			await registry?.clientRecordFor("main", { initialize: true })
		)?.client;
		expect(await client?.authResource.whenValue()).toEqual(
			createSnapshot("backend-at"),
		);
		view.unmount();
	});

	it("shows advanced client access through the keyed registry", async () => {
		const environment = createEnvironmentForTest({
			providers: provideTokenSetClientRegistry({
				clients: [
					createEntry(() => createBackendClient(createSnapshot("backend-at"))),
				],
			}),
		});
		let registry: TokenSetClientRegistry<BaseOidcModeClient> | undefined;

		function ClientProbe() {
			registry = useTokenSetClientRegistry();
			return createElement("output", null, "ready");
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(ClientProbe),
			),
		);

		await act(async () => {
			await Promise.resolve();
		});

		const client = (
			await registry?.clientRecordFor("main", { initialize: true })
		)?.client;
		if (
			!client ||
			!("authorizeUrl" in client) ||
			typeof client.authorizeUrl !== "function"
		) {
			throw new Error("Expected backend-specific client surface");
		}
		expect(client.authorizeUrl()).toBe("/authorize");
		view.unmount();
	});
});
