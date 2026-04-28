// @vitest-environment jsdom

// React multi-client registry / provider / hooks baseline
//
// Iteration 110 evidence: proves the React adapter has reached Angular-parity
// for multi-client token-set auth. A single React tree hosts the
// `TokenSetAuthProvider`, registers multiple OIDC clients (including an
// async / lazy one), and a nested component consumes each client's auth
// snapshot via the registry-backed hooks.
//
// This closes the canonical React consumer path that used to live only in
// Angular (provideTokenSetAuth / TokenSetAuthRegistry / TokenSetAuthService).

import type { ReadableSignalTrait } from "@securitydept/client";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import { AuthSourceKind } from "@securitydept/token-set-context-client/orchestration";
import type { TokenSetReactClient } from "@securitydept/token-set-context-client-react";
import {
	ClientInitializationPriority,
	TokenSetAuthProvider,
	useTokenSetAccessToken,
	useTokenSetAuthRegistry,
	useTokenSetAuthService,
	useTokenSetAuthState,
} from "@securitydept/token-set-context-client-react";
import { act, createElement, type ReactElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test infra
// ---------------------------------------------------------------------------

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

async function flush() {
	await act(async () => {
		await Promise.resolve();
	});
}

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

function createMockClient(
	initial: AuthSnapshot | null = null,
): [TokenSetReactClient, (s: AuthSnapshot | null) => void] {
	const ctrl = createTestSignal<AuthSnapshot | null>(initial);
	const client: TokenSetReactClient = {
		state: ctrl.signal,
		dispose: vi.fn(),
		restorePersistedState: vi.fn().mockResolvedValue(null),
		handleCallback: vi.fn().mockResolvedValue({ snapshot: makeSnapshot("cb") }),
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
		refresh: vi.fn().mockResolvedValue(makeSnapshot("refreshed")),
		clearState: vi.fn().mockResolvedValue(undefined),
	};
	return [client, ctrl.set];
}

// ---------------------------------------------------------------------------
// Evidence tests
// ---------------------------------------------------------------------------

describe("React multi-client registry baseline (iteration 110)", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("registers multiple clients and exposes keyed auth state via hooks", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		const [mainClient, setMain] = createMockClient();
		const [adminClient] = createMockClient(makeSnapshot("admin-seed"));

		const seen: Record<string, string | null> = {};
		function Probe() {
			const mainTok = useTokenSetAccessToken("main");
			const adminTok = useTokenSetAccessToken("admin");
			useEffect(() => {
				seen.main = mainTok;
				seen.admin = adminTok;
			}, [mainTok, adminTok]);
			return createElement(
				"div",
				null,
				createElement("span", { id: "main" }, mainTok ?? "none"),
				createElement("span", { id: "admin" }, adminTok ?? "none"),
			);
		}

		const view = render(
			createElement(
				TokenSetAuthProvider,
				{
					clients: [
						{
							key: "main",
							clientFactory: () => mainClient,
							autoRestore: false,
						},
						{
							key: "admin",
							clientFactory: () => adminClient,
							autoRestore: false,
						},
					],
					idleWarmup: false,
				},
				createElement(Probe),
			),
		);

		await flush();

		expect(view.container.querySelector("#main")?.textContent).toBe("none");
		expect(view.container.querySelector("#admin")?.textContent).toBe(
			"admin-seed",
		);

		act(() => {
			setMain(makeSnapshot("main-live"));
		});
		await flush();

		expect(view.container.querySelector("#main")?.textContent).toBe(
			"main-live",
		);
		expect(seen.main).toBe("main-live");
		expect(seen.admin).toBe("admin-seed");

		view.unmount();
		await flush();
		// Microtask-settled dispose; both clients should have been torn down.
		await new Promise((r) => setTimeout(r, 0));
		expect(mainClient.dispose).toHaveBeenCalled();
		expect(adminClient.dispose).toHaveBeenCalled();
	});

	it("lazy clients stay not_initialized until preload is triggered", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		const [primaryClient] = createMockClient(makeSnapshot("primary"));
		const factory = vi.fn();
		const [lazyClient] = createMockClient(makeSnapshot("lazy-ready"));
		factory.mockImplementation(() => lazyClient);

		let registrySnapshot: ReturnType<typeof useTokenSetAuthRegistry> | null =
			null;
		function Spy() {
			registrySnapshot = useTokenSetAuthRegistry();
			return null;
		}

		const view = render(
			createElement(
				TokenSetAuthProvider,
				{
					clients: [
						{
							key: "primary",
							clientFactory: () => primaryClient,
							autoRestore: false,
						},
						{
							key: "lazy",
							clientFactory: factory,
							priority: ClientInitializationPriority.Lazy,
							autoRestore: false,
						},
					],
					idleWarmup: false,
				},
				createElement(Spy),
			),
		);

		await flush();

		expect(registrySnapshot).toBeTruthy();
		const registry = registrySnapshot!;
		expect(registry.readinessState("primary")).toBe("ready");
		expect(registry.readinessState("lazy")).toBe("not_initialized");
		expect(factory).not.toHaveBeenCalled();

		await registry.whenReady("lazy");
		expect(factory).toHaveBeenCalledOnce();
		expect(registry.readinessState("lazy")).toBe("ready");

		view.unmount();
		await flush();
	});

	it("useTokenSetAuthState re-renders on signal-level changes (no manual wiring)", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		const [client, setState] = createMockClient();
		const observed: Array<string | null> = [];

		function Probe() {
			const snap = useTokenSetAuthState("main");
			useEffect(() => {
				observed.push(snap?.tokens.accessToken ?? null);
			}, [snap]);
			// Reference to satisfy the "service hook returns object" claim.
			useTokenSetAuthService("main");
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
							autoRestore: false,
						},
					],
					idleWarmup: false,
				},
				createElement(Probe),
			),
		);

		await flush();
		act(() => {
			setState(makeSnapshot("t1"));
		});
		await flush();
		act(() => {
			setState(makeSnapshot("t2"));
		});
		await flush();

		expect(observed).toEqual([null, "t1", "t2"]);
		view.unmount();
	});
});
