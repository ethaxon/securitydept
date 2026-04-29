import type {
	CancelableHandle,
	ClientRuntime,
	HttpRequest,
	HttpResponse,
	HttpTransport,
	TraceEvent,
	TraceEventSinkTrait,
} from "@securitydept/client";
import {
	createInMemoryRecordStore,
	createOperationTracer,
	OperationTraceEventType,
} from "@securitydept/client";
import { createFetchTransport } from "@securitydept/client/web";
import { InMemoryTraceCollector } from "@securitydept/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	EnsureAuthForResourceStatus,
	type TokenSetAuthEvent,
	TokenSetAuthEventType,
	TokenSetAuthFlowSource,
} from "../../orchestration";
import { BackendOidcModeClient } from "../client";

const BASE_URL = "https://api.example.com";
const DEFAULT_PERSISTENCE_KEY =
	"securitydept.backend_oidc:v1:https://api.example.com";

class TestClock {
	constructor(private _now: number) {}

	now(): number {
		return this._now;
	}

	advance(ms: number): void {
		this._now += ms;
	}
}

class TestScheduler {
	private readonly _tasks: Array<{
		executeAt: number;
		fn: () => void;
		cancelled: boolean;
	}> = [];

	constructor(private readonly _clock: TestClock) {}

	setTimeout(delayMs: number, fn: () => void): CancelableHandle {
		const task = {
			executeAt: this._clock.now() + delayMs,
			fn,
			cancelled: false,
		};
		this._tasks.push(task);
		return {
			cancel: () => {
				task.cancelled = true;
			},
		};
	}

	advanceAndFlush(ms: number): void {
		this._clock.advance(ms);
		const ready = this._tasks
			.filter((task) => !task.cancelled && task.executeAt <= this._clock.now())
			.sort((left, right) => left.executeAt - right.executeAt);

		for (const task of ready) {
			const index = this._tasks.indexOf(task);
			if (index !== -1) {
				this._tasks.splice(index, 1);
			}
			if (!task.cancelled) {
				task.fn();
			}
		}
	}

	get pendingCount(): number {
		return this._tasks.filter((task) => !task.cancelled).length;
	}
}

class TestTraceCollector implements TraceEventSinkTrait {
	readonly events: TraceEvent[] = [];

	record(event: TraceEvent): void {
		this.events.push(event);
	}
}

function createTestTransport(
	handler: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>,
): HttpTransport {
	return {
		async execute(request: HttpRequest) {
			return await handler(request);
		},
	};
}

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

function createTestRuntime(
	transport: HttpTransport,
	options?: {
		now?: number;
		traceSink?: TraceEventSinkTrait;
		persistentStore?: ClientRuntime["persistentStore"];
	},
) {
	const clock = new TestClock(
		options?.now ?? Date.parse("2026-01-01T00:00:00Z"),
	);
	const scheduler = new TestScheduler(clock);
	const runtime: ClientRuntime = {
		transport,
		scheduler,
		clock,
		traceSink: options?.traceSink,
		operationTracer: createOperationTracer({
			clock,
			traceSink: options?.traceSink,
		}),
		persistentStore: options?.persistentStore,
	};

	return { runtime, clock, scheduler };
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 6; index += 1) {
		await Promise.resolve();
	}
}

describe("BackendOidcModeClient", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("refreshes tokens from a JSON response body", async () => {
		const transport = createTestTransport(() => ({
			status: 200,
			headers: { "content-type": "application/json" },
			body: {
				access_token: "new-at",
				refresh_token: "new-rt",
				access_token_expires_at: "2026-12-31T00:00:00Z",
			},
		}));
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		client.restoreState({
			tokens: {
				accessToken: "old-at",
				refreshMaterial: "old-rt",
			},
			metadata: {},
		});

		const result = await client.refresh();

		expect(result).not.toBeNull();
		expect(result?.tokens.accessToken).toBe("new-at");
		expect(result?.tokens.refreshMaterial).toBe("new-rt");
		expect(result?.tokens.accessTokenExpiresAt).toBe("2026-12-31T00:00:00Z");
	});

	it("throws when a refresh response body is missing access_token", async () => {
		const transport = createTestTransport(() => ({
			status: 200,
			headers: { "content-type": "application/json" },
			body: { id_token: "only-id-token" },
		}));
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		client.restoreState({
			tokens: { accessToken: "at", refreshMaterial: "rt" },
			metadata: {},
		});

		await expect(client.refresh()).rejects.toThrow(/missing access_token/i);
	});

	it("does not project an expired token as an authorization header", async () => {
		const transport = createTestTransport(() => ({
			status: 500,
			headers: {},
			body: null,
		}));
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		client.restoreState({
			tokens: {
				accessToken: "expired-at",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
			},
			metadata: {},
		});

		expect(client.authorizationHeader()).toBeNull();
		expect(await client.ensureAuthorizationHeader()).toBeNull();
		expect(client.state.get()).toBeNull();
	});

	it("coalesces concurrent fresh authorization requests through one refresh", async () => {
		const refreshResponse = createDeferred<HttpResponse>();
		let refreshRequests = 0;
		const transport = createTestTransport((request) => {
			if (request.url.endsWith("/auth/oidc/refresh")) {
				refreshRequests += 1;
				return refreshResponse.promise;
			}
			if (request.url.endsWith("/auth/oidc/user-info")) {
				return {
					status: 200,
					headers: { "content-type": "application/json" },
					body: { principal: { subject: "user-1" } },
				};
			}
			throw new Error(`Unexpected request: ${request.url}`);
		});
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		client.restoreState({
			tokens: {
				accessToken: "expired-at",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
				refreshMaterial: "rt",
			},
			metadata: {},
		});

		const firstHeader = client.ensureAuthorizationHeader();
		const secondHeader = client.ensureAuthorizationHeader();
		await flushMicrotasks();

		expect(refreshRequests).toBe(1);
		refreshResponse.resolve({
			status: 200,
			headers: { "content-type": "application/json" },
			body: {
				access_token: "fresh-at",
				refresh_token: "fresh-rt",
				access_token_expires_at: "2026-01-01T01:00:00Z",
			},
		});

		await expect(firstHeader).resolves.toBe("Bearer fresh-at");
		await expect(secondHeader).resolves.toBe("Bearer fresh-at");
		expect(refreshRequests).toBe(1);
	});

	it("emits contextual refresh lifecycle events when callers join a refresh barrier", async () => {
		const refreshResponse = createDeferred<HttpResponse>();
		let refreshRequests = 0;
		const transport = createTestTransport((request) => {
			if (request.url.endsWith("/auth/oidc/refresh")) {
				refreshRequests += 1;
				return refreshResponse.promise;
			}
			if (request.url.endsWith("/auth/oidc/user-info")) {
				return {
					status: 200,
					headers: { "content-type": "application/json" },
					body: { principal: { subject: "user-1" } },
				};
			}
			throw new Error(`Unexpected request: ${request.url}`);
		});
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL, refreshWindowMs: 0 },
			runtime,
		);
		const events: TokenSetAuthEvent[] = [];
		client.authEvents.subscribe({
			next: (event) => events.push(event),
		});

		client.restoreState({
			tokens: {
				accessToken: "refresh-due-at",
				accessTokenExpiresAt: "2026-01-01T00:00:10Z",
				refreshMaterial: "rt",
			},
			metadata: {},
		});

		const routeAdmission = client.ensureAuthForResource({
			source: TokenSetAuthFlowSource.RouteGuard,
			clientKey: "confluence",
			logicalClientId: "wiki-main",
			providerFamily: "authentik",
			requirement: { id: "confluence-oidc", kind: "frontend_oidc" },
			url: "/confluence",
			forceRefreshWhenDue: true,
		});
		const protectedRequest = client.ensureAuthForResource({
			source: TokenSetAuthFlowSource.HttpInterceptor,
			clientKey: "confluence",
			logicalClientId: "wiki-main",
			providerFamily: "authentik",
			requirement: { id: "confluence-oidc", kind: "frontend_oidc" },
			url: "https://api.example.com/wiki/rest/api/content",
			needsAuthorizationHeader: true,
			forceRefreshWhenDue: true,
		});
		await flushMicrotasks();

		expect(refreshRequests).toBe(1);
		const refreshStartedEvent = events.find(
			(event) => event.type === TokenSetAuthEventType.AuthRefreshStarted,
		);
		expect(refreshStartedEvent).toEqual(
			expect.objectContaining({
				type: TokenSetAuthEventType.AuthRefreshStarted,
				payload: expect.objectContaining({
					source: TokenSetAuthFlowSource.Timer,
					refreshBarrierId: expect.any(String),
				}),
			}),
		);
		const refreshBarrierId = refreshStartedEvent?.payload.refreshBarrierId;
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: TokenSetAuthEventType.AuthRefreshJoined,
					payload: expect.objectContaining({
						source: TokenSetAuthFlowSource.RouteGuard,
						clientKey: "confluence",
						logicalClientId: "wiki-main",
						providerFamily: "authentik",
						requirementId: "confluence-oidc",
						url: "/confluence",
						refreshBarrierId,
					}),
				}),
				expect.objectContaining({
					type: TokenSetAuthEventType.AuthRefreshJoined,
					payload: expect.objectContaining({
						source: TokenSetAuthFlowSource.HttpInterceptor,
						url: "https://api.example.com/wiki/rest/api/content",
						refreshBarrierId,
					}),
				}),
			]),
		);

		refreshResponse.resolve({
			status: 200,
			headers: { "content-type": "application/json" },
			body: {
				access_token: "fresh-at",
				refresh_token: "fresh-rt",
				access_token_expires_at: "2026-01-01T01:00:00Z",
			},
		});

		await expect(routeAdmission).resolves.toEqual(
			expect.objectContaining({
				status: EnsureAuthForResourceStatus.Authenticated,
			}),
		);
		await expect(protectedRequest).resolves.toEqual(
			expect.objectContaining({
				status: EnsureAuthForResourceStatus.AuthorizationHeaderResolved,
				authorizationHeader: "Bearer fresh-at",
			}),
		);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: TokenSetAuthEventType.AuthRefreshSucceeded,
					payload: expect.objectContaining({
						source: TokenSetAuthFlowSource.Timer,
						refreshBarrierId,
						hasRefreshMaterial: true,
					}),
				}),
			]),
		);
		expect(refreshRequests).toBe(1);
	});

	it("emits authorization header events with opaque token handles", async () => {
		const transport = createTestTransport(() => ({
			status: 500,
			headers: {},
			body: null,
		}));
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);
		const events: Array<unknown> = [];
		client.authEvents.subscribe({ next: (event) => events.push(event) });

		client.restoreState({
			tokens: {
				accessToken: "fresh-at",
				accessTokenExpiresAt: "2026-01-01T01:00:00Z",
				refreshMaterial: "refresh-secret",
			},
			metadata: {},
		});

		const result = await client.ensureAuthForResource({
			source: TokenSetAuthFlowSource.AuthorizedTransport,
			needsAuthorizationHeader: true,
			forceRefreshWhenDue: true,
			clientKey: "confluence",
		});

		expect(result.status).toBe(
			EnsureAuthForResourceStatus.AuthorizationHeaderResolved,
		);
		if (
			result.status !== EnsureAuthForResourceStatus.AuthorizationHeaderResolved
		) {
			throw new Error("Expected an authorization header result");
		}
		expect(result.authorizationHeader).toBe("Bearer fresh-at");
		expect(result.tokenHandle?.clientKey).toBe("confluence");

		const serializedEvents = JSON.stringify(events);
		expect(serializedEvents).not.toContain("fresh-at");
		expect(serializedEvents).not.toContain("refresh-secret");
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: TokenSetAuthEventType.AuthorizationHeaderResolved,
					payload: expect.objectContaining({
						tokenHandle: expect.objectContaining({
							clientKey: "confluence",
						}),
					}),
				}),
			]),
		);
	});

	it("clears state instead of reusing a stale bearer when refresh fails", async () => {
		const transport = createTestTransport(() => ({
			status: 401,
			headers: { "content-type": "application/json" },
			body: { error: "invalid_grant" },
		}));
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		client.restoreState({
			tokens: {
				accessToken: "expired-at",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
				refreshMaterial: "rt",
			},
			metadata: {},
		});

		expect(await client.ensureAuthorizationHeader()).toBeNull();
		expect(client.state.get()).toBeNull();
	});

	it("persists callback state, supports explicit restore, and only clears on explicit clear", async () => {
		const persistentStore = createInMemoryRecordStore();
		const transport = createTestTransport((request): HttpResponse => {
			if (request.url.endsWith("/metadata/redeem")) {
				return {
					status: 200,
					headers: {} as Record<string, string>,
					body: {
						metadata: {
							principal: {
								subject: "user-1",
								displayName: "User One",
							},
						},
					},
				};
			}

			throw new Error(`Unexpected request: ${request.url}`);
		});
		const { runtime } = createTestRuntime(transport, { persistentStore });
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		const snapshot = await client.handleCallback(
			"access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-12-31T00%3A00%3A00Z&metadata_redemption_id=meta-1",
		);
		const raw = await persistentStore.get(DEFAULT_PERSISTENCE_KEY);

		expect(snapshot.tokens.accessToken).toBe("callback-at");
		expect(raw).not.toBeNull();
		expect(JSON.parse(raw ?? "")).toMatchObject({
			version: 1,
			value: {
				tokens: {
					accessToken: "callback-at",
					refreshMaterial: "callback-rt",
				},
			},
		});

		const restoredRuntime = createTestRuntime(
			createTestTransport(() => ({
				status: 500,
				headers: {},
			})),
			{ persistentStore },
		).runtime;
		const restoredClient = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			restoredRuntime,
		);
		const restored = await restoredClient.restorePersistedState();

		expect(restored?.tokens.accessToken).toBe("callback-at");
		expect(restored?.metadata.principal?.displayName).toBe("User One");

		client.dispose();
		expect(await persistentStore.get(DEFAULT_PERSISTENCE_KEY)).not.toBeNull();

		await client.clearPersistedState();
		expect(await persistentStore.get(DEFAULT_PERSISTENCE_KEY)).toBeNull();
	});

	it.each([
		{
			name: "invalid_json",
			raw: "{not-json",
		},
		{
			name: "unsupported_version",
			raw: JSON.stringify({
				version: 99,
				storedAt: Date.parse("2026-01-01T00:00:00Z"),
				value: {
					tokens: {
						accessToken: "at",
					},
					metadata: {},
				},
			}),
		},
		{
			name: "invalid_snapshot",
			raw: JSON.stringify({
				version: 1,
				storedAt: Date.parse("2026-01-01T00:00:00Z"),
				value: {
					tokens: {},
					metadata: {},
				},
			}),
		},
	])("safely discards persisted $name records during restore", async ({
		raw,
	}) => {
		const persistentStore = createInMemoryRecordStore();
		const trace = new TestTraceCollector();
		await persistentStore.set(DEFAULT_PERSISTENCE_KEY, raw);

		const { runtime } = createTestRuntime(
			createTestTransport(() => ({
				status: 500,
				headers: {},
			})),
			{
				persistentStore,
				traceSink: trace,
			},
		);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await expect(client.restorePersistedState()).resolves.toBeNull();

		expect(client.state.get()).toBeNull();
		expect(await persistentStore.get(DEFAULT_PERSISTENCE_KEY)).toBeNull();
		expect(trace.events.map((event) => event.type)).toContain(
			"backend_oidc.state.restore_discarded",
		);
	});

	it("updates persisted state after a successful refresh", async () => {
		const persistentStore = createInMemoryRecordStore();
		const transport = createTestTransport(() => ({
			status: 200,
			headers: { "content-type": "application/json" },
			body: {
				access_token: "refreshed-at",
				refresh_token: "refreshed-rt",
				access_token_expires_at: "2026-12-31T00:00:00Z",
			},
		}));
		const { runtime } = createTestRuntime(transport, { persistentStore });
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		client.restoreState({
			tokens: {
				accessToken: "old-at",
				refreshMaterial: "old-rt",
				accessTokenExpiresAt: "2026-01-01T00:02:00Z",
			},
			metadata: {},
		});

		await client.refresh();

		expect(
			JSON.parse((await persistentStore.get(DEFAULT_PERSISTENCE_KEY)) ?? ""),
		).toMatchObject({
			value: {
				tokens: {
					accessToken: "refreshed-at",
					refreshMaterial: "refreshed-rt",
				},
			},
		});
	});

	it("cancels in-flight refresh work on dispose and prevents future scheduled refreshes", async () => {
		const deferred = createDeferred<HttpResponse>();
		const transport = createTestTransport(async () => await deferred.promise);
		const { runtime, scheduler } = createTestRuntime(transport);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		client.restoreState({
			tokens: {
				accessToken: "at",
				refreshMaterial: "rt",
				accessTokenExpiresAt: "2026-01-01T00:02:00Z",
			},
			metadata: {},
		});

		const refreshPromise = client.refresh();
		client.dispose();

		expect(scheduler.pendingCount).toBe(0);
		expect(client.state.get()).toBeNull();

		deferred.resolve({
			status: 200,
			headers: { "content-type": "application/json" },
			body: {
				access_token: "late-at",
				refresh_token: "late-rt",
				access_token_expires_at: "2026-12-31T00:00:00Z",
			},
		});

		await expect(refreshPromise).rejects.toMatchObject({
			name: "ClientError",
			kind: "cancelled",
		});
		expect(client.state.get()).toBeNull();
	});

	it("aborts in-flight fetch transport requests when disposed", async () => {
		const fetchSpy = vi.fn((_input: string, init?: RequestInit) => {
			const signal = init?.signal;
			return new Promise<Response>((_resolve, reject) => {
				signal?.addEventListener("abort", () => {
					reject(createAbortError());
				});
			});
		});
		vi.stubGlobal("fetch", fetchSpy);

		const { runtime, scheduler } = createTestRuntime(createFetchTransport());
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		client.restoreState({
			tokens: {
				accessToken: "at",
				refreshMaterial: "rt",
				accessTokenExpiresAt: "2026-01-01T00:02:00Z",
			},
			metadata: {},
		});

		const refreshPromise = client.refresh();
		client.dispose();

		await expect(refreshPromise).rejects.toMatchObject({
			name: "ClientError",
			kind: "cancelled",
			code: "backend_oidc.client_disposed",
		});
		expect(scheduler.pendingCount).toBe(0);
		expect(client.state.get()).toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("emits trace events for the callback path", async () => {
		const trace = new TestTraceCollector();
		const transport = createTestTransport((request): HttpResponse => {
			if (request.url.endsWith("/metadata/redeem")) {
				return {
					status: 200,
					headers: {} as Record<string, string>,
					body: {
						metadata: {
							principal: {
								subject: "user-2",
								displayName: "User Two",
							},
						},
					},
				};
			}

			throw new Error(`Unexpected request: ${request.url}`);
		});
		const { runtime } = createTestRuntime(transport, { traceSink: trace });
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await client.handleCallback(
			"access_token=trace-at&id_token=trace-idt&refresh_token=trace-rt&expires_at=2026-12-31T00%3A00%3A00Z&metadata_redemption_id=meta-trace",
		);

		expect(trace.events.map((event) => event.type)).toEqual(
			expect.arrayContaining([
				"backend_oidc.callback.started",
				"backend_oidc.metadata_redemption.started",
				"backend_oidc.metadata_redemption.succeeded",
				"backend_oidc.refresh.scheduled",
				"backend_oidc.callback.succeeded",
			]),
		);
	});

	it("emits trace events for restore, scheduled refresh, and refresh completion", async () => {
		const trace = new TestTraceCollector();
		const transport = createTestTransport((request): HttpResponse => {
			if (request.url.endsWith("/metadata/redeem")) {
				return {
					status: 200,
					headers: {} as Record<string, string>,
					body: {
						metadata: {
							source: {
								kind: "refresh_token",
							},
						},
					},
				};
			}

			return {
				status: 200,
				headers: { "content-type": "application/json" },
				body: {
					access_token: "next-at",
					refresh_token: "next-rt",
					access_token_expires_at: "2026-01-01T00:04:00Z",
					metadata_redemption_id: "meta-refresh",
				},
			};
		});
		const { runtime, scheduler } = createTestRuntime(transport, {
			traceSink: trace,
		});
		const client = new BackendOidcModeClient(
			{
				baseUrl: BASE_URL,
				refreshWindowMs: 60_000,
			},
			runtime,
		);

		client.restoreState({
			tokens: {
				accessToken: "seed-at",
				refreshMaterial: "seed-rt",
				accessTokenExpiresAt: "2026-01-01T00:01:30Z",
			},
			metadata: {},
		});

		scheduler.advanceAndFlush(30_000);
		await flushMicrotasks();

		expect(trace.events.map((event) => event.type)).toEqual(
			expect.arrayContaining([
				"backend_oidc.state.restored",
				"backend_oidc.refresh.scheduled",
				"backend_oidc.refresh.fired",
				"backend_oidc.refresh.started",
				"backend_oidc.metadata_redemption.started",
				"backend_oidc.metadata_redemption.succeeded",
				"backend_oidc.refresh.succeeded",
			]),
		);
	});

	it("correlates fragment callback lifecycle with nested backend traces", async () => {
		const trace = new InMemoryTraceCollector();
		const transport = createTestTransport((request): HttpResponse => {
			if (request.url.endsWith("/metadata/redeem")) {
				return {
					status: 200,
					headers: {} as Record<string, string>,
					body: {
						metadata: {
							principal: {
								subject: "user-op",
								displayName: "User Op",
							},
						},
					},
				};
			}

			throw new Error(`Unexpected request: ${request.url}`);
		});
		const { runtime } = createTestRuntime(transport, { traceSink: trace });
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await client.handleCallback(
			"access_token=trace-at&id_token=trace-idt&refresh_token=trace-rt&expires_at=2026-12-31T00%3A00%3A00Z&metadata_redemption_id=meta-op",
		);

		const callbackStarted = trace.ofType("backend_oidc.callback.started")[0];
		const operationId = callbackStarted?.operationId;

		expect(operationId).toBeTruthy();
		expect(
			trace.ofType("backend_oidc.metadata_redemption.started")[0]?.operationId,
		).toBe(operationId);
		expect(
			trace.ofType("backend_oidc.callback.succeeded")[0]?.operationId,
		).toBe(operationId);
		expect(
			trace.assertOperationLifecycle(operationId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					attributes: expect.objectContaining({
						operationName: "backend_oidc.callback",
						flow: "callback.fragment",
					}),
				}),
			]),
		);
	});

	it("treats callback body as the same callback operation story", async () => {
		const trace = new InMemoryTraceCollector();
		const transport = createTestTransport(() => {
			throw new Error("callback body should not hit transport");
		});
		const { runtime } = createTestRuntime(transport, { traceSink: trace });
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await client.handleCallbackBody({
			access_token: "body-at",
			id_token: "body-idt",
			refresh_token: "body-rt",
			access_token_expires_at: "2026-12-31T00:00:00Z",
			metadata: {
				principal: {
					subject: "body-user",
					display_name: "Body User",
				},
			},
		});

		const callbackStarted = trace.ofType("backend_oidc.callback.started")[0];
		const operationId = callbackStarted?.operationId;

		expect(operationId).toBeTruthy();
		expect(
			trace.ofType("backend_oidc.callback.succeeded")[0]?.operationId,
		).toBe(operationId);
		expect(
			trace.assertOperationLifecycle(operationId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					attributes: expect.objectContaining({
						operationName: "backend_oidc.callback",
						flow: "callback.body",
					}),
				}),
			]),
		);
	});

	it("correlates refresh lifecycle with nested redemption traces", async () => {
		const trace = new InMemoryTraceCollector();
		const transport = createTestTransport((request): HttpResponse => {
			if (request.url.endsWith("/metadata/redeem")) {
				return {
					status: 200,
					headers: {} as Record<string, string>,
					body: {
						metadata: {
							source: {
								kind: "refresh_token",
							},
						},
					},
				};
			}

			return {
				status: 200,
				headers: { "content-type": "application/json" },
				body: {
					access_token: "next-at",
					refresh_token: "next-rt",
					access_token_expires_at: "2026-01-01T00:04:00Z",
					metadata_redemption_id: "meta-refresh-op",
				},
			};
		});
		const { runtime } = createTestRuntime(transport, { traceSink: trace });
		const client = new BackendOidcModeClient(
			{
				baseUrl: BASE_URL,
				refreshWindowMs: 60_000,
			},
			runtime,
		);

		client.restoreState({
			tokens: {
				accessToken: "seed-at",
				refreshMaterial: "seed-rt",
				accessTokenExpiresAt: "2026-01-01T00:01:30Z",
			},
			metadata: {},
		});

		await client.refresh();

		const refreshStarted = trace.ofType("backend_oidc.refresh.started")[0];
		const operationId = refreshStarted?.operationId;

		expect(operationId).toBeTruthy();
		expect(
			trace.ofType("backend_oidc.metadata_redemption.started")[0]?.operationId,
		).toBe(operationId);
		expect(trace.ofType("backend_oidc.refresh.succeeded")[0]?.operationId).toBe(
			operationId,
		);
		expect(
			trace.assertOperationLifecycle(operationId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					attributes: expect.objectContaining({
						operationName: "backend_oidc.refresh",
					}),
				}),
			]),
		);
	});
});

function createAbortError(): Error {
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
}
