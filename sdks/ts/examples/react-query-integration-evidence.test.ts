// @vitest-environment jsdom

// React-Query subpath integration evidence
//
// Iteration 115 evidence: proves the token-set React Query subpath now owns
// the canonical read/write consumer surface for groups and entries while
// still remaining a consumer of the token-set registry/runtime authority.
// Per manager ruling: no standalone package; the subpath lives under the
// main React package with `@tanstack/react-query` as an optional peer
// dependency.

import type {
	HttpRequest,
	HttpTransport,
	ReadableSignalTrait,
} from "@securitydept/client";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import { AuthSourceKind } from "@securitydept/token-set-context-client/orchestration";
import type { TokenSetReactClient } from "@securitydept/token-set-context-client-react";
import {
	ClientInitializationPriority,
	TokenSetAuthProvider,
	useTokenSetBackendOidcClient,
} from "@securitydept/token-set-context-client-react";
import {
	invalidateTokenSetQueriesForClient,
	tokenSetQueryKeys,
	useTokenSetAuthorizationHeader,
	useTokenSetCreateGroupMutation,
	useTokenSetCreateTokenEntryMutation,
	useTokenSetGroupsQuery,
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

async function waitForText(
	view: { container: HTMLElement },
	selector: string,
	target: string,
	maxIters = 50,
) {
	for (let i = 0; i < maxIters; i++) {
		if (view.container.querySelector(selector)?.textContent === target) {
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
): TokenSetReactClient {
	const ctrl = createTestSignal<AuthSnapshot | null>(initial);
	return {
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
}

function createRecordingTransport() {
	const requests: HttpRequest[] = [];
	const responses = new Map<string, { status: number; body: unknown }>();

	const transport: HttpTransport = {
		async execute(request) {
			requests.push(request);
			const key = `${request.method} ${request.url}`;
			const response = responses.get(key);
			if (!response) {
				throw new Error(`Unexpected request: ${key}`);
			}
			return {
				status: response.status,
				headers: {},
				body: response.body,
			};
		},
	};

	return {
		transport,
		requests,
		respond(method: string, url: string, status: number, body: unknown) {
			responses.set(`${method} ${url}`, { status, body });
		},
	};
}

// ---------------------------------------------------------------------------
// Evidence tests
// ---------------------------------------------------------------------------

describe("react-query subpath — canonical token-set consumer surface", () => {
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
		expect(tokenSetQueryKeys.groups("main")).toEqual([
			"tokenSetContext",
			"main",
			"groups",
		]);
		expect(tokenSetQueryKeys.group("main", "group-1")).toEqual([
			"tokenSetContext",
			"main",
			"groups",
			"group-1",
		]);
		expect(tokenSetQueryKeys.entries("main")).toEqual([
			"tokenSetContext",
			"main",
			"entries",
		]);
		expect(tokenSetQueryKeys.entry("main", "entry-1")).toEqual([
			"tokenSetContext",
			"main",
			"entries",
			"entry-1",
		]);
	});

	it("useTokenSetReadinessQuery resolves against whenReady() of the registry", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		let deferredResolve: ((client: TokenSetReactClient) => void) | null = null;
		const asyncFactory = () =>
			new Promise<TokenSetReactClient>((resolve) => {
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

	it("useTokenSetGroupsQuery loads /api/groups under the SDK-owned namespace", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		const client = createMockClient(makeSnapshot("abc123"));
		const http = createRecordingTransport();
		http.respond("GET", "/api/groups", 200, [
			{ id: "group-1", name: "Operators" },
		]);
		const qc = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		function Probe() {
			const query = useTokenSetGroupsQuery({
				clientKey: "main",
				requestOptions: { transport: http.transport },
			});
			return createElement(
				"div",
				null,
				createElement("span", { id: "status" }, query.status),
				createElement("span", { id: "count" }, String(query.data?.length ?? 0)),
			);
		}

		const view = render(
			createElement(
				QueryClientProvider,
				{ client: qc },
				createElement(
					TokenSetAuthProvider,
					{
						clients: [
							{ key: "main", clientFactory: () => client, autoRestore: false },
						],
						idleWarmup: false,
					},
					createElement(Probe),
				),
			),
		);

		await waitForStatus(view, "success");
		await waitForText(view, "#count", "1");
		expect(view.container.querySelector("#count")?.textContent).toBe("1");
		expect(http.requests[0]?.headers?.authorization).toBe("Bearer abc123");

		view.unmount();
		qc.clear();
	});

	it("useTokenSetCreateGroupMutation invalidates groups and entries after success", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		const client = createMockClient(makeSnapshot("abc123"));
		const http = createRecordingTransport();
		http.respond("POST", "/api/groups", 200, {
			id: "group-1",
			name: "Operators",
		});
		const qc = new QueryClient({
			defaultOptions: { mutations: { retry: false } },
		});
		const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

		function Probe() {
			const mutation = useTokenSetCreateGroupMutation({
				clientKey: "main",
			});
			useEffect(() => {
				void mutation.mutateAsync({
					name: "Operators",
					entry_ids: ["entry-1"],
					requestOptions: { transport: http.transport },
				});
			}, [mutation]);
			return createElement("span", { id: "status" }, mutation.status);
		}

		const view = render(
			createElement(
				QueryClientProvider,
				{ client: qc },
				createElement(
					TokenSetAuthProvider,
					{
						clients: [
							{ key: "main", clientFactory: () => client, autoRestore: false },
						],
						idleWarmup: false,
					},
					createElement(Probe),
				),
			),
		);

		await waitForStatus(view, "success");
		expect(http.requests[0]?.headers?.authorization).toBe("Bearer abc123");
		expect(http.requests[0]?.body).toBe(
			JSON.stringify({ name: "Operators", entry_ids: ["entry-1"] }),
		);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: tokenSetQueryKeys.groups("main"),
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: tokenSetQueryKeys.entries("main"),
		});

		view.unmount();
		qc.clear();
	});

	it("useTokenSetCreateTokenEntryMutation invalidates entries after success", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		const client = createMockClient(makeSnapshot("abc123"));
		const http = createRecordingTransport();
		http.respond("POST", "/api/entries/token", 200, {
			entry: {
				id: "entry-1",
				name: "Operators Token",
				kind: "token",
				group_ids: ["group-1"],
				created_at: "2026-04-19T00:00:00Z",
				updated_at: "2026-04-19T00:00:00Z",
			},
			token: "secret-token",
		});
		const qc = new QueryClient({
			defaultOptions: { mutations: { retry: false } },
		});
		const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

		function Probe() {
			const mutation = useTokenSetCreateTokenEntryMutation({
				clientKey: "main",
			});
			useEffect(() => {
				void mutation.mutateAsync({
					name: "Operators Token",
					group_ids: ["group-1"],
					requestOptions: { transport: http.transport },
				});
			}, [mutation]);
			return createElement("span", { id: "status" }, mutation.status);
		}

		const view = render(
			createElement(
				QueryClientProvider,
				{ client: qc },
				createElement(
					TokenSetAuthProvider,
					{
						clients: [
							{ key: "main", clientFactory: () => client, autoRestore: false },
						],
						idleWarmup: false,
					},
					createElement(Probe),
				),
			),
		);

		await waitForStatus(view, "success");
		expect(http.requests[0]?.body).toBe(
			JSON.stringify({ name: "Operators Token", group_ids: ["group-1"] }),
		);
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: tokenSetQueryKeys.entries("main"),
		});

		view.unmount();
		qc.clear();
	});

	it("useTokenSetBackendOidcClient exposes the keyed lower-level backend-oidc client surface", () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;

		const client = createMockClient(makeSnapshot("abc123"));

		function Probe() {
			const keyedClient = useTokenSetBackendOidcClient("main");
			return createElement(
				"span",
				{ id: "authorization" },
				keyedClient.authorizationHeader() ?? "none",
			);
		}

		const view = render(
			createElement(
				QueryClientProvider,
				{ client: new QueryClient() },
				createElement(
					TokenSetAuthProvider,
					{
						clients: [
							{ key: "main", clientFactory: () => client, autoRestore: false },
						],
						idleWarmup: false,
					},
					createElement(Probe),
				),
			),
		);

		expect(view.container.querySelector("#authorization")?.textContent).toBe(
			"Bearer abc123",
		);

		view.unmount();
	});
});
