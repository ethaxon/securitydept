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
	type TokenSetAuthEvent,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	createTokenSetClientRegistry,
	TokenSetClientInitializationMode,
	type TokenSetClientRegistryEntry,
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
import { describe, expect, it } from "vitest";
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

function createSnapshot(accessToken: string): TokenSetAuthSnapshot {
	return {
		tokens: { accessToken },
		metadata: {},
	};
}

function createClient(
	state: ReturnType<typeof createSignal<TokenSetAuthSnapshot | null>>,
) {
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
): TokenSetClientRegistryEntry<TokenSetReactClient> {
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

describe("react multi-client registry baseline", () => {
	it("surfaces multiple keyed clients through SecuritydeptProvider", async () => {
		const mainState = createSignal<TokenSetAuthSnapshot | null>(
			createSnapshot("main-at"),
		);
		const adminState = createSignal<TokenSetAuthSnapshot | null>(
			createSnapshot("admin-at"),
		);
		const registry = createManualRegistry([
			{
				key: "main",
				clientFactory: () => createClient(mainState),
			},
			{
				key: "admin",
				clientFactory: () => createClient(adminState),
			},
		]);
		await registry.initialize("main");
		await registry.initialize("admin");

		function Probe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const mainClient = useReplaySignalValue(registry.clientSignalFor("main"));
			const adminClient = useReplaySignalValue(
				registry.clientSignalFor("admin"),
			);
			return createElement(MultiClientProbe, {
				mainClient,
				adminClient,
			});
		}

		function MultiClientProbe({
			mainClient,
			adminClient,
		}: {
			mainClient: TokenSetReactClient;
			adminClient: TokenSetReactClient;
		}) {
			const main = useReplaySignalValue(mainClient.authSnapshot, {
				initialValue: null,
			});
			const admin = useReplaySignalValue(adminClient.authSnapshot, {
				initialValue: null,
			});
			return createElement(
				"output",
				null,
				`${main?.tokens.accessToken ?? "empty"}:${admin?.tokens.accessToken ?? "empty"}`,
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [provideTokenSetAuthRegistry(registry)] },
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("main-at:admin-at");
		view.unmount();
		registry.dispose();
	});

	it("re-renders when a keyed client signal changes", async () => {
		const mainState = createSignal<TokenSetAuthSnapshot | null>(
			createSnapshot("main-at"),
		);
		const registry = createManualRegistry([
			{
				key: "main",
				clientFactory: () => createClient(mainState),
			},
		]);
		await registry.initialize("main");

		function Probe() {
			const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
			const client = useReplaySignalValue(registry.clientSignalFor("main"));
			return createElement(SingleClientProbe, { client });
		}

		function SingleClientProbe({ client }: { client: TokenSetReactClient }) {
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

		act(() => {
			mainState.set(createSnapshot("updated-at"));
		});

		expect(view.container.textContent).toBe("updated-at");
		view.unmount();
		registry.dispose();
	});
});
