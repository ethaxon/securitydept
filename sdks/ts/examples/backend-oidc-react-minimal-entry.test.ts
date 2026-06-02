// @vitest-environment jsdom

import {
	createEventSubject,
	createSignal,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import {
	SecuritydeptProvider,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import {
	type BaseOidcModeClient,
	type TokenSetAuthEvent,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";
import {
	provideTokenSetClientRegistry,
	TOKEN_SET_CLIENT_REGISTRY,
	type TokenSetClientRegistryService,
} from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvironmentForTest } from "../packages/client/src/test";
import { createTestTokenSetReactiveFields } from "./test-token-set-client";

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
			callbackPath: undefined,
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
		const environment = createEnvironmentForTest();
		let registry: TokenSetClientRegistryService | undefined;

		function AuthBadge() {
			registry = useSecuritydeptContext().get(TOKEN_SET_CLIENT_REGISTRY);
			return createElement("output", null, "ready");
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					parentInjector: environment.injector,
					providers: [
						...provideTokenSetClientRegistry({
							clients: [
								createEntry(() =>
									createBackendClient(createSnapshot("backend-at")),
								),
							],
						}),
					],
				},
				createElement(AuthBadge),
			),
		);

		await act(async () => {
			await Promise.resolve();
		});

		const client = (await registry?.initialize("main"))?.client;
		expect(await client?.authSnapshot.whenValue()).toEqual(
			createSnapshot("backend-at"),
		);
		view.unmount();
	});

	it("shows advanced client access through the keyed registry service", async () => {
		const environment = createEnvironmentForTest();
		let registry: TokenSetClientRegistryService | undefined;

		function ClientProbe() {
			registry = useSecuritydeptContext().get(TOKEN_SET_CLIENT_REGISTRY);
			return createElement("output", null, "ready");
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					parentInjector: environment.injector,
					providers: [
						...provideTokenSetClientRegistry({
							clients: [
								createEntry(() =>
									createBackendClient(createSnapshot("backend-at")),
								),
							],
						}),
					],
				},
				createElement(ClientProbe),
			),
		);

		await act(async () => {
			await Promise.resolve();
		});

		const client = (await registry?.initialize("main"))?.client;
		if (
			!("authorizeUrl" in client) ||
			typeof client.authorizeUrl !== "function"
		) {
			throw new Error("Expected backend-specific client surface");
		}
		expect(client.authorizeUrl()).toBe("/authorize");
		view.unmount();
	});
});
