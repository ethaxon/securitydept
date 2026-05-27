// @vitest-environment jsdom

import {
	createEventSubject,
	createFoundationEnvironment,
	createReplaySignal,
	createSignal,
} from "@securitydept/client";
import {
	type AuthSnapshot,
	type TokenSetAuthEvent,
} from "@securitydept/token-set-context-client/orchestration";
import {
	createTokenSetOidcAuthRegistry,
	TokenSetCallbackResumeController,
} from "@securitydept/token-set-context-client/registry";
import {
	CallbackResumeStatus,
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

function createSnapshot(accessToken: string): AuthSnapshot {
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
	const environment = createFoundationEnvironment({
		transport: { execute: async () => ({ status: 204, headers: {} }) },
		time: {
			now: () => Date.now(),
			setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
			clearTimeout: (handle) =>
				clearTimeout(handle as ReturnType<typeof setTimeout>),
		},
		idleCallback: {
			requestIdleCallback: (callback) => setTimeout(callback, 0),
			cancelIdleCallback: (handle) =>
				clearTimeout(handle as ReturnType<typeof setTimeout>),
		},
	});
	const registry = createTokenSetOidcAuthRegistry<TokenSetReactClient>({
		environment,
	});
	const state = createSignal<AuthSnapshot | null>(null);
	const authSnapshot = createReplaySignal<AuthSnapshot | null>();
	const isAuthenticated = createReplaySignal<boolean>();
	const authorizationHeaderValue = createReplaySignal<string | undefined>();
	const authDetermined = createReplaySignal<true>();
	const lastAuthError = createSignal<unknown | undefined>(undefined);
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

	registry.register({
		key: "frontend",
		callbackPath: "/oidc/callback",
		clientFactory: () => ({
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
			dispose: vi.fn(() => undefined),
			restorePersistedState: vi.fn(async () => null),
			handleCallback,
			loginWithRedirect: vi.fn(async () => undefined),
		}),
	});

	return {
		controller: new TokenSetCallbackResumeController({
			registry,
			getCallbackClient: (client) => client,
		}),
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
				states.push(state.status);
			}, [state.status]);
			return createElement("div", null, state.status);
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
