// @vitest-environment jsdom

import { createSignal, createSubject } from "@securitydept/client";
import {
	SecuritydeptProvider,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import {
	type AuthSnapshot,
	EnsureAuthForResourceStatus,
	TokenFreshnessState,
} from "@securitydept/token-set-context-client/orchestration";
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
				query.data?.accessToken.get() ?? "loading",
			);
		}

		const snapshot: AuthSnapshot = {
			tokens: { accessToken: "live-at" },
			metadata: {},
		};
		const providers = [
			provideTokenSetAuthRegistry({
				clients: [
					{
						key: "frontend",
						autoRestore: false,
						clientFactory: () => ({
							state: createSignal<AuthSnapshot | null>(snapshot),
							authEvents: createSubject(),
							dispose: vi.fn(),
							restorePersistedState: vi.fn(async () => snapshot),
							handleCallback: vi.fn(async () => ({ snapshot })),
							authorizationHeader: vi.fn(() => "Bearer live-at"),
							ensureAuthForResource: vi.fn(async () => ({
								status: EnsureAuthForResourceStatus.Authenticated,
								snapshot,
								freshness: TokenFreshnessState.Fresh,
								authorizationHeader: "Bearer live-at",
							})),
							ensureFreshAuthState: vi.fn(async () => snapshot),
							ensureAuthorizationHeader: vi.fn(async () => "Bearer live-at"),
							refresh: vi.fn(async () => snapshot),
							clearState: vi.fn(async () => {}),
							loginWithRedirect: vi.fn(async () => undefined),
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
