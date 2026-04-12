// @vitest-environment jsdom

// React-Query subpath integration evidence
//
// Iteration 110 evidence: proves the thin query/state ecosystem extension
// shipped as `@securitydept/token-set-context-client-react/react-query`
// behaves as a pure consumer of the token-set registry — never an
// authority. Per manager ruling: no standalone package; the subpath lives
// under the main React package with `@tanstack/react-query` as an optional
// peer dependency.

import type { ReadableSignalTrait } from "@securitydept/client";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import { AuthSourceKind } from "@securitydept/token-set-context-client/orchestration";
import type {
	OidcCallbackClient,
	OidcModeClient,
} from "@securitydept/token-set-context-client-react";
import {
	ClientInitializationPriority,
	TokenSetAuthProvider,
} from "@securitydept/token-set-context-client-react";
import {
	invalidateTokenSetQueriesForClient,
	tokenSetQueryKeys,
	useTokenSetAuthorizationHeader,
	useTokenSetReadinessQuery,
} from "@securitydept/token-set-context-client-react/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

async function waitForStatus(
	view: { container: HTMLElement },
	target: string,
	maxIters = 50,
) {
	for (let i = 0; i < maxIters; i++) {
		if (view.container.querySelector("#status")?.textContent === target) {
			return;
		}
		await flush();
	}
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
): OidcModeClient & OidcCallbackClient {
	const ctrl = createTestSignal<AuthSnapshot | null>(initial);
	return {
		state: ctrl.signal,
		dispose: vi.fn(),
		restorePersistedState: vi.fn().mockResolvedValue(null),
		handleCallback: vi.fn().mockResolvedValue({ snapshot: makeSnapshot("cb") }),
	};
}

// ---------------------------------------------------------------------------
// Evidence tests
// ---------------------------------------------------------------------------

describe("react-query subpath — thin integration helper only", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("tokenSetQueryKeys produces a stable, namespaced shape", () => {
		expect(tokenSetQueryKeys.all).toEqual(["tokenSetContext"]);
		expect(tokenSetQueryKeys.forClient("main")).toEqual([
			"tokenSetContext",
			"main",
		]);
		expect(tokenSetQueryKeys.readiness("main")).toEqual([
			"tokenSetContext",
			"main",
			"readiness",
		]);
		expect(tokenSetQueryKeys.authState("main")).toEqual([
			"tokenSetContext",
			"main",
			"authState",
		]);
	});

	it("useTokenSetReadinessQuery resolves against whenReady() of the registry", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		let deferredResolve:
			| ((client: OidcModeClient & OidcCallbackClient) => void)
			| null = null;
		const asyncFactory = () =>
			new Promise<OidcModeClient & OidcCallbackClient>((resolve) => {
				deferredResolve = resolve;
			});

		const qc = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const observed: Array<string | undefined> = [];

		function Probe() {
			const q = useTokenSetReadinessQuery("main");
			useEffect(() => {
				observed.push(q.status);
			}, [q.status]);
			return createElement("span", { id: "status" }, q.status);
		}

		const view = render(
			createElement(
				QueryClientProvider,
				{ client: qc },
				createElement(
					TokenSetAuthProvider,
					{
						clients: [
							{
								key: "main",
								clientFactory: asyncFactory,
								priority: ClientInitializationPriority.Primary,
								autoRestore: false,
							},
						],
						idleWarmup: false,
					},
					createElement(Probe),
				),
			),
		);

		await flush();
		expect(view.container.querySelector("#status")?.textContent).toBe(
			"pending",
		);

		const client = createMockClient(makeSnapshot("ready"));
		await act(async () => {
			deferredResolve?.(client);
			await Promise.resolve();
		});
		await waitForStatus(view, "success");

		expect(view.container.querySelector("#status")?.textContent).toBe(
			"success",
		);

		view.unmount();
		qc.clear();
	});

	it("useTokenSetAuthorizationHeader mirrors registry access token (Bearer prefix)", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		const client = createMockClient(makeSnapshot("abc123"));
		const qc = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		const captured: Array<{
			enabled: boolean;
			authorization: string | null;
		}> = [];

		function Probe() {
			const header = useTokenSetAuthorizationHeader("main");
			useEffect(() => {
				captured.push(header);
			}, [header]);
			return null;
		}

		const view = render(
			createElement(
				QueryClientProvider,
				{ client: qc },
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
			),
		);

		await flush();
		expect(captured[0]).toEqual({
			enabled: true,
			authorization: "Bearer abc123",
		});

		view.unmount();
		qc.clear();
	});

	it("invalidateTokenSetQueriesForClient keys into the shared namespace", async () => {
		const qc = new QueryClient();
		const spy = vi.spyOn(qc, "invalidateQueries");
		await invalidateTokenSetQueriesForClient(qc, "main");
		expect(spy).toHaveBeenCalledWith({
			queryKey: tokenSetQueryKeys.forClient("main"),
		});
	});
});
