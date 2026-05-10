// @vitest-environment jsdom

import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from "@securitydept/client";
import { createSignal, createSubject } from "@securitydept/client";
import {
	type AuthSnapshot,
	EnsureAuthForResourceStatus,
	TokenFreshnessState,
} from "@securitydept/token-set-context-client/orchestration";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTokenSetGroupsQuery } from "../react-query/index";
import { TokenSetAuthProvider } from "../token-set-auth-provider";

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

	it("uses requestOptions.transport while preserving authorization from the token-set client", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const requests: HttpRequest[] = [];
		const transport: HttpTransport = {
			async execute(request: HttpRequest): Promise<HttpResponse> {
				requests.push(request);
				return {
					status: 200,
					headers: {},
					body: [{ id: "group-1", name: "Admins" }],
				};
			},
		};
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
			},
		});
		const observed: Array<{
			status: string;
			data: Array<{ id: string; name: string }> | undefined;
		}> = [];

		function Probe() {
			const query = useTokenSetGroupsQuery({
				clientKey: "frontend",
				requestOptions: {
					baseUrl: "https://api.example.com",
					transport,
				},
			});

			useEffect(() => {
				observed.push({
					status: query.status,
					data: query.data,
				});
			}, [query.status, query.data]);

			return null;
		}

		const snapshot: AuthSnapshot = {
			tokens: { accessToken: "live-at" },
			metadata: {},
		};

		const view = render(
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(
					TokenSetAuthProvider,
					{
						idleWarmup: false,
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
									authorizeUrl: vi.fn(() => "/authorize"),
									authorizationHeader: vi.fn(() => "Bearer live-at"),
									ensureAuthForResource: vi.fn(async () => ({
										status: EnsureAuthForResourceStatus.Authenticated,
										snapshot,
										freshness: TokenFreshnessState.Fresh,
										authorizationHeader: "Bearer live-at",
									})),
									ensureFreshAuthState: vi.fn(async () => snapshot),
									ensureAuthorizationHeader: vi.fn(
										async () => "Bearer live-at",
									),
									refresh: vi.fn(async () => snapshot),
									clearState: vi.fn(async () => {}),
									loginWithRedirect: vi.fn(async () => undefined),
								}),
							},
						],
					},
					createElement(Probe),
				),
			),
		);

		await waitFor(() => observed.at(-1)?.status === "success");

		expect(requests).toHaveLength(1);
		expect(requests[0]).toEqual(
			expect.objectContaining({
				url: "https://api.example.com/api/groups",
				headers: expect.objectContaining({
					authorization: "Bearer live-at",
				}),
			}),
		);
		expect(observed.at(-1)).toEqual({
			status: "success",
			data: [{ id: "group-1", name: "Admins" }],
		});

		view.unmount();
		queryClient.clear();
	});
});
