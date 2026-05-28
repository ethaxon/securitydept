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
	type TokenSetClientEntry,
	type TokenSetReactClient,
} from "@securitydept/token-set-context-client-react";
import { useTokenSetReadinessQuery } from "@securitydept/token-set-context-client-react/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
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

async function waitFor(predicate: () => boolean, attempts = 10) {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (predicate()) {
			return;
		}
		await act(async () => {
			await Promise.resolve();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
	throw new Error("Timed out waiting for query state to settle");
}

function createSnapshot(accessToken: string): AuthSnapshot {
	return {
		tokens: { accessToken },
		metadata: {},
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
): ClientRegistryEntry<TokenSetReactClient> {
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

describe("react-query integration evidence", () => {
	it("supports injector-based token-set readiness queries", async () => {
		const snapshot = createSnapshot("live-at");
		const reactive = createTestTokenSetReactiveFields(snapshot);
		const registry = createManualRegistry([
			{
				key: "main",
				clientFactory: () => ({
					state: createSignal<AuthSnapshot | null>(snapshot),
					...reactive.fields,
					authEvents: createEventSubject<TokenSetAuthEvent>(),
					addWorkflowSource: () => ({ unsubscribe: () => undefined }),
					removeWorkflowSource: () => false,
					start: async () => undefined,
					dispose: vi.fn(),
					[SYMBOL_DISPOSE]: vi.fn(),
					restorePersistedState: async () => snapshot,
					loginWithRedirect: async () => undefined,
					loginWithPopup: async () => ({ snapshot }),
				}),
			},
		]);
		await registry.initialize("main");
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const observed: Array<string> = [];

		function Probe() {
			const injector = useSecuritydeptContext();
			const readiness = useTokenSetReadinessQuery("main", { injector });

			useEffect(() => {
				observed.push(readiness.status);
			}, [readiness.status]);

			return createElement(
				"output",
				null,
				(() => {
					const slot = readiness.data?.authSnapshot.get();
					return slot?.kind === "value"
						? (slot.value?.tokens.accessToken ?? "loading")
						: "loading";
				})(),
			);
		}

		const view = render(
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(
					SecuritydeptProvider,
					{ providers: [provideTokenSetAuthRegistry(registry)] },
					createElement(Probe),
				),
			),
		);

		await waitFor(() => observed.at(-1) === "success");
		expect(view.container.textContent).toBe("live-at");

		view.unmount();
		registry.dispose();
		queryClient.clear();
	});

	it("supports registry-based token-set readiness queries without SecuritydeptProvider", async () => {
		const snapshot = createSnapshot("client-at");
		const reactive = createTestTokenSetReactiveFields(snapshot);
		const registry = createManualRegistry([
			{
				key: "main",
				clientFactory: () => ({
					state: createSignal<AuthSnapshot | null>(snapshot),
					...reactive.fields,
					authEvents: createEventSubject<TokenSetAuthEvent>(),
					addWorkflowSource: () => ({ unsubscribe: () => undefined }),
					removeWorkflowSource: () => false,
					start: async () => undefined,
					dispose: vi.fn(),
					[SYMBOL_DISPOSE]: vi.fn(),
					restorePersistedState: async () => snapshot,
					loginWithRedirect: async () => undefined,
					loginWithPopup: async () => ({ snapshot }),
				}),
			},
		]);
		await registry.initialize("main");
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const observed: Array<string> = [];

		function Probe() {
			const query = useTokenSetReadinessQuery("main", {
				registry,
			});
			useEffect(() => {
				observed.push(query.status);
			}, [query.status]);
			return createElement(
				"output",
				null,
				(() => {
					const slot = query.data?.authSnapshot.get();
					return slot?.kind === "value"
						? (slot.value?.tokens.accessToken ?? "loading")
						: "loading";
				})(),
			);
		}

		const view = render(
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(Probe),
			),
		);

		await waitFor(() => observed.at(-1) === "success");
		expect(view.container.textContent).toBe("client-at");
		view.unmount();
		registry.dispose();
		queryClient.clear();
	});
});
