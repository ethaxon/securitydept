// @vitest-environment jsdom

import { createInMemoryRecordStore } from "@securitydept/client";
import {
	act,
	createElement,
	type ReactElement,
	StrictMode,
	useEffect,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { TokenSetContextClient } from "../../client";
import {
	TokenSetContextProvider,
	type TokenSetContextProviderProps,
	useAccessToken,
	useTokenSetContext,
} from "../index";

function render(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	act(() => {
		root.render(element);
	});

	return {
		container,
		rerender(nextElement: ReactElement) {
			act(() => {
				root.render(nextElement);
			});
		},
		unmount() {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	};
}

async function flushMicrotasks() {
	await act(async () => {
		await Promise.resolve();
	});
}

describe("token-set react adapter", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("syncs signal updates into React and disposes the client on unmount", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const observedTokens: Array<string | null> = [];
		let exposedClient: TokenSetContextClient | null = null;

		function Probe() {
			const { client } = useTokenSetContext();
			const accessToken = useAccessToken();

			useEffect(() => {
				exposedClient = client;
				observedTokens.push(accessToken);
			}, [client, accessToken]);

			return createElement("output", null, accessToken ?? "empty");
		}

		const providerProps: TokenSetContextProviderProps = {
			config: { baseUrl: "https://auth.example.com" },
			transport: {
				async execute() {
					return {
						status: 500,
						headers: {},
						body: null,
					};
				},
			},
			scheduler: {
				setTimeout() {
					return {
						cancel() {},
					};
				},
			},
			clock: {
				now() {
					return Date.parse("2026-01-01T00:00:00Z");
				},
			},
			persistentStore: createInMemoryRecordStore(),
			sessionStore: createInMemoryRecordStore(),
			children: createElement(Probe),
		};

		const view = render(createElement(TokenSetContextProvider, providerProps));

		expect(view.container.textContent).toBe("empty");
		expect(observedTokens).toEqual([null]);
		expect(exposedClient).not.toBeNull();

		act(() => {
			exposedClient?.restoreState({
				tokens: {
					accessToken: "live-at",
					refreshMaterial: "live-rt",
				},
				metadata: {},
			});
		});

		expect(view.container.textContent).toBe("live-at");
		expect(observedTokens).toEqual([null, "live-at"]);

		if (!exposedClient) {
			throw new Error("Expected probe to expose a token-set client");
		}
		const client: TokenSetContextClient = exposedClient;

		view.unmount();
		await flushMicrotasks();

		expect(client.state.get()).toBeNull();
		expect(() =>
			client.restoreState({
				tokens: {
					accessToken: "after-unmount",
				},
				metadata: {},
			}),
		).toThrow(/cancel/i);
	});

	it("disposes the old client and isolates subscriptions after provider reconfigure", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const observedTokens: Array<string | null> = [];
		const exposedClients: TokenSetContextClient[] = [];

		function Probe() {
			const { client } = useTokenSetContext();
			const accessToken = useAccessToken();

			useEffect(() => {
				if (!exposedClients.includes(client)) {
					exposedClients.push(client);
				}
				observedTokens.push(accessToken);
			}, [client, accessToken]);

			return createElement("output", null, accessToken ?? "empty");
		}

		const firstStore = createInMemoryRecordStore();
		const secondStore = createInMemoryRecordStore();
		const firstProps: TokenSetContextProviderProps = {
			config: { baseUrl: "https://alpha.example.com" },
			transport: {
				async execute() {
					return {
						status: 500,
						headers: {},
						body: null,
					};
				},
			},
			scheduler: {
				setTimeout() {
					return {
						cancel() {},
					};
				},
			},
			clock: {
				now() {
					return Date.parse("2026-01-01T00:00:00Z");
				},
			},
			persistentStore: firstStore,
			sessionStore: firstStore,
			children: createElement(Probe),
		};

		const view = render(createElement(TokenSetContextProvider, firstProps));

		expect(view.container.textContent).toBe("empty");
		expect(observedTokens).toEqual([null]);
		expect(exposedClients).toHaveLength(1);

		const firstClient = exposedClients[0];
		act(() => {
			firstClient?.restoreState({
				tokens: {
					accessToken: "alpha-at",
					refreshMaterial: "alpha-rt",
				},
				metadata: {},
			});
		});

		expect(view.container.textContent).toBe("alpha-at");
		expect(observedTokens).toEqual([null, "alpha-at"]);

		const secondProps: TokenSetContextProviderProps = {
			...firstProps,
			config: { baseUrl: "https://beta.example.com" },
			persistentStore: secondStore,
			sessionStore: secondStore,
		};

		view.rerender(createElement(TokenSetContextProvider, secondProps));
		await flushMicrotasks();

		expect(exposedClients).toHaveLength(2);
		expect(view.container.textContent).toBe("empty");
		expect(observedTokens).toEqual([null, "alpha-at", null]);

		if (!firstClient) {
			throw new Error(
				"Expected the first provider lifecycle to expose a client",
			);
		}

		expect(firstClient.state.get()).toBeNull();
		expect(() =>
			firstClient.restoreState({
				tokens: {
					accessToken: "stale-at",
				},
				metadata: {},
			}),
		).toThrow(/cancel/i);
		expect(view.container.textContent).toBe("empty");

		const secondClient = exposedClients[1];
		if (!secondClient) {
			throw new Error("Expected the reconfigured provider to expose a client");
		}
		expect(secondClient).not.toBe(firstClient);

		act(() => {
			secondClient.restoreState({
				tokens: {
					accessToken: "beta-at",
					refreshMaterial: "beta-rt",
				},
				metadata: {},
			});
		});

		expect(view.container.textContent).toBe("beta-at");
		expect(observedTokens).toEqual([null, "alpha-at", null, "beta-at"]);

		view.unmount();
	});

	it("keeps the current client alive across StrictMode remounts without stale subscriptions", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const observedTokens: Array<string | null> = [];
		const exposedClients: TokenSetContextClient[] = [];

		function Probe() {
			const { client } = useTokenSetContext();
			const accessToken = useAccessToken();

			useEffect(() => {
				if (!exposedClients.includes(client)) {
					exposedClients.push(client);
				}
				observedTokens.push(accessToken);
			}, [client, accessToken]);

			return createElement("output", null, accessToken ?? "empty");
		}

		const providerProps: TokenSetContextProviderProps = {
			config: { baseUrl: "https://auth.example.com" },
			transport: {
				async execute() {
					return {
						status: 500,
						headers: {},
						body: null,
					};
				},
			},
			scheduler: {
				setTimeout() {
					return {
						cancel() {},
					};
				},
			},
			clock: {
				now() {
					return Date.parse("2026-01-01T00:00:00Z");
				},
			},
			persistentStore: createInMemoryRecordStore(),
			sessionStore: createInMemoryRecordStore(),
			children: createElement(Probe),
		};

		const strictProvider = (showProvider: boolean) =>
			createElement(
				StrictMode,
				null,
				showProvider
					? createElement(TokenSetContextProvider, providerProps)
					: null,
			);

		const view = render(strictProvider(true));

		expect(view.container.textContent).toBe("empty");
		expect(exposedClients.length).toBeGreaterThanOrEqual(1);
		expect(observedTokens.length).toBeGreaterThanOrEqual(2);
		expect(observedTokens.every((token) => token === null)).toBe(true);

		const firstClient = exposedClients[0];
		if (!firstClient) {
			throw new Error("Expected initial StrictMode render to expose a client");
		}

		view.rerender(strictProvider(false));
		await flushMicrotasks();

		expect(firstClient.state.get()).toBeNull();
		expect(() =>
			firstClient.restoreState({
				tokens: {
					accessToken: "stale-at",
				},
				metadata: {},
			}),
		).toThrow(/cancel/i);
		expect(view.container.textContent).toBe("");

		view.rerender(strictProvider(true));
		await flushMicrotasks();

		expect(observedTokens.every((token) => token === null)).toBe(true);
		expect(exposedClients.some((client) => client !== firstClient)).toBe(true);
		let activeClient: TokenSetContextClient | null = null;
		for (const candidate of exposedClients) {
			try {
				act(() => {
					candidate.restoreState({
						tokens: {
							accessToken: "live-at",
							refreshMaterial: "live-rt",
						},
						metadata: {},
					});
				});
				activeClient = candidate;
				break;
			} catch {}
		}

		if (!activeClient) {
			throw new Error(
				"Expected one StrictMode lifecycle client to remain active",
			);
		}
		expect(view.container.textContent).toBe("live-at");
		expect(observedTokens.at(-1)).toBe("live-at");

		for (const staleClient of exposedClients) {
			if (staleClient === activeClient) {
				continue;
			}
			expect(staleClient.state.get()).toBeNull();
			expect(() =>
				staleClient.restoreState({
					tokens: {
						accessToken: "stale-at",
					},
					metadata: {},
				}),
			).toThrow(/cancel/i);
		}

		view.unmount();
		await flushMicrotasks();

		expect(activeClient.state.get()).toBeNull();
		expect(() =>
			activeClient.restoreState({
				tokens: {
					accessToken: "after-unmount",
				},
				metadata: {},
			}),
		).toThrow(/cancel/i);
	});
});
