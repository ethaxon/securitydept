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
import { describe, expect, it } from "vitest";
import { createEnvironmentForTest } from "../../packages/client/src/test";
import { createTestTokenSetReactiveFields } from "../_helpers/test-token-set-client";

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

function createClient(
	state: ReturnType<typeof createSignal<TokenSetAuthSnapshot | null>>,
): BaseOidcModeClient {
	const reactive = createTestTokenSetReactiveFields(state.get());
	state.notify(() => reactive.emitSnapshot(state.get()));
	return {
		...reactive.fields,
		authEvents: createEventSubject<TokenSetAuthEvent>(),
		addWorkflowSource: () => ({ unsubscribe: () => undefined }),
		removeWorkflowSource: () => false,
		start: async () => undefined,
		dispose: () => {
			state.set(null);
			reactive.emitSnapshot(null);
		},
		[SYMBOL_DISPOSE]: () => {
			state.set(null);
			reactive.emitSnapshot(null);
		},
		restorePersistedState: async () => state.get(),
		loginWithRedirect: async () => undefined,
		logout: async () => undefined,
		loginWithPopup: async () => ({ snapshot: state.get()! }),
	} as unknown as BaseOidcModeClient;
}

function createEntry(
	clientKey: string,
	clientFactory: () => BaseOidcModeClient,
): TokenSetClientRegistryEntry<BaseOidcModeClient> {
	return {
		clientFactory,
		meta: {
			clientKey,
			urlPatterns: [],
			callbackPath: undefined,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Lazy,
		},
	};
}

describe("react multi-client registry baseline", () => {
	it("surfaces multiple keyed clients through SecuritydeptProvider", async () => {
		const environment = createEnvironmentForTest();
		const mainState = createSignal<TokenSetAuthSnapshot | null>(
			createSnapshot("main-at"),
		);
		const adminState = createSignal<TokenSetAuthSnapshot | null>(
			createSnapshot("admin-at"),
		);
		let registry: TokenSetClientRegistryService | undefined;

		function Probe() {
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
								createEntry("main", () => createClient(mainState)),
								createEntry("admin", () => createClient(adminState)),
							],
						}),
					],
				},
				createElement(Probe),
			),
		);

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		const mainClient = (await registry?.initialize("main"))?.client;
		const adminClient = (await registry?.initialize("admin"))?.client;
		expect(await mainClient?.authSnapshot.whenValue()).toEqual(
			createSnapshot("main-at"),
		);
		expect(await adminClient?.authSnapshot.whenValue()).toEqual(
			createSnapshot("admin-at"),
		);
		view.unmount();
	});

	it("re-renders when a keyed client signal changes", async () => {
		const environment = createEnvironmentForTest();
		const mainState = createSignal<TokenSetAuthSnapshot | null>(
			createSnapshot("main-at"),
		);
		let registry: TokenSetClientRegistryService | undefined;

		function Probe() {
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
							clients: [createEntry("main", () => createClient(mainState))],
						}),
					],
				},
				createElement(Probe),
			),
		);

		await act(async () => {
			await Promise.resolve();
		});
		act(() => {
			mainState.set(createSnapshot("updated-at"));
		});

		const client = (await registry?.initialize("main"))?.client;
		expect(await client?.authSnapshot.whenValue()).toEqual(
			createSnapshot("updated-at"),
		);
		view.unmount();
	});
});
