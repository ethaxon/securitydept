// @vitest-environment jsdom

import {
	appendOrReplaceCompatFragment,
	createSignal,
	OnceAsyncLockState,
	ResourceStatus,
	type RouterNavigationRequest,
	type RouterTrait,
	resourceFromSnapshots,
	SYMBOL_DISPOSE,
	UriReferenceString,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { SecuritydeptProvider } from "@securitydept/client-react";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { FrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	type BaseOidcModeClient,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	provideTokenSetClientRegistry,
	useTokenSetBackendCallbackController,
	useTokenSetFrontendCallbackController,
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

async function flushMicrotasks() {
	await act(async () => {
		await Promise.resolve();
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

function createBaseMockClient(): BaseOidcModeClient {
	const isAuthenticatedSnapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: false,
	} as const);
	const isAuthenticated = resourceFromSnapshots(() =>
		isAuthenticatedSnapshot.get(),
	);
	return {
		isAuthenticated,
		dispose: () => undefined,
		[SYMBOL_DISPOSE]: () => undefined,
	} as unknown as BaseOidcModeClient;
}

function createFrontendClient() {
	const client = {
		...createBaseMockClient(),
		handleCallback: vi.fn(async () => ({
			snapshot: createSnapshot("frontend-at"),
			postAuthRedirectUri: "/after-login",
		})),
	};
	Object.setPrototypeOf(client, FrontendOidcModeClient.prototype);
	return client as unknown as FrontendOidcModeClient & {
		handleCallback: ReturnType<typeof vi.fn>;
	};
}

function createBackendClient() {
	const client = {
		...createBaseMockClient(),
		handleCallback: vi.fn(async () => createSnapshot("backend-at")),
	};
	Object.setPrototypeOf(client, BackendOidcModeClient.prototype);
	return client as unknown as BackendOidcModeClient & {
		handleCallback: ReturnType<typeof vi.fn>;
	};
}

function createEntry(
	clientKey: string,
	client: BaseOidcModeClient,
	callbackPath?: string,
): TokenSetClientRegistryEntry<BaseOidcModeClient> {
	return {
		clientFactory: () => client,
		meta: {
			clientKey,
			urlPatterns: [],
			callbackPath,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Lazy,
		},
	};
}

describe("token-set React callback controller hooks", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("auto-handles a matching frontend callback URL", async () => {
		const client = createFrontendClient();
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
							clients: [createEntry("frontend", client, "/oidc/callback")],
						}),
					],
				},
				createElement(Probe),
			),
		);
		await flushMicrotasks();

		expect(client.handleCallback).toHaveBeenCalledWith(
			"https://app.example.com/oidc/callback?code=ok&state=s1",
		);
		expect(view.container.textContent).toBe(OnceAsyncLockState.Success);
		view.unmount();
	});

	it("keeps frontend callback idle for non-callback URLs", async () => {
		const client = createFrontendClient();
		const environment = createEnvironmentForTest();

		function Probe() {
			const callback = useTokenSetFrontendCallbackController({
				currentUrl: "https://app.example.com/dashboard",
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
							clients: [createEntry("frontend", client, "/oidc/callback")],
						}),
					],
				},
				createElement(Probe),
			),
		);
		await flushMicrotasks();

		expect(client.handleCallback).not.toHaveBeenCalled();
		expect(view.container.textContent).toBe(OnceAsyncLockState.Init);
		view.unmount();
	});

	it("reads backend compat fragments from the environment router and cleans them", async () => {
		const client = createBackendClient();
		const currentUrl = appendOrReplaceCompatFragment(
			UriReferenceString.parse("https://app.example.com/callback#hash"),
			{
				payload: {
					code: "ok",
					state: "s1",
				},
			},
			(input, hash) => input.setHash(hash),
		).url;
		const navigate = vi.fn(async (request: RouterNavigationRequest) => {
			current = request.url;
		});
		let current = currentUrl;
		const router: RouterTrait = {
			currentUrl: () => current,
			navigate,
		};
		const environment = createEnvironmentForTest({ router });

		function Probe() {
			const callback = useTokenSetBackendCallbackController({
				clientQuery: { clientKey: "backend" },
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
							clients: [createEntry("backend", client)],
						}),
					],
				},
				createElement(Probe),
			),
		);
		await flushMicrotasks();

		expect(client.handleCallback).toHaveBeenCalledWith({
			code: "ok",
			state: "s1",
		});
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(view.container.textContent).toBe(OnceAsyncLockState.Success);
		view.unmount();
	});
});
