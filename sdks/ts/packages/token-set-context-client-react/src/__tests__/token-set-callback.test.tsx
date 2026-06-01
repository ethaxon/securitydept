// @vitest-environment jsdom

import {
	createEventSubject,
	createReplaySignal,
	createSignal,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import { FrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	type TokenSetAuthEvent,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	createTokenSetClientRegistry,
	TokenSetClientInitializationMode,
} from "@securitydept/token-set-context-client/registry";
import {
	CallbackResumeStatus,
	createTokenSetCallbackResumeController,
	TokenSetCallbackComponent,
	type TokenSetReactClient,
	useTokenSetCallbackResume,
} from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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
		await Promise.resolve();
	});
}

function createSnapshot(accessToken: string): TokenSetAuthSnapshot {
	return {
		tokens: {
			accessToken,
			accessTokenIssuedAt: new Date(Date.now() - 60_000).toISOString(),
			accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
		},
		metadata: {},
	};
}

function createControllerFixture() {
	const registry = createTokenSetClientRegistry<TokenSetReactClient>({
		environment: {},
	});
	const state = createSignal<TokenSetAuthSnapshot | null>(null);
	const authSnapshot = createReplaySignal<TokenSetAuthSnapshot | null>();
	const isAuthenticated = createReplaySignal<boolean>();
	const authorizationHeaderValue = createReplaySignal<string | undefined>();
	const authDetermined = createReplaySignal<true>();
	const lastAuthError = createSignal<unknown | undefined>(undefined);
	const dispose = vi.fn(() => undefined);
	const handleCallback = vi.fn(async () => {
		const snapshot = createSnapshot("callback-token");
		state.set(snapshot);
		authSnapshot.setValue(snapshot);
		isAuthenticated.setValue(true);
		authorizationHeaderValue.setValue("Bearer callback-token");
		authDetermined.setValue(true);
		lastAuthError.set(undefined);
		return {
			snapshot,
			postAuthRedirectUri: "/after-login",
		};
	});

	const client = {
		state,
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
		authEvents: createEventSubject<TokenSetAuthEvent>(),
		addWorkflowSource: vi.fn(() => ({ unsubscribe: vi.fn() })),
		removeWorkflowSource: vi.fn(() => false),
		start: vi.fn(async () => undefined),
		dispose,
		[SYMBOL_DISPOSE]: dispose,
		restorePersistedState: vi.fn(async () => null),
		handleCallback,
		loginWithRedirect: vi.fn(async () => undefined),
		logout: async () => undefined,
		loginWithPopup: vi.fn(async () => ({
			snapshot: createSnapshot("popup-at"),
		})),
	};
	Object.setPrototypeOf(client, FrontendOidcModeClient.prototype);

	registry.register({
		clientFactory: () => client as TokenSetReactClient,
		meta: {
			clientKey: "frontend",
			urlPatterns: [],
			callbackPath: "/oidc/callback",
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Immediate,
		},
	});

	return {
		controller: createTokenSetCallbackResumeController(registry),
		handleCallback,
		cleanup() {
			registry.dispose();
		},
	};
}

describe("token-set callback headless surface", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("resumes callback state without React Context when given an explicit controller", async () => {
		const fixture = createControllerFixture();
		const states: string[] = [];

		function Probe() {
			const state = useTokenSetCallbackResume({
				controller: fixture.controller,
				getCurrentUrl: () => "http://localhost/oidc/callback?code=ok&state=s1",
			});
			useEffect(() => {
				states.push(state.state);
			}, [state.state]);
			return createElement("div", null, state.state);
		}

		const view = render(createElement(Probe));
		await flushMicrotasks();

		expect(view.container.textContent).toBe(CallbackResumeStatus.Resolved);
		expect(fixture.handleCallback).toHaveBeenCalledTimes(1);
		expect(states).toContain(CallbackResumeStatus.Pending);
		expect(states.at(-1)).toBe(CallbackResumeStatus.Resolved);

		view.unmount();
		fixture.cleanup();
	});

	it("keeps the React state binding alive after reset", async () => {
		const fixture = createControllerFixture();
		const states: string[] = [];
		let currentUrl: string | null =
			"http://localhost/oidc/callback?code=ok&state=s1";

		function Probe() {
			const state = useTokenSetCallbackResume({
				controller: fixture.controller,
				getCurrentUrl: () => currentUrl,
			});
			useEffect(() => {
				states.push(state.state);
			}, [state.state]);
			return createElement("div", null, state.state);
		}

		const view = render(createElement(Probe));
		await flushMicrotasks();

		expect(view.container.textContent).toBe(CallbackResumeStatus.Resolved);

		currentUrl = null;
		view.rerender(createElement(Probe));
		await flushMicrotasks();

		expect(view.container.textContent).toBe(CallbackResumeStatus.Idle);

		currentUrl = "http://localhost/oidc/callback?code=again&state=s2";
		view.rerender(createElement(Probe));
		await flushMicrotasks();

		expect(view.container.textContent).toBe(CallbackResumeStatus.Resolved);
		expect(fixture.handleCallback).toHaveBeenCalledTimes(2);
		expect(states).toEqual(
			expect.arrayContaining([
				CallbackResumeStatus.Pending,
				CallbackResumeStatus.Resolved,
				CallbackResumeStatus.Idle,
			]),
		);

		view.unmount();
		fixture.cleanup();
	});

	it("renders the callback component from an explicit controller without Context", async () => {
		const fixture = createControllerFixture();
		const onResolved = vi.fn();

		const view = render(
			createElement(TokenSetCallbackComponent, {
				controller: fixture.controller,
				getCurrentUrl: () => "http://localhost/oidc/callback?code=ok&state=s1",
				onResolved,
				pending: createElement("span", null, "pending"),
				fallback: createElement("span", null, "fallback"),
			}),
		);

		await flushMicrotasks();

		expect(fixture.handleCallback).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledWith({
			clientKey: "frontend",
			postAuthRedirectUri: "/after-login",
		});
		expect(view.container.textContent).toBe("");

		view.unmount();
		fixture.cleanup();
	});
});
