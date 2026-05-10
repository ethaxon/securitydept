// @vitest-environment jsdom

import {
	ClientError,
	ClientErrorKind,
	createSignal,
	createSubject,
	type ErrorPresentationDescriptor,
	UserRecovery,
} from "@securitydept/client";
import { FrontendOidcModeCallbackErrorCode } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	type AuthSnapshot,
	EnsureAuthForResourceStatus,
	TokenSetAuthFlowReason,
} from "@securitydept/token-set-context-client/orchestration";
import type { TokenSetCallbackErrorPresentationContext } from "@securitydept/token-set-context-client/registry";
import {
	TokenSetAuthProvider,
	TokenSetCallbackComponent,
	useTokenSetAuthService,
	useTokenSetCallbackResume,
} from "@securitydept/token-set-context-client-react";
import {
	act,
	createElement,
	type ReactElement,
	StrictMode,
	useEffect,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

function CallbackResumeProbe(props: {
	onState: (state: ReturnType<typeof useTokenSetCallbackResume>) => void;
	getCurrentUrl?: () => string | undefined;
	describeError?: (
		context: TokenSetCallbackErrorPresentationContext,
	) => ErrorPresentationDescriptor;
}) {
	const state = useTokenSetCallbackResume({
		getCurrentUrl: props.getCurrentUrl,
		describeError: props.describeError,
	});
	props.onState(state);
	return null;
}

function AuthServiceProbe(props: {
	clientKey: string;
	onService: (service: ReturnType<typeof useTokenSetAuthService>) => void;
}) {
	const service = useTokenSetAuthService(props.clientKey);

	useEffect(() => {
		props.onService(service);
	}, [service, props]);

	return createElement("output", null, service.accessToken() ?? "empty");
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
									authEvents: createSubject(),
									dispose: vi.fn(),
									restorePersistedState: vi.fn(async () => null),
									handleCallback,
									authorizeUrl: vi.fn(() => "/authorize"),
									authorizationHeader: vi.fn(() => null),
									ensureAuthForResource: vi.fn(async () => {
										const snapshot = state.get();
										if (snapshot) {
											return {
												status: EnsureAuthForResourceStatus.Authenticated,
												snapshot,
												freshness: "fresh" as const,
											};
										}
										return {
											status: EnsureAuthForResourceStatus.Unauthenticated,
											snapshot: null,
											authorizationHeader: null,
											reason: TokenSetAuthFlowReason.NoSnapshot,
										};
									}),
									ensureFreshAuthState: vi.fn(async () => state.get()),
									ensureAuthorizationHeader: vi.fn(async () => null),
									refresh: vi.fn(async () => null),
									clearState: vi.fn(async () => {}),
									loginWithRedirect: vi.fn(async () => undefined),
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

	it("does not re-run a successful callback resume when inline describeError changes identity", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		window.history.replaceState(
			{},
			"",
			"/auth/token-set/frontend-mode/callback?code=auth-code&state=state-1",
		);

		const onState = vi.fn();
		const handleCallback = vi.fn(async () => ({
			snapshot: {
				tokens: { accessToken: "live-at" },
				metadata: {},
			},
			postAuthRedirectUri: "/playground/token-set/frontend-mode",
		}));

		const renderTree = () =>
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
								authEvents: createSubject(),
								dispose: vi.fn(),
								restorePersistedState: vi.fn(async () => null),
								handleCallback,
								authorizationHeader: vi.fn(() => null),
								ensureAuthForResource: vi.fn(async () => ({
									status: EnsureAuthForResourceStatus.Unauthenticated,
									snapshot: null,
									authorizationHeader: null,
									reason: TokenSetAuthFlowReason.NoSnapshot,
								})),
								ensureFreshAuthState: vi.fn(async () => null),
								ensureAuthorizationHeader: vi.fn(async () => null),
								loginWithRedirect: vi.fn(async () => undefined),
							}),
						},
					],
				},
				createElement(CallbackResumeProbe, {
					onState,
					describeError: ({ errorDetails }) => ({
						code: errorDetails.code,
						kind: errorDetails.kind,
						title: "inline-presenter",
						description: errorDetails.message,
						recovery: errorDetails.recovery,
						retryable: errorDetails.retryable,
						tone: "warning",
						primaryAction: null,
					}),
				}),
			);

		const view = render(renderTree());

		await flushMicrotasks();
		expect(handleCallback).toHaveBeenCalledTimes(1);
		expect(onState.mock.calls.at(-1)?.[0]).toMatchObject({
			status: "resolved",
			clientKey: "frontend",
		});

		view.rerender(renderTree());
		await flushMicrotasks();

		expect(handleCallback).toHaveBeenCalledTimes(1);
		expect(onState.mock.calls.at(-1)?.[0]).toMatchObject({
			status: "resolved",
			clientKey: "frontend",
		});

		view.unmount();
	});

	it("does not re-run a failed callback resume when inline describeError changes identity", async () => {
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
		const handleCallback = vi.fn(async () => {
			throw callbackError;
		});

		const renderTree = () =>
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
								authEvents: createSubject(),
								dispose: vi.fn(),
								restorePersistedState: vi.fn(async () => null),
								handleCallback,
								authorizationHeader: vi.fn(() => null),
								ensureAuthForResource: vi.fn(async () => ({
									status: EnsureAuthForResourceStatus.Unauthenticated,
									snapshot: null,
									authorizationHeader: null,
									reason: TokenSetAuthFlowReason.NoSnapshot,
								})),
								ensureFreshAuthState: vi.fn(async () => null),
								ensureAuthorizationHeader: vi.fn(async () => null),
								loginWithRedirect: vi.fn(async () => undefined),
							}),
						},
					],
				},
				createElement(CallbackResumeProbe, {
					onState,
					describeError: ({ errorDetails }) => ({
						code: errorDetails.code,
						kind: errorDetails.kind,
						title: "inline-presenter",
						description: errorDetails.message,
						recovery: errorDetails.recovery,
						retryable: errorDetails.retryable,
						tone: "warning",
						primaryAction: null,
					}),
				}),
			);

		const view = render(renderTree());

		await flushMicrotasks();
		const pendingCountBefore = onState.mock.calls.filter(
			([state]) => state.status === "pending",
		).length;
		expect(handleCallback).toHaveBeenCalledTimes(1);
		expect(onState.mock.calls.at(-1)?.[0]).toMatchObject({
			status: "error",
			clientKey: "frontend",
		});

		view.rerender(renderTree());
		await flushMicrotasks();

		expect(handleCallback).toHaveBeenCalledTimes(1);
		expect(
			onState.mock.calls.filter(([state]) => state.status === "pending"),
		).toHaveLength(pendingCountBefore);
		expect(onState.mock.calls.at(-1)?.[0]).toMatchObject({
			status: "error",
			clientKey: "frontend",
		});

		view.unmount();
	});

	it("TokenSetCallbackComponent does not re-run callback resume when inline describeError changes identity", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		window.history.replaceState(
			{},
			"",
			"/auth/token-set/frontend-mode/callback?code=auth-code&state=state-1",
		);

		const handleCallback = vi.fn(async () => ({
			snapshot: {
				tokens: { accessToken: "live-at" },
				metadata: {},
			},
			postAuthRedirectUri: "/playground/token-set/frontend-mode",
		}));
		const onResolved = vi.fn();

		const renderTree = () =>
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
								authEvents: createSubject(),
								dispose: vi.fn(),
								restorePersistedState: vi.fn(async () => null),
								handleCallback,
								authorizationHeader: vi.fn(() => null),
								ensureAuthForResource: vi.fn(async () => ({
									status: EnsureAuthForResourceStatus.Unauthenticated,
									snapshot: null,
									authorizationHeader: null,
									reason: TokenSetAuthFlowReason.NoSnapshot,
								})),
								ensureFreshAuthState: vi.fn(async () => null),
								ensureAuthorizationHeader: vi.fn(async () => null),
								loginWithRedirect: vi.fn(async () => undefined),
							}),
						},
					],
				},
				createElement(TokenSetCallbackComponent, {
					onResolved,
					describeError: ({ errorDetails }) => ({
						code: errorDetails.code,
						kind: errorDetails.kind,
						title: "inline-presenter",
						description: errorDetails.message,
						recovery: errorDetails.recovery,
						retryable: errorDetails.retryable,
						tone: "warning",
						primaryAction: null,
					}),
				}),
			);

		const view = render(renderTree());

		await flushMicrotasks();
		expect(handleCallback).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledTimes(1);

		view.rerender(renderTree());
		await flushMicrotasks();

		expect(handleCallback).toHaveBeenCalledTimes(1);
		expect(onResolved).toHaveBeenCalledTimes(1);

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
								authEvents: createSubject(),
								dispose: vi.fn(),
								restorePersistedState: vi.fn(async () => null),
								handleCallback: vi.fn(async () => {
									throw callbackError;
								}),
								authorizeUrl: vi.fn(() => "/authorize"),
								authorizationHeader: vi.fn(() => null),
								ensureAuthForResource: vi.fn(async () => ({
									status: EnsureAuthForResourceStatus.Unauthenticated,
									snapshot: null,
									authorizationHeader: null,
									reason: TokenSetAuthFlowReason.NoSnapshot,
								})),
								ensureFreshAuthState: vi.fn(async () => null),
								ensureAuthorizationHeader: vi.fn(async () => null),
								refresh: vi.fn(async () => null),
								clearState: vi.fn(async () => {}),
								loginWithRedirect: vi.fn(async () => undefined),
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
					title: "Authentication callback failed",
					recovery: UserRecovery.RestartFlow,
					tone: "warning",
				},
				cause: callbackError,
			},
		});

		view.unmount();
	});

	it("uses a caller-provided error presenter override with callback context", async () => {
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
		const describeError = vi.fn(
			({
				errorDetails,
				clientKey,
				currentUrl,
			}: TokenSetCallbackErrorPresentationContext): ErrorPresentationDescriptor => ({
				code: errorDetails.code,
				kind: errorDetails.kind,
				source: errorDetails.source,
				title: `Frontend callback failed for ${clientKey}`,
				description: currentUrl ?? "missing-url",
				recovery: UserRecovery.RestartFlow,
				retryable: false,
				tone: "warning",
				primaryAction: null,
			}),
		);

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
								authEvents: createSubject(),
								dispose: vi.fn(),
								restorePersistedState: vi.fn(async () => null),
								handleCallback: vi.fn(async () => {
									throw callbackError;
								}),
								authorizeUrl: vi.fn(() => "/authorize"),
								authorizationHeader: vi.fn(() => null),
								ensureAuthForResource: vi.fn(async () => ({
									status: EnsureAuthForResourceStatus.Unauthenticated,
									snapshot: null,
									authorizationHeader: null,
									reason: TokenSetAuthFlowReason.NoSnapshot,
								})),
								ensureFreshAuthState: vi.fn(async () => null),
								ensureAuthorizationHeader: vi.fn(async () => null),
								refresh: vi.fn(async () => null),
								clearState: vi.fn(async () => {}),
								loginWithRedirect: vi.fn(async () => undefined),
							}),
						},
					],
				},
				createElement(CallbackResumeProbe, { onState, describeError }),
			),
		);

		await flushMicrotasks();

		expect(describeError).toHaveBeenCalledWith({
			clientKey: "frontend",
			currentUrl:
				"http://localhost:3000/auth/token-set/frontend-mode/callback?code=auth-code&state=state-1",
			errorDetails: expect.objectContaining({
				code: FrontendOidcModeCallbackErrorCode.PendingStale,
				message: "Pending authorization state expired before callback",
			}),
		});
		expect(onState.mock.calls.at(-1)?.[0]).toMatchObject({
			status: "error",
			errorDetails: {
				presentation: {
					title: "Frontend callback failed for frontend",
					description:
						"http://localhost:3000/auth/token-set/frontend-mode/callback?code=auth-code&state=state-1",
				},
			},
		});

		view.unmount();
	});

	it("prefers an explicit getCurrentUrl override over window.location.href", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		window.history.replaceState(
			{},
			"",
			"/auth/token-set/frontend-mode/callback?code=window-code&state=window-state",
		);

		const handleCallback = vi.fn(async () => ({
			snapshot: {
				tokens: { accessToken: "override-at" },
				metadata: {},
			},
			postAuthRedirectUri: "/override",
		}));
		const onState = vi.fn();
		const getCurrentUrl = vi.fn(
			() =>
				"https://override.test/auth/token-set/frontend-mode/callback?code=override-code&state=override-state",
		);

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
								authEvents: createSubject(),
								dispose: vi.fn(),
								restorePersistedState: vi.fn(async () => null),
								handleCallback,
								authorizeUrl: vi.fn(() => "/authorize"),
								authorizationHeader: vi.fn(() => null),
								ensureAuthForResource: vi.fn(async () => ({
									status: EnsureAuthForResourceStatus.Unauthenticated,
									snapshot: null,
									authorizationHeader: null,
									reason: TokenSetAuthFlowReason.NoSnapshot,
								})),
								ensureFreshAuthState: vi.fn(async () => null),
								ensureAuthorizationHeader: vi.fn(async () => null),
								refresh: vi.fn(async () => null),
								clearState: vi.fn(async () => {}),
								loginWithRedirect: vi.fn(async () => undefined),
							}),
						},
					],
				},
				createElement(CallbackResumeProbe, { onState, getCurrentUrl }),
			),
		);

		await flushMicrotasks();

		expect(getCurrentUrl).toHaveBeenCalled();
		expect(handleCallback).toHaveBeenCalledWith(
			"https://override.test/auth/token-set/frontend-mode/callback?code=override-code&state=override-state",
		);
		expect(onState.mock.calls.at(-1)?.[0]).toMatchObject({
			clientKey: "frontend",
			status: "resolved",
		});

		view.unmount();
	});

	it("stays idle when no current URL is available", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const onState = vi.fn();
		const handleCallback = vi.fn();

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
								authEvents: createSubject(),
								dispose: vi.fn(),
								restorePersistedState: vi.fn(async () => null),
								handleCallback,
								authorizeUrl: vi.fn(() => "/authorize"),
								authorizationHeader: vi.fn(() => null),
								ensureAuthForResource: vi.fn(async () => ({
									status: EnsureAuthForResourceStatus.Unauthenticated,
									snapshot: null,
									authorizationHeader: null,
									reason: TokenSetAuthFlowReason.NoSnapshot,
								})),
								ensureFreshAuthState: vi.fn(async () => null),
								ensureAuthorizationHeader: vi.fn(async () => null),
								refresh: vi.fn(async () => null),
								clearState: vi.fn(async () => {}),
								loginWithRedirect: vi.fn(async () => undefined),
							}),
						},
					],
				},
				createElement(CallbackResumeProbe, {
					onState,
					getCurrentUrl: () => undefined,
				}),
			),
		);

		await flushMicrotasks();

		expect(handleCallback).not.toHaveBeenCalled();
		expect(onState.mock.calls.at(-1)?.[0]).toMatchObject({
			clientKey: null,
			status: "idle",
			result: null,
			error: null,
		});

		view.unmount();
	});

	it("registers frontend-like clients without backend-only methods", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const serviceSpy = vi.fn();
		const loginWithRedirect = vi.fn(async () => undefined);
		const state = createSignal<AuthSnapshot | null>(null);

		const view = render(
			createElement(
				TokenSetAuthProvider,
				{
					idleWarmup: false,
					clients: [
						{
							key: "frontend",
							clientFactory: () => ({
								state,
								authEvents: createSubject(),
								dispose: vi.fn(),
								restorePersistedState: vi.fn(async () => null),
								handleCallback: vi.fn(async () => ({
									snapshot: {
										tokens: { accessToken: "frontend-at" },
										metadata: {},
									},
									postAuthRedirectUri: "/frontend",
								})),
								authorizationHeader: vi.fn(() => null),
								ensureAuthForResource: vi.fn(async () => ({
									status: EnsureAuthForResourceStatus.Unauthenticated,
									snapshot: null,
									authorizationHeader: null,
									reason: TokenSetAuthFlowReason.NoSnapshot,
								})),
								ensureFreshAuthState: vi.fn(async () => state.get()),
								ensureAuthorizationHeader: vi.fn(async () => null),
								loginWithRedirect,
							}),
						},
					],
				},
				createElement(AuthServiceProbe, {
					clientKey: "frontend",
					onService: serviceSpy,
				}),
			),
		);

		await flushMicrotasks();

		const service = serviceSpy.mock.calls.at(-1)?.[0];
		if (!service) {
			throw new Error("Expected the probe to observe a token-set auth service");
		}

		expect("authorizeUrl" in service.client).toBe(false);
		await service.client.loginWithRedirect({
			environment: {
				location: {
					href: "https://app.example.com/playground/token-set/frontend-mode",
					hash: "",
					pathname: "/playground/token-set/frontend-mode",
					search: "",
				},
			},
			postAuthRedirectUri: "/workspace/wiki",
		});
		expect(loginWithRedirect).toHaveBeenCalledWith({
			environment: {
				location: {
					href: "https://app.example.com/playground/token-set/frontend-mode",
					hash: "",
					pathname: "/playground/token-set/frontend-mode",
					search: "",
				},
			},
			postAuthRedirectUri: "/workspace/wiki",
		});

		view.unmount();
	});
});
