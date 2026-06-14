// @vitest-environment jsdom

import {
	createEventSubject,
	createSignal,
	ResourceStatus,
	type RouterNavigationRequest,
	type RouterTrait,
	resourceFromSnapshots,
	SYMBOL_DISPOSE,
	UriReferenceString,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { SecuritydeptProvider } from "@securitydept/client-react";
import {
	type FrontendOidcModeCallbackResult,
	FrontendOidcModeClient,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	type BaseOidcModeClient,
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
	type TokenSetAuthEvent,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";
import {
	provideTokenSetClientRegistry,
	useTokenSetFrontendCallback,
} from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
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
	const callbackSnapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: {
			kind: OidcModeCallbackHandlingKind.Handled,
			result: {
				snapshot: createSnapshot("callback-at"),
				postAuthRedirectUri: "/after-login",
			},
		},
	} as const);
	const callbackResource = resourceFromSnapshots<
		OidcModeCallbackHandlingResult<FrontendOidcModeCallbackResult>
	>(() => callbackSnapshot.get());
	const client = {
		state,
		...reactive.fields,
		callback: {
			state: callbackSnapshot,
			resource: callbackResource,
			cancel: () => undefined,
		},
		authEvents: createEventSubject<TokenSetAuthEvent>(),
		addWorkflowSource: () => ({ unsubscribe: () => undefined }),
		removeWorkflowSource: () => false,
		start: async () => undefined,
		dispose: () => {
			callbackResource.dispose();
			state.set(null);
			reactive.emitSnapshot(null);
		},
		[SYMBOL_DISPOSE]: () => {
			callbackResource.dispose();
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
			callbackUrl: "/oidc/callback",
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Lazy,
		},
	};
}

function createRouter(url: string): RouterTrait {
	let currentUrl = UriReferenceString.parse(url);
	return {
		currentUrl: () => currentUrl,
		navigate: async (request: RouterNavigationRequest) => {
			currentUrl = request.url;
		},
	};
}

describe("react callback async readiness", () => {
	it("resumes callback through the frontend callback hook", async () => {
		const environment = createEnvironmentForTest({
			router: createRouter(
				"https://app.example.com/oidc/callback?code=ok&state=s1",
			),
			providers: provideTokenSetClientRegistry({ clients: [createEntry()] }),
		});

		function Probe() {
			const callback = useTokenSetFrontendCallback();
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

		expect(view.container.textContent).toBe(ResourceStatus.Resolved);
		view.unmount();
	});

	it("resolves without auth when no client matches the current URL", async () => {
		const environment = createEnvironmentForTest({
			router: createRouter("https://app.example.com/not-a-callback"),
			providers: provideTokenSetClientRegistry({ clients: [createEntry()] }),
		});

		function Probe() {
			const callback = useTokenSetFrontendCallback();
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

		expect(view.container.textContent).toBe(ResourceStatus.Resolved);
		view.unmount();
	});
});
