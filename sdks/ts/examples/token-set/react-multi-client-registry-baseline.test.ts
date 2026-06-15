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
import { describe, expect, it } from "vitest";
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
			callbackUrl: undefined,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Lazy,
		},
	};
}

describe("react multi-client registry baseline", () => {
	it("surfaces multiple keyed clients through SecuritydeptProvider", async () => {
		const mainState = createSignal<TokenSetAuthSnapshot | null>(
			createSnapshot("main-at"),
		);
		const adminState = createSignal<TokenSetAuthSnapshot | null>(
			createSnapshot("admin-at"),
		);
		const environment = createEnvironmentForTest({
			providers: provideTokenSetClientRegistry({
				clients: [
					createEntry("main", () => createClient(mainState)),
					createEntry("admin", () => createClient(adminState)),
				],
			}),
		});
		let registry: TokenSetClientRegistry<BaseOidcModeClient> | undefined;

		function Probe() {
			registry = useTokenSetClientRegistry();
			return createElement("output", null, "ready");
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(Probe),
			),
		);

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		const mainClient = (
			await registry?.clientRecordFor("main", { initialize: true })
		)?.client;
		const adminClient = (
			await registry?.clientRecordFor("admin", { initialize: true })
		)?.client;
		expect(await mainClient?.authResource.whenValue()).toEqual(
			createSnapshot("main-at"),
		);
		expect(await adminClient?.authResource.whenValue()).toEqual(
			createSnapshot("admin-at"),
		);
		view.unmount();
	});

	it("re-renders when a keyed client signal changes", async () => {
		const mainState = createSignal<TokenSetAuthSnapshot | null>(
			createSnapshot("main-at"),
		);
		const environment = createEnvironmentForTest({
			providers: provideTokenSetClientRegistry({
				clients: [createEntry("main", () => createClient(mainState))],
			}),
		});
		let registry: TokenSetClientRegistry<BaseOidcModeClient> | undefined;

		function Probe() {
			registry = useTokenSetClientRegistry();
			return createElement("output", null, "ready");
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(Probe),
			),
		);

		await act(async () => {
			await Promise.resolve();
		});
		act(() => {
			mainState.set(createSnapshot("updated-at"));
		});

		const client = (
			await registry?.clientRecordFor("main", { initialize: true })
		)?.client;
		expect(await client?.authResource.whenValue()).toEqual(
			createSnapshot("updated-at"),
		);
		view.unmount();
	});
});
