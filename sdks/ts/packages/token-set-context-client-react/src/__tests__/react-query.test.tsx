// @vitest-environment jsdom

import {
	createEventSubject,
	createReplaySignal,
	createSignal,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import {
	SecuritydeptProvider,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { type TokenSetAuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { provideTokenSetAuthRegistry } from "../index";
import {
	invalidateTokenSetQueriesForClient,
	tokenSetQueryKeys,
	useTokenSetReadinessQuery,
} from "../react-query/index";

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

describe("token-set react-query helpers", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("resolves readiness through SecuritydeptProvider", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
			},
		});
		const observed: string[] = [];

		function Probe() {
			const injector = useSecuritydeptContext();
			const query = useTokenSetReadinessQuery("frontend", { injector });

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

		const snapshot: TokenSetAuthSnapshot = {
			tokens: { accessToken: "live-at" },
			metadata: {},
		};
		const authSnapshot = createReplaySignal<TokenSetAuthSnapshot | null>();
		authSnapshot.setValue(snapshot);
		const isAuthenticated = createReplaySignal<boolean>();
		isAuthenticated.setValue(true);
		const authorizationHeaderValue = createReplaySignal<string | undefined>();
		authorizationHeaderValue.setValue("Bearer live-at");
		const authDetermined = createReplaySignal<true>();
		authDetermined.setValue(true);
		const lastAuthError = createSignal<unknown | undefined>(undefined);
		const dispose = vi.fn();
		const providers = [
			provideTokenSetAuthRegistry({
				clients: [
					{
						key: "frontend",
						clientFactory: () => ({
							state: createSignal<TokenSetAuthSnapshot | null>(snapshot),
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
							authEvents: createEventSubject(),
							addWorkflowSource: vi.fn(() => ({
								unsubscribe: vi.fn(),
							})),
							removeWorkflowSource: vi.fn(() => false),
							start: vi.fn(async () => undefined),
							dispose,
							[SYMBOL_DISPOSE]: dispose,
							restorePersistedState: vi.fn(async () => snapshot),
							handleCallback: vi.fn(async () => ({ snapshot })),
							refresh: vi.fn(async () => snapshot),
							clearState: vi.fn(async () => {}),
							loginWithRedirect: vi.fn(async () => undefined),
							logout: async () => undefined,
							loginWithPopup: vi.fn(async () => ({ snapshot })),
						}),
					},
				],
			}),
		];

		const view = render(
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(
					SecuritydeptProvider,
					{ providers },
					createElement(Probe),
				),
			),
		);

		await waitFor(() => observed.at(-1) === "success");
		expect(view.container.textContent).toBe("live-at");

		await act(async () => {
			view.unmount();
			await Promise.resolve();
		});
		queryClient.clear();
	});

	it("invalidates the full token-set client namespace", async () => {
		const queryClient = new QueryClient();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

		await invalidateTokenSetQueriesForClient(queryClient, "frontend");

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: tokenSetQueryKeys.forClient("frontend"),
		});
	});
});
