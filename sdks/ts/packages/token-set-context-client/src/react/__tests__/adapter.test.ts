// @vitest-environment jsdom

import { createInMemoryRecordStore } from "@securitydept/client";
import { act, createElement, type ReactElement, useEffect } from "react";
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
		unmount() {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	};
}

describe("token-set react adapter", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("syncs signal updates into React and disposes the client on unmount", () => {
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
});
