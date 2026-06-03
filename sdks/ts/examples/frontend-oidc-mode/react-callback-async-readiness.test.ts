// @vitest-environment jsdom

import {
	createEventSubject,
	createSignal,
	OnceAsyncLockState,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import { SecuritydeptProvider } from "@securitydept/client-react";
import { FrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	type BaseOidcModeClient,
	type TokenSetAuthEvent,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";
import {
	provideTokenSetClientRegistry,
	useTokenSetFrontendCallbackController,
} from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createEnvironmentForTest } from "../../packages/client/src/test";
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

async function flushMicrotasks() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

function createSnapshot(accessToken: string): TokenSetAuthSnapshot {
	return {
		tokens: { accessToken },
		metadata: {},
	};
}

function createFrontendClient(): FrontendOidcModeClient {
	const state = createSignal<TokenSetAuthSnapshot | null>(null);
	const reactive = createTestTokenSetReactiveFields(null);
	const client = {
		state,
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
		handleCallback: async () => {
			const snapshot = createSnapshot("callback-at");
			state.set(snapshot);
			reactive.emitSnapshot(snapshot);
			return { snapshot, postAuthRedirectUri: "/after-login" };
		},
		loginWithRedirect: async () => undefined,
		logout: async () => undefined,
		loginWithPopup: async () => ({
			snapshot: state.get() ?? createSnapshot("popup-at"),
		}),
	};
	Object.setPrototypeOf(client, FrontendOidcModeClient.prototype);
	return client as unknown as FrontendOidcModeClient;
}

function createEntry(): TokenSetClientRegistryEntry<BaseOidcModeClient> {
	return {
		clientFactory: async () => createFrontendClient(),
		meta: {
			clientKey: "frontend",
			urlPatterns: [],
			callbackPath: "/oidc/callback",
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Lazy,
		},
	};
}

describe("react callback async readiness", () => {
	it("resumes callback through the frontend callback hook", async () => {
		const environment = createEnvironmentForTest();

		function Probe() {
			const callback = useTokenSetFrontendCallbackController({
				currentUrl: "https://app.example.com/oidc/callback?code=ok&state=s1",
			});
			return createElement("output", null, callback.state.state);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					parentInjector: environment.injector,
					providers: [
						...provideTokenSetClientRegistry({
							clients: [createEntry()],
						}),
					],
				},
				createElement(Probe),
			),
		);

		await flushMicrotasks();

		expect(view.container.textContent).toBe(OnceAsyncLockState.Success);
		view.unmount();
	});

	it("stays idle when the current URL is not a callback", async () => {
		const environment = createEnvironmentForTest();

		function Probe() {
			const callback = useTokenSetFrontendCallbackController({
				currentUrl: "https://app.example.com/not-a-callback",
			});
			return createElement("output", null, callback.state.state);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					parentInjector: environment.injector,
					providers: [
						...provideTokenSetClientRegistry({
							clients: [createEntry()],
						}),
					],
				},
				createElement(Probe),
			),
		);

		await flushMicrotasks();

		expect(view.container.textContent).toBe(OnceAsyncLockState.Init);
		view.unmount();
	});
});
