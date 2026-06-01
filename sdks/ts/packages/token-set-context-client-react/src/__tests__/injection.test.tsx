// @vitest-environment jsdom

import {
	createEventSubject,
	createReplaySignal,
	createSignal,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import {
	SecuritydeptProvider,
	useReplaySignalValue,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import {
	type TokenSetAuthEvent,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	type TokenSetClientRegistryEntry as CoreClientRegistryEntry,
	createTokenSetClientRegistry,
	TokenSetClientInitializationMode,
} from "@securitydept/token-set-context-client/registry";
import {
	provideTokenSetAuthRegistry,
	provideTokenSetCallbackResumeController,
	type ReactRegistry,
	TOKEN_SET_AUTH_REGISTRY,
	TOKEN_SET_CALLBACK_RESUME_CONTROLLER,
	type TokenSetClientEntry,
	type TokenSetReactClient,
} from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement } from "react";
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

function createSnapshot(accessToken: string): TokenSetAuthSnapshot {
	return {
		tokens: { accessToken },
		metadata: {},
	};
}

function createManualRegistry(
	clients: readonly TokenSetClientEntry[],
): ReactRegistry {
	const registry = createTokenSetClientRegistry<TokenSetReactClient>({
		environment: {},
	});

	for (const client of clients) {
		registry.register(toCoreEntry(client));
	}

	return registry;
}

function toCoreEntry(
	entry: TokenSetClientEntry,
): CoreClientRegistryEntry<TokenSetReactClient> {
	return {
		clientFactory: entry.clientFactory,
		meta: {
			clientKey: entry.key,
			urlPatterns: entry.urlPatterns ?? [],
			callbackPath: entry.callbackPath,
			requirementKind: entry.requirementKind,
			providerFamily: entry.providerFamily,
			initialization:
				entry.initialization ?? TokenSetClientInitializationMode.Immediate,
		},
	};
}

describe("token-set injector factories", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("exposes registry and callback-controller tokens through explicit SecuritydeptProvider composition", async () => {
		const state = createSignal<TokenSetAuthSnapshot | null>(
			createSnapshot("main-at"),
		);
		const authSnapshot = createReplaySignal<TokenSetAuthSnapshot | null>();
		authSnapshot.setValue(state.get());
		const isAuthenticated = createReplaySignal<boolean>();
		isAuthenticated.setValue(true);
		const authorizationHeaderValue = createReplaySignal<string | undefined>();
		authorizationHeaderValue.setValue("Bearer main-at");
		const authDetermined = createReplaySignal<true>();
		authDetermined.setValue(true);
		const lastAuthError = createSignal<unknown | undefined>(undefined);
		const registry = createManualRegistry([
			{
				key: "main",
				clientFactory: () => ({
					state,
					authDetermined,
					authSnapshot,
					isAuthenticated,
					authorizationHeaderValue,
					lastAuthError,
					authOperations: {
						restorePending: createSignal(false),
						refreshPending: createSignal(false),
						clearPending: createSignal(false),
						loginPending: createSignal(false),
					},
					authEvents: createEventSubject<TokenSetAuthEvent>(),
					addWorkflowSource: () => ({ unsubscribe: () => undefined }),
					removeWorkflowSource: () => false,
					start: async () => undefined,
					dispose: () => state.set(null),
					[SYMBOL_DISPOSE]: () => state.set(null),
					restorePersistedState: async () => state.get(),
					handleCallback: async () => ({
						snapshot: createSnapshot("main-at"),
					}),
					loginWithRedirect: async () => undefined,
					logout: async () => undefined,
					loginWithPopup: async () => ({
						snapshot: createSnapshot("main-at"),
					}),
				}),
			},
		]);
		const providers = [
			provideTokenSetAuthRegistry(registry),
			provideTokenSetCallbackResumeController(registry),
		] as const;

		function Probe() {
			const injector = useSecuritydeptContext();
			const registry = injector.get(TOKEN_SET_AUTH_REGISTRY);
			const controller = injector.get(TOKEN_SET_CALLBACK_RESUME_CONTROLLER);
			const client = useReplaySignalValue(registry.clientSignalFor("main"));
			const snapshot = useReplaySignalValue(client.authSnapshot, {
				initialValue: null,
			});
			return createElement(
				"output",
				null,
				`${snapshot?.tokens.accessToken ?? "empty"}:${controller.state.get().state}`,
			);
		}

		const view = render(
			createElement(SecuritydeptProvider, { providers }, createElement(Probe)),
		);
		await act(async () => {
			await Promise.resolve();
		});

		expect(view.container.textContent).toContain("main-at");
		await act(async () => {
			view.unmount();
			await Promise.resolve();
		});
		expect(state.get()?.tokens.accessToken).toBe("main-at");
		registry.dispose();
		expect(state.get()).toBeNull();
	});
});
