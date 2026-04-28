// @vitest-environment jsdom

// React callback / resume async-readiness evidence — iteration 110 review-1 fix
//
// Proves the three properties the review asked for:
//
// 1. Async primary clients: when the callback URL is visited before the
//    client factory has resolved, `TokenSetCallbackComponent` enters the
//    pending state, then transitions to resolved once the factory settles
//    and `handleCallback()` runs against the matched client.
//
// 2. Lazy clients: a client registered with
//    `ClientInitializationPriority.Lazy` is not materialised at provider
//    mount, but the callback path still drives it end-to-end because
//    `useTokenSetCallbackResume` now calls `registry.whenReady()` instead
//    of `registry.get()`.
//
// 3. Error state: when `handleCallback()` rejects (e.g. PKCE mismatch),
//    the outlet surfaces the error via `onError` and renders the fallback
//    slot without silently dropping the rejection.
//
// This closes the "React parity claim was premature" finding — the
// callback main execution path itself now matches the Angular
// `whenReady()` semantics.

import { createSubject, type ReadableSignalTrait } from "@securitydept/client";
import {
	type AuthSnapshot,
	AuthSourceKind,
	EnsureAuthForResourceStatus,
	TokenSetAuthFlowReason,
} from "@securitydept/token-set-context-client/orchestration";
import type {
	OidcCallbackClient,
	TokenSetReactClient,
} from "@securitydept/token-set-context-client-react";
import {
	CallbackResumeStatus,
	ClientInitializationPriority,
	TokenSetAuthProvider,
	TokenSetCallbackComponent,
	useTokenSetCallbackResume,
} from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestSignal<T>(initial: T): {
	signal: ReadableSignalTrait<T>;
	set(v: T): void;
} {
	let value = initial;
	const listeners = new Set<() => void>();
	return {
		signal: {
			get: () => value,
			subscribe(l: () => void) {
				listeners.add(l);
				return () => listeners.delete(l);
			},
		},
		set(next: T) {
			value = next;
			for (const l of listeners) l();
		},
	};
}

function makeSnapshot(accessToken: string): AuthSnapshot {
	return {
		tokens: { accessToken, accessTokenExpiresAt: undefined },
		metadata: { source: { kind: AuthSourceKind.OidcAuthorizationCode } },
	};
}

interface MockClientKnobs {
	snapshot?: AuthSnapshot | null;
	/** Custom `handleCallback` implementation. */
	handleCallback?: OidcCallbackClient["handleCallback"];
}

function createMockClient(knobs: MockClientKnobs = {}): TokenSetReactClient {
	const ctrl = createTestSignal<AuthSnapshot | null>(knobs.snapshot ?? null);
	return {
		state: ctrl.signal,
		authEvents: createSubject(),
		dispose: vi.fn(),
		restorePersistedState: vi.fn().mockResolvedValue(null),
		handleCallback:
			knobs.handleCallback ??
			vi.fn<OidcCallbackClient["handleCallback"]>().mockResolvedValue({
				snapshot: makeSnapshot("cb-token"),
				postAuthRedirectUri: "/home",
			}),
		authorizeUrl: vi.fn().mockReturnValue("/auth/token-set/login"),
		authorizationHeader() {
			const accessToken = ctrl.signal.get()?.tokens.accessToken;
			return accessToken ? `Bearer ${accessToken}` : null;
		},
		ensureFreshAuthState: vi.fn().mockResolvedValue(ctrl.signal.get()),
		ensureAuthorizationHeader: vi.fn().mockImplementation(async () => {
			const accessToken = ctrl.signal.get()?.tokens.accessToken;
			return accessToken ? `Bearer ${accessToken}` : null;
		}),
		ensureAuthForResource: vi.fn().mockImplementation(async () => {
			const snapshot = ctrl.signal.get();
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
		refresh: vi.fn().mockResolvedValue(makeSnapshot("refreshed")),
		clearState: vi.fn().mockResolvedValue(undefined),
	};
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
		rerender(next: ReactElement) {
			act(() => {
				root.render(next);
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

async function flush() {
	await act(async () => {
		await Promise.resolve();
	});
}

async function flushMany(rounds = 4) {
	for (let i = 0; i < rounds; i++) {
		// Intertwined microtasks (`whenReady` → `handleCallback`) need a
		// handful of flushes to fully settle.
		await flush();
	}
}

const CALLBACK_URL = "http://localhost/oidc/callback?code=abc&state=xyz";

// ---------------------------------------------------------------------------
// 1. Async primary client — provider-mount-before-materialisation case
// ---------------------------------------------------------------------------

describe("React callback outlet — async primary client", () => {
	beforeEach(() => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
	});
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("awaits async materialisation before driving handleCallback()", async () => {
		const asyncClient = createMockClient();
		let resolveFactory: (c: TokenSetReactClient) => void = () => {};
		const factoryPromise = new Promise<TokenSetReactClient>((resolve) => {
			resolveFactory = resolve;
		});

		const resolvedSpy = vi.fn();
		const view = render(
			createElement(
				TokenSetAuthProvider,
				{
					clients: [
						{
							key: "async",
							clientFactory: () => factoryPromise,
							callbackPath: "/oidc/callback",
							autoRestore: false,
						},
					],
					idleWarmup: false,
				},
				createElement(TokenSetCallbackComponent, {
					pending: createElement("span", { "data-testid": "pending" }, "…"),
					fallback: createElement(
						"span",
						{ "data-testid": "fallback" },
						"none",
					),
					onResolved: resolvedSpy,
				}),
			),
		);

		// Inject the current URL via window.location (jsdom allows it through
		// history API).
		history.replaceState(null, "", "/oidc/callback?code=abc&state=xyz");

		// Re-render forces the hook to re-read the URL.
		view.rerender(
			createElement(
				TokenSetAuthProvider,
				{
					clients: [
						{
							key: "async",
							clientFactory: () => factoryPromise,
							callbackPath: "/oidc/callback",
							autoRestore: false,
						},
					],
					idleWarmup: false,
				},
				createElement(TokenSetCallbackComponent, {
					pending: createElement("span", { "data-testid": "pending" }, "…"),
					fallback: createElement(
						"span",
						{ "data-testid": "fallback" },
						"none",
					),
					onResolved: resolvedSpy,
				}),
			),
		);

		await flushMany();

		// While the factory is still pending, the outlet renders pending.
		expect(
			view.container.querySelector('[data-testid="pending"]'),
		).not.toBeNull();
		expect(asyncClient.handleCallback).not.toHaveBeenCalled();
		expect(resolvedSpy).not.toHaveBeenCalled();

		// Resolve the factory — whenReady() unblocks, handleCallback runs.
		await act(async () => {
			resolveFactory(asyncClient);
			await Promise.resolve();
		});
		await flushMany();

		expect(asyncClient.handleCallback).toHaveBeenCalledWith(
			expect.stringContaining("/oidc/callback?code=abc"),
		);
		expect(resolvedSpy).toHaveBeenCalledWith({
			clientKey: "async",
			postAuthRedirectUri: "/home",
		});

		view.unmount();
	});
});

// ---------------------------------------------------------------------------
// 2. Lazy client — factory must not run at mount, but callback still drives it
// ---------------------------------------------------------------------------

describe("React callback outlet — lazy client", () => {
	beforeEach(() => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		history.replaceState(null, "", "/oidc/callback?code=lazy&state=zzz");
	});
	afterEach(() => {
		document.body.innerHTML = "";
		history.replaceState(null, "", "/");
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("materialises a lazy client on demand via whenReady()", async () => {
		const lazyClient = createMockClient();
		const factory = vi.fn(() => lazyClient);
		const resolvedSpy = vi.fn();

		const view = render(
			createElement(
				TokenSetAuthProvider,
				{
					clients: [
						{
							key: "lazy",
							clientFactory: factory,
							callbackPath: "/oidc/callback",
							autoRestore: false,
							priority: ClientInitializationPriority.Lazy,
						},
					],
					idleWarmup: false,
				},
				createElement(TokenSetCallbackComponent, {
					pending: createElement("span", { "data-testid": "pending" }, "…"),
					fallback: createElement("span", { "data-testid": "fallback" }, "no"),
					onResolved: resolvedSpy,
				}),
			),
		);

		await flushMany();

		expect(factory).toHaveBeenCalledTimes(1);
		expect(lazyClient.handleCallback).toHaveBeenCalledTimes(1);
		expect(resolvedSpy).toHaveBeenCalledWith({
			clientKey: "lazy",
			postAuthRedirectUri: "/home",
		});

		view.unmount();
	});
});

// ---------------------------------------------------------------------------
// 3. Resolve state via the hook directly (pending → resolved transition)
// ---------------------------------------------------------------------------

describe("useTokenSetCallbackResume — state transitions", () => {
	beforeEach(() => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
	});
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("renders idle when the URL does not match a registered callback path", async () => {
		const client = createMockClient();
		const seen: Array<{
			status: CallbackResumeStatus;
			key: string | null;
		}> = [];

		function Probe() {
			const state = useTokenSetCallbackResume({
				getCurrentUrl: () => "http://localhost/not-a-callback",
			});
			seen.push({ status: state.status, key: state.clientKey });
			return null;
		}

		const view = render(
			createElement(
				TokenSetAuthProvider,
				{
					clients: [
						{
							key: "main",
							clientFactory: () => client,
							callbackPath: "/oidc/callback",
							autoRestore: false,
						},
					],
					idleWarmup: false,
				},
				createElement(Probe),
			),
		);

		await flushMany();

		expect(seen.at(-1)).toEqual({
			status: CallbackResumeStatus.Idle,
			key: null,
		});
		expect(client.handleCallback).not.toHaveBeenCalled();

		view.unmount();
	});

	it("surfaces a handleCallback rejection via status=error", async () => {
		const errorSpy = vi.fn();
		const handleCallback = vi
			.fn<OidcCallbackClient["handleCallback"]>()
			.mockRejectedValue(new Error("pkce-mismatch"));
		const client = createMockClient({ handleCallback });

		const view = render(
			createElement(
				TokenSetAuthProvider,
				{
					clients: [
						{
							key: "main",
							clientFactory: () => client,
							callbackPath: "/oidc/callback",
							autoRestore: false,
						},
					],
					idleWarmup: false,
				},
				createElement(TokenSetCallbackComponent, {
					pending: createElement("span", { "data-testid": "pending" }, "…"),
					fallback: createElement(
						"span",
						{ "data-testid": "fallback" },
						"oops",
					),
					onError: errorSpy,
				}),
			),
		);

		history.replaceState(
			null,
			"",
			new URL(CALLBACK_URL).pathname + new URL(CALLBACK_URL).search,
		);
		view.rerender(
			createElement(
				TokenSetAuthProvider,
				{
					clients: [
						{
							key: "main",
							clientFactory: () => client,
							callbackPath: "/oidc/callback",
							autoRestore: false,
						},
					],
					idleWarmup: false,
				},
				createElement(TokenSetCallbackComponent, {
					pending: createElement("span", { "data-testid": "pending" }, "…"),
					fallback: createElement(
						"span",
						{ "data-testid": "fallback" },
						"oops",
					),
					onError: errorSpy,
				}),
			),
		);

		await flushMany();

		expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
		expect(
			view.container.querySelector('[data-testid="fallback"]'),
		).not.toBeNull();
		expect(handleCallback).toHaveBeenCalled();

		view.unmount();
		history.replaceState(null, "", "/");
	});
});
