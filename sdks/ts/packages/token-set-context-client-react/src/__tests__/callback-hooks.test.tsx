// @vitest-environment jsdom

import {
	type ResourceSnapshot,
	ResourceStatus,
	type RouterTrait,
	UriReferenceString,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { SecuritydeptProvider } from "@securitydept/client-react";
import { BackendOidcModeCompatFragmentKind } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { type FrontendOidcModeCallbackResult } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	type BaseOidcModeClient,
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	provideTokenSetClientRegistry,
	type TokenSetBackendCallbackClient,
	type TokenSetCallbackClientGuard,
	type TokenSetClientRegistryEntry,
	type TokenSetFrontendCallbackClient,
} from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetClientForTest,
	createTokenSetClientRegistryEntryForTest,
	TokenSetClientForTest,
} from "@securitydept/token-set-context-client/test";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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

type FrontendCallbackSnapshot = ResourceSnapshot<
	OidcModeCallbackHandlingResult<FrontendOidcModeCallbackResult>
>;

function createFrontendClient(
	callbackSnapshot: FrontendCallbackSnapshot = {
		status: ResourceStatus.Resolved,
		value: {
			kind: OidcModeCallbackHandlingKind.Handled,
			result: {
				snapshot: createSnapshot("frontend-at"),
				postAuthRedirectUri: "/after-login",
			},
		},
	},
): TokenSetClientForTest<FrontendOidcModeCallbackResult> {
	return createTokenSetClientForTest({ callbackSnapshot });
}

function createBackendClient(): TokenSetClientForTest<TokenSetAuthSnapshot> {
	return createTokenSetClientForTest({
		callbackSnapshot: {
			status: ResourceStatus.Resolved,
			value: {
				kind: OidcModeCallbackHandlingKind.Handled,
				result: createSnapshot("backend-at"),
			},
		},
	});
}

const frontendClientGuard: TokenSetCallbackClientGuard<
	TokenSetFrontendCallbackClient
> = (client): client is TokenSetFrontendCallbackClient =>
	client instanceof TokenSetClientForTest;

const backendClientGuard: TokenSetCallbackClientGuard<
	TokenSetBackendCallbackClient
> = (client): client is TokenSetBackendCallbackClient =>
	client instanceof TokenSetClientForTest;

function createEntry(
	clientKey: string,
	clientFactory: () => BaseOidcModeClient,
	callbackUrl?: string,
): TokenSetClientRegistryEntry<BaseOidcModeClient> {
	return createTokenSetClientRegistryEntryForTest({
		clientKey,
		clientFactory,
		callbackUrl,
	});
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
			providers: provideTokenSetClientRegistry({
				clients: [
					createEntry("frontend", frontendClientFactory, "/callback"),
					createEntry("backend", backendClientFactory),
				],
			}),
		});

		function Probe() {
			const frontend = useTokenSetFrontendCallback({
				clientGuard: frontendClientGuard,
			});
			const backend = useTokenSetBackendCallback({
				clientGuard: backendClientGuard,
			});
			return createElement(
				"output",
				null,
				`${frontend.state.status}:${backend.state.status}`,
			);
		}

		const html = renderToString(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
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
		const environment = createEnvironmentForTest({
			router,
			providers: provideTokenSetClientRegistry({
				clients: [createEntry("frontend", clientFactory, "/oidc/callback")],
			}),
		});

		function Probe() {
			const callback = useTokenSetFrontendCallback({
				clientGuard: frontendClientGuard,
			});
			return createElement("output", null, callback.state.status);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(Probe),
			),
		);
		await flushMicrotasks();

		expect(clientFactory).toHaveBeenCalledOnce();
		expect(router.navigate).not.toHaveBeenCalled();
		expect(view.container.textContent).toBe(ResourceStatus.Resolved);
		view.unmount();
	});

	it("tracks the selected client's callback snapshot without a Resource wrapper", async () => {
		const callbackSnapshot: FrontendCallbackSnapshot = {
			status: ResourceStatus.Loading,
		};
		const client = createFrontendClient(callbackSnapshot);
		const environment = createEnvironmentForTest({
			router: createRouter(
				"https://app.example.com/oidc/callback?code=ok&state=s1",
			),
			providers: provideTokenSetClientRegistry({
				clients: [createEntry("frontend", () => client, "/oidc/callback")],
			}),
		});

		function Probe() {
			const callback = useTokenSetFrontendCallback({
				clientGuard: frontendClientGuard,
			});
			return createElement("output", null, callback.state.status);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(Probe),
			),
		);
		await flushMicrotasks();
		expect(view.container.textContent).toBe(ResourceStatus.Loading);

		act(() => {
			client.setCallbackSnapshot({
				status: ResourceStatus.Resolved,
				value: {
					kind: OidcModeCallbackHandlingKind.Handled,
					result: {
						snapshot: createSnapshot("frontend-at"),
						postAuthRedirectUri: "/after-login",
					},
				},
			});
		});
		await flushMicrotasks();

		expect(view.container.textContent).toBe(ResourceStatus.Resolved);
		view.unmount();
	});

	it("resolves not-applicable outside a frontend callback path", async () => {
		const clientFactory = vi.fn(() => createFrontendClient());
		const environment = createEnvironmentForTest({
			router: createRouter("https://app.example.com/dashboard"),
			providers: provideTokenSetClientRegistry({
				clients: [createEntry("frontend", clientFactory, "/oidc/callback")],
			}),
		});

		function Probe() {
			const callback = useTokenSetFrontendCallback({
				clientGuard: frontendClientGuard,
			});
			const kind =
				callback.state.status === ResourceStatus.Resolved
					? callback.state.value.kind
					: "pending";
			return createElement("output", null, kind);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
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
			providers: provideTokenSetClientRegistry({
				clients: [createEntry("backend", clientFactory)],
			}),
		});

		function Probe() {
			const callback = useTokenSetBackendCallback({
				clientGuard: backendClientGuard,
			});
			return createElement("output", null, callback.state.status);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
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
			providers: provideTokenSetClientRegistry({
				clients: [createEntry("backend", clientFactory)],
			}),
		});
		const clientQuery = vi.fn(({ callbackUrl }) => {
			expect(callbackUrl.pathname).toBe("/custom-callback");
			return { clientKey: "backend" };
		});

		function Probe() {
			const callback = useTokenSetBackendCallback({
				clientQuery,
				clientGuard: backendClientGuard,
			});
			return createElement("output", null, callback.state.status);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
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
