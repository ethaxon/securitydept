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
	type AuthSnapshot,
	type TokenSetAuthEvent,
} from "@securitydept/token-set-context-client/orchestration";
import {
	ClientInitializationMode,
	type ClientRegistryEntry as CoreClientRegistryEntry,
	createClientRegistry,
} from "@securitydept/token-set-context-client/registry";
import {
	provideTokenSetAuthRegistry,
	type ReactRegistry,
	TOKEN_SET_AUTH_REGISTRY,
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

function createSnapshot(accessToken: string): AuthSnapshot {
	return {
		tokens: { accessToken },
		metadata: {},
	};
}

function createRegistryOptions(accessToken: string) {
	const state = createSignal<AuthSnapshot | null>(createSnapshot(accessToken));
	const authSnapshot = createReplaySignal<AuthSnapshot | null>();
	authSnapshot.setValue(state.get());
	const isAuthenticated = createReplaySignal<boolean>();
	isAuthenticated.setValue(true);
	const authorizationHeaderValue = createReplaySignal<string | undefined>();
	authorizationHeaderValue.setValue(`Bearer ${accessToken}`);
	const authDetermined = createReplaySignal<true>();
	authDetermined.setValue(true);
	const lastAuthError = createSignal<unknown | undefined>(undefined);
	state.notify(() => {
		const snapshot = state.get();
		authSnapshot.setValue(snapshot);
		isAuthenticated.setValue(Boolean(snapshot?.tokens.accessToken));
		authorizationHeaderValue.setValue(
			snapshot?.tokens.accessToken
				? `Bearer ${snapshot.tokens.accessToken}`
				: undefined,
		);
	});
	return {
		state,
		clients: [
			{
				key: "main",
				clientFactory: () => ({
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
						snapshot: createSnapshot(accessToken),
					}),
					loginWithRedirect: async () => undefined,
					logout: async () => undefined,
					loginWithPopup: async () => ({
						snapshot: createSnapshot(accessToken),
					}),
				}),
			},
		] satisfies readonly TokenSetClientEntry[],
	};
}

function createManualRegistry(
	clients: readonly TokenSetClientEntry[],
): ReactRegistry {
	const registry = createClientRegistry<TokenSetReactClient>({
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
				entry.initialization ?? ClientInitializationMode.Immediate,
		},
	};
}

describe("token-set react adapter", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("reads registry-backed auth state through SecuritydeptProvider", async () => {
		const { clients, state } = createRegistryOptions("main-at");

		function Probe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const client = useReplaySignalValue(registry.clientSignalFor("main"));
			return createElement(ClientStateProbe, { client });
		}

		function ClientStateProbe({ client }: { client: TokenSetReactClient }) {
			const authState = useReplaySignalValue(client.authSnapshot, {
				initialValue: null,
			});
			return createElement(
				"output",
				null,
				authState?.tokens.accessToken ?? "empty",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideTokenSetAuthRegistry({ clients })] },
				createElement(Probe),
			),
		);
		await act(async () => {
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("main-at");

		act(() => {
			state.set(createSnapshot("updated-at"));
		});

		expect(view.container.textContent).toBe("updated-at");

		await act(async () => {
			view.unmount();
			await Promise.resolve();
		});
		expect(state.get()).toBeNull();
	});

	it("supports nested injector overrides for token-set registries", async () => {
		const parent = createRegistryOptions("parent-at");
		const child = createRegistryOptions("child-at");

		function Probe({ label }: { label: string }) {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const client = useReplaySignalValue(registry.clientSignalFor("main"));
			return createElement(LabeledClientStateProbe, {
				client,
				label,
			});
		}

		function LabeledClientStateProbe({
			client,
			label,
		}: {
			client: TokenSetReactClient;
			label: string;
		}) {
			const authState = useReplaySignalValue(client.authSnapshot, {
				initialValue: null,
			});
			return createElement(
				"output",
				null,
				`${label}:${authState?.tokens.accessToken ?? "empty"}`,
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					providers: [provideTokenSetAuthRegistry({ clients: parent.clients })],
				},
				createElement(Probe, { label: "parent" }),
				createElement(
					SecuritydeptProvider,
					{
						providers: [
							provideTokenSetAuthRegistry({ clients: child.clients }),
						],
					},
					createElement(Probe, { label: "child" }),
				),
			),
		);
		await act(async () => {
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("parent:parent-atchild:child-at");

		await act(async () => {
			view.unmount();
			await Promise.resolve();
		});
		expect(parent.state.get()).toBeNull();
		expect(child.state.get()).toBeNull();
	});

	it("treats manual registry ownership as advanced usage that requires explicit dispose", async () => {
		const { clients, state } = createRegistryOptions("manual-at");
		const registry = createManualRegistry(clients);
		await registry.initialize("main");

		function Probe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const client = useReplaySignalValue(registry.clientSignalFor("main"));
			const snapshot = useReplaySignalValue(client.authSnapshot, {
				initialValue: null,
			});
			return createElement(
				"output",
				null,
				snapshot?.tokens.accessToken ?? "empty",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideTokenSetAuthRegistry(registry)] },
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("manual-at");
		view.unmount();
		expect(state.get()?.tokens.accessToken).toBe("manual-at");

		registry.dispose();
		expect(state.get()).toBeNull();
	});
});
