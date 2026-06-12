// @vitest-environment jsdom

import {
	createSignal,
	ResourceStatus,
	type RouterTrait,
	resourceFromSnapshots,
	SYMBOL_DISPOSE,
	UriReferenceString,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { SecuritydeptProvider } from "@securitydept/client-react";
import {
	BackendOidcModeClient,
	BackendOidcModeCompatFragmentKind,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	type FrontendOidcModeCallbackResult,
	FrontendOidcModeClient,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	type BaseOidcModeClient,
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	provideTokenSetClientRegistry,
	useTokenSetBackendCallback,
	useTokenSetFrontendCallback,
} from "../index";

function render(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => root.render(element));
	return {
		container,
		unmount() {
			act(() => root.unmount());
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
	return { tokens: { accessToken }, metadata: {} };
}

function createFrontendClient(): FrontendOidcModeClient {
	const callbackSnapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: {
			kind: OidcModeCallbackHandlingKind.Handled,
			result: {
				snapshot: createSnapshot("frontend-at"),
				postAuthRedirectUri: "/after-login",
			},
		},
	} as const);
	const callbackResource = resourceFromSnapshots<
		OidcModeCallbackHandlingResult<FrontendOidcModeCallbackResult>
	>(() => callbackSnapshot.get());
	const dispose = vi.fn(() => callbackResource.dispose());
	const client = {
		callback: {
			state: callbackSnapshot,
			resource: callbackResource,
			cancel: vi.fn(),
		},
		dispose,
		[SYMBOL_DISPOSE]: dispose,
	} as unknown as FrontendOidcModeClient;
	Object.setPrototypeOf(client, FrontendOidcModeClient.prototype);
	return client;
}

function createBackendClient(): BackendOidcModeClient {
	const callbackSnapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: {
			kind: OidcModeCallbackHandlingKind.Handled,
			result: createSnapshot("backend-at"),
		},
	} as const);
	const callbackResource = resourceFromSnapshots<
		OidcModeCallbackHandlingResult<TokenSetAuthSnapshot>
	>(() => callbackSnapshot.get());
	const dispose = vi.fn(() => callbackResource.dispose());
	const client = {
		callback: {
			state: callbackSnapshot,
			resource: callbackResource,
			cancel: vi.fn(),
		},
		dispose,
		[SYMBOL_DISPOSE]: dispose,
	} as unknown as BackendOidcModeClient;
	Object.setPrototypeOf(client, BackendOidcModeClient.prototype);
	return client;
}

function createEntry(
	clientKey: string,
	clientFactory: () => BaseOidcModeClient,
	callbackUrl?: string,
): TokenSetClientRegistryEntry<BaseOidcModeClient> {
	return {
		clientFactory,
		meta: {
			clientKey,
			urlPatterns: [],
			callbackUrl,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Lazy,
		},
	};
}

function createRouter(url: string): RouterTrait {
	return {
		currentUrl: () => UriReferenceString.parse(url),
		navigate: vi.fn(),
	};
}

describe("token-set React callback hooks", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("keeps callback selection idle during server rendering", () => {
		const frontendClientFactory = vi.fn(() => createFrontendClient());
		const backendClientFactory = vi.fn(() => createBackendClient());
		const currentUrl = vi.fn(() =>
			UriReferenceString.parse(
				`https://app.example.com/callback#securitydept=v1&kind=${BackendOidcModeCompatFragmentKind.Callback}&callback_routing_key=backend&access_token=at`,
			),
		);
		const environment = createEnvironmentForTest({
			router: { currentUrl, navigate: vi.fn() },
		});

		function Probe() {
			const frontend = useTokenSetFrontendCallback();
			const backend = useTokenSetBackendCallback();
			return createElement(
				"output",
				null,
				`${frontend.state.status}:${backend.state.status}`,
			);
		}

		const html = renderToString(
			createElement(
				SecuritydeptProvider,
				{
					parentInjector: environment.injector,
					providers: provideTokenSetClientRegistry({
						clients: [
							createEntry("frontend", frontendClientFactory, "/callback"),
							createEntry("backend", backendClientFactory),
						],
					}),
				},
				createElement(Probe),
			),
		);

		expect(html).toContain(`${ResourceStatus.Idle}:${ResourceStatus.Idle}`);
		expect(currentUrl).not.toHaveBeenCalled();
		expect(frontendClientFactory).not.toHaveBeenCalled();
		expect(backendClientFactory).not.toHaveBeenCalled();
	});

	it("initializes the selected frontend record without consuming callback input", async () => {
		const client = createFrontendClient();
		const clientFactory = vi.fn(() => client);
		const router = createRouter(
			"https://app.example.com/oidc/callback?code=ok&state=s1",
		);
		const environment = createEnvironmentForTest({ router });

		function Probe() {
			const callback = useTokenSetFrontendCallback();
			return createElement("output", null, callback.state.status);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					parentInjector: environment.injector,
					providers: provideTokenSetClientRegistry({
						clients: [createEntry("frontend", clientFactory, "/oidc/callback")],
					}),
				},
				createElement(Probe),
			),
		);
		await flushMicrotasks();

		expect(clientFactory).toHaveBeenCalledOnce();
		expect(router.navigate).not.toHaveBeenCalled();
		expect(view.container.textContent).toBe(ResourceStatus.Resolved);
		view.unmount();
	});

	it("resolves not-applicable outside a frontend callback path", async () => {
		const clientFactory = vi.fn(() => createFrontendClient());
		const environment = createEnvironmentForTest({
			router: createRouter("https://app.example.com/dashboard"),
		});

		function Probe() {
			const callback = useTokenSetFrontendCallback();
			const kind =
				callback.state.status === ResourceStatus.Resolved
					? callback.state.value.kind
					: "pending";
			return createElement("output", null, kind);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					parentInjector: environment.injector,
					providers: provideTokenSetClientRegistry({
						clients: [createEntry("frontend", clientFactory, "/oidc/callback")],
					}),
				},
				createElement(Probe),
			),
		);
		await flushMicrotasks();

		expect(clientFactory).not.toHaveBeenCalled();
		expect(view.container.textContent).toBe(
			OidcModeCallbackHandlingKind.NotApplicable,
		);
		view.unmount();
	});

	it("selects a backend record from callback_routing_key", async () => {
		const client = createBackendClient();
		const clientFactory = vi.fn(() => client);
		const environment = createEnvironmentForTest({
			router: createRouter(
				`https://app.example.com/callback#securitydept=v1&kind=${BackendOidcModeCompatFragmentKind.Callback}&callback_routing_key=backend&access_token=at`,
			),
		});

		function Probe() {
			const callback = useTokenSetBackendCallback();
			return createElement("output", null, callback.state.status);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					parentInjector: environment.injector,
					providers: provideTokenSetClientRegistry({
						clients: [createEntry("backend", clientFactory)],
					}),
				},
				createElement(Probe),
			),
		);
		await flushMicrotasks();

		expect(clientFactory).toHaveBeenCalledOnce();
		expect(view.container.textContent).toBe(ResourceStatus.Resolved);
		view.unmount();
	});

	it("forwards a custom backend callback client query", async () => {
		const client = createBackendClient();
		const clientFactory = vi.fn(() => client);
		const environment = createEnvironmentForTest({
			router: createRouter("https://app.example.com/custom-callback"),
		});
		const clientQuery = vi.fn(({ callbackUrl }) => {
			expect(callbackUrl.pathname).toBe("/custom-callback");
			return { clientKey: "backend" };
		});

		function Probe() {
			const callback = useTokenSetBackendCallback({ clientQuery });
			return createElement("output", null, callback.state.status);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					parentInjector: environment.injector,
					providers: provideTokenSetClientRegistry({
						clients: [createEntry("backend", clientFactory)],
					}),
				},
				createElement(Probe),
			),
		);
		await flushMicrotasks();

		expect(clientQuery).toHaveBeenCalled();
		expect(clientFactory).toHaveBeenCalledOnce();
		expect(view.container.textContent).toBe(ResourceStatus.Resolved);
		view.unmount();
	});
});
