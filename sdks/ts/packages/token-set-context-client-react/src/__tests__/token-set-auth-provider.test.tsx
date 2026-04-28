// @vitest-environment jsdom

import {
	ClientError,
	ClientErrorKind,
	createSignal,
	UserRecovery,
} from "@securitydept/client";
import { FrontendOidcModeCallbackErrorCode } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetAuthProvider,
	TokenSetCallbackComponent,
	useTokenSetCallbackResume,
} from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

function CallbackResumeProbe(props: {
	onState: (state: ReturnType<typeof useTokenSetCallbackResume>) => void;
}) {
	const state = useTokenSetCallbackResume();
	props.onState(state);
	return null;
}

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

describe("TokenSetAuthProvider callback resume", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		window.history.replaceState({}, "", "/");
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("resumes the same callback URL only once across StrictMode remounts", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		window.history.replaceState(
			{},
			"",
			"/auth/token-set/frontend-mode/callback?code=auth-code&state=state-1",
		);

		const state = createSignal<AuthSnapshot | null>(null);
		const handleCallback = vi.fn(async () => {
			const snapshot: AuthSnapshot = {
				tokens: {
					accessToken: "live-at",
				},
				metadata: {},
			};
			state.set(snapshot);
			return {
				snapshot,
				postAuthRedirectUri: "/playground/token-set/frontend-mode",
			};
		});
		const onResolved = vi.fn();

		const view = render(
			createElement(
				StrictMode,
				null,
				createElement(
					TokenSetAuthProvider,
					{
						idleWarmup: false,
						clients: [
							{
								key: "frontend",
								callbackPath: "/auth/token-set/frontend-mode/callback",
								clientFactory: () => ({
									state,
									dispose: vi.fn(),
									restorePersistedState: vi.fn(async () => null),
									handleCallback,
									authorizeUrl: vi.fn(() => "/authorize"),
									authorizationHeader: vi.fn(() => null),
									ensureFreshAuthState: vi.fn(async () => state.get()),
									ensureAuthorizationHeader: vi.fn(async () => null),
									refresh: vi.fn(async () => null),
									clearState: vi.fn(async () => {}),
								}),
							},
						],
					},
					createElement(TokenSetCallbackComponent, {
						onResolved,
						pending: createElement("span", null, "pending"),
						fallback: createElement("span", null, "fallback"),
					}),
				),
			),
		);

		await flushMicrotasks();

		expect(handleCallback).toHaveBeenCalledTimes(1);
		expect(handleCallback).toHaveBeenCalledWith(
			"http://localhost:3000/auth/token-set/frontend-mode/callback?code=auth-code&state=state-1",
		);
		expect(onResolved).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledWith({
			clientKey: "frontend",
			postAuthRedirectUri: "/playground/token-set/frontend-mode",
		});

		view.unmount();
	});

	it("exposes structured callback error details for host rendering", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		window.history.replaceState(
			{},
			"",
			"/auth/token-set/frontend-mode/callback?code=auth-code&state=state-1",
		);

		const onState = vi.fn();
		const callbackError = new ClientError({
			kind: ClientErrorKind.Protocol,
			message: "Pending authorization state expired before callback",
			code: FrontendOidcModeCallbackErrorCode.PendingStale,
			recovery: UserRecovery.RestartFlow,
			source: "frontend-oidc-mode",
		});

		const view = render(
			createElement(
				TokenSetAuthProvider,
				{
					idleWarmup: false,
					clients: [
						{
							key: "frontend",
							callbackPath: "/auth/token-set/frontend-mode/callback",
							clientFactory: () => ({
								state: createSignal<AuthSnapshot | null>(null),
								dispose: vi.fn(),
								restorePersistedState: vi.fn(async () => null),
								handleCallback: vi.fn(async () => {
									throw callbackError;
								}),
								authorizeUrl: vi.fn(() => "/authorize"),
								authorizationHeader: vi.fn(() => null),
								ensureFreshAuthState: vi.fn(async () => null),
								ensureAuthorizationHeader: vi.fn(async () => null),
								refresh: vi.fn(async () => null),
								clearState: vi.fn(async () => {}),
							}),
						},
					],
				},
				createElement(CallbackResumeProbe, { onState }),
			),
		);

		await flushMicrotasks();

		const latestState = onState.mock.calls.at(-1)?.[0];
		expect(latestState).toMatchObject({
			clientKey: "frontend",
			status: "error",
			error: callbackError,
			errorDetails: {
				code: FrontendOidcModeCallbackErrorCode.PendingStale,
				kind: ClientErrorKind.Protocol,
				message: "Pending authorization state expired before callback",
				recovery: UserRecovery.RestartFlow,
				retryable: false,
				source: "frontend-oidc-mode",
				presentation: {
					code: FrontendOidcModeCallbackErrorCode.PendingStale,
					title: "Callback state expired",
					recovery: UserRecovery.RestartFlow,
				},
				cause: callbackError,
			},
		});

		view.unmount();
	});
});
