import {
	createBaseTransportForStdFetch,
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
	type ExternalTransportTrait,
	type FoundationEnvironment,
	type HttpRequest,
	type HttpResponse,
	OperationTraceEventType,
	type ReadableReplaySignalTrait,
	type TracingEvent,
	type TracingSubscriberTrait,
} from "@securitydept/client";
import { InMemoryTraceCollector } from "@securitydept/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type TokenSetAuthEvent,
	TokenSetAuthEventType,
} from "../../orchestration";
import { BackendOidcModeClient } from "../client/client";

const BASE_URL = "https://api.example.com";
const DEFAULT_PERSISTENCE_KEY =
	"securitydept.backend_oidc:v1:https://api.example.com";

function expectReplayValue<T>(signal: ReadableReplaySignalTrait<T>): T {
	const slot = signal.get();
	expect(slot.kind).toBe("value");
	if (slot.kind !== "value") {
		throw new Error("Expected replay signal value.");
	}
	return slot.value;
}

class TestTime {
	private readonly _tasks: Array<{
		executeAt: number;
		fn: () => void;
		cancelled: boolean;
	}> = [];

	constructor(private _now: number) {}

	now(): number {
		return this._now;
	}

	advance(ms: number): void {
		this._now += ms;
	}

	setTimeout(fn: () => void, delayMs: number): unknown {
		const task = {
			executeAt: this.now() + delayMs,
			fn,
			cancelled: false,
		};
		this._tasks.push(task);
		return task;
	}

	clearTimeout(handle: unknown): void {
		if (
			typeof handle === "object" &&
			handle !== null &&
			"cancelled" in handle
		) {
			(handle as { cancelled: boolean }).cancelled = true;
		}
	}

	advanceAndFlush(ms: number): void {
		this.advance(ms);
		const ready = this._tasks
			.filter((task) => !task.cancelled && task.executeAt <= this.now())
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

class TestTraceCollector implements TracingSubscriberTrait {
	readonly events: TracingEvent[] = [];

	record(event: TracingEvent): void {
		this.events.push(event);
	}
}

function createTestTransport(
	handler: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>,
): ExternalTransportTrait {
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
	externalTransport: ExternalTransportTrait,
	options?: {
		now?: number;
		tracing?: FoundationEnvironment["tracing"];
		persistentStorage?: FoundationEnvironment["persistentStorage"];
		span?: FoundationEnvironment["span"];
	},
) {
	const time = new TestTime(options?.now ?? Date.parse("2026-01-01T00:00:00Z"));
	const runtime = createFoundationEnvironment({
		transport: externalTransport,
		time,
		span: options?.span,
		tracing: options?.tracing,
		persistentStorage: options?.persistentStorage,
	});

	return { runtime, time };
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

		await client.restoreState({
			tokens: {
				accessToken: "old-at",
				refreshMaterial: "old-rt",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
			},
			metadata: {},
		});

		const refreshPromise = client.refreshState();
		const result = await refreshPromise;

		expect(result).not.toBeNull();
		expect(result?.tokens.accessToken).toBe("new-at");
		expect(result?.tokens.refreshMaterial).toBe("new-rt");
		expect(result?.tokens.accessTokenExpiresAt).toBe("2026-12-31T00:00:00Z");
		expect(client.authOperations.refreshPending.get()).toBe(false);
		expect(expectReplayValue(client.authSnapshot)).toBe(result);
		expect(expectReplayValue(client.authorizationHeaderValue)).toBe(
			"Bearer new-at",
		);
		expect(expectReplayValue(client.isAuthenticated)).toBe(true);
		expect(client.lastAuthError.get()).toBeUndefined();
	});

	it("throws when a refresh response body is missing access_token", async () => {
		const transport = createTestTransport(() => ({
			status: 200,
			headers: { "content-type": "application/json" },
			body: { id_token: "only-id-token" },
		}));
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await client.restoreState({
			tokens: {
				accessToken: "at",
				refreshMaterial: "rt",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
			},
			metadata: {},
		});

		const refreshPromise = client.refreshState();
		await expect(refreshPromise).resolves.toBeNull();
		expect(client.authOperations.refreshPending.get()).toBe(false);
		expect(client.lastAuthError.get()).toBeInstanceOf(Error);
	});

	it("projects an authorization header whenever access token material exists", async () => {
		const transport = createTestTransport(() => ({
			status: 500,
			headers: {},
			body: null,
		}));
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await client.restoreState({
			tokens: {
				accessToken: "expired-at",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
			},
			metadata: {},
		});

		expect(expectReplayValue(client.authorizationHeaderValue)).toBe(
			"Bearer expired-at",
		);
		expect(expectReplayValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"expired-at",
		);
	});

	it("emits refresh lifecycle events for manual refreshState", async () => {
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

		await client.restoreState({
			tokens: {
				accessToken: "refresh-due-at",
				accessTokenExpiresAt: "2026-01-01T00:00:10Z",
				refreshMaterial: "rt",
			},
			metadata: {},
		});

		const refresh = client.refreshState();
		await flushMicrotasks();

		expect(refreshRequests).toBe(1);
		const refreshStartedEvent = events.find(
			(event) => event.type === TokenSetAuthEventType.AuthRefreshStarted,
		);
		expect(refreshStartedEvent).toEqual(
			expect.objectContaining({
				type: TokenSetAuthEventType.AuthRefreshStarted,
				payload: expect.any(Object),
			}),
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

		await expect(refresh).resolves.toEqual(
			expect.objectContaining({
				tokens: expect.objectContaining({
					accessToken: "fresh-at",
					refreshMaterial: "fresh-rt",
				}),
			}),
		);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: TokenSetAuthEventType.AuthRefreshSucceeded,
					payload: expect.objectContaining({
						hasRefreshMaterial: true,
					}),
				}),
			]),
		);
		expect(refreshRequests).toBe(1);
	});

	it("projects authorization headers without leaking raw token material into auth events", async () => {
		const transport = createTestTransport(() => ({
			status: 500,
			headers: {},
			body: null,
		}));
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);
		const events: Array<unknown> = [];
		client.authEvents.subscribe({ next: (event) => events.push(event) });

		await client.restoreState({
			tokens: {
				accessToken: "fresh-at",
				accessTokenExpiresAt: "2026-01-01T01:00:00Z",
				refreshMaterial: "refresh-secret",
			},
			metadata: {},
		});

		expect(expectReplayValue(client.authorizationHeaderValue)).toBe(
			"Bearer fresh-at",
		);

		const serializedEvents = JSON.stringify(events);
		expect(serializedEvents).not.toContain("fresh-at");
		expect(serializedEvents).not.toContain("refresh-secret");
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: TokenSetAuthEventType.AuthAuthenticated,
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

		await client.restoreState({
			tokens: {
				accessToken: "expired-at",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
				refreshMaterial: "rt",
			},
			metadata: {},
		});

		await expect(client.refreshState()).resolves.toBeNull();
		expect(expectReplayValue(client.authSnapshot)).toBeNull();
		expect(expectReplayValue(client.authorizationHeaderValue)).toBeUndefined();
	});

	it("persists callback state, supports explicit restore, and only clears on explicit clear", async () => {
		const persistentStorage = createInMemoryRecordStore();
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
		const { runtime } = createTestRuntime(transport, { persistentStorage });
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		const snapshot = await client.handleCallback(
			"access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&expires_at=2026-12-31T00%3A00%3A00Z&metadata_redemption_id=meta-1",
		);
		const raw = await persistentStorage.get(DEFAULT_PERSISTENCE_KEY);

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
			{ persistentStorage },
		).runtime;
		const restoredClient = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			restoredRuntime,
		);
		const restored = await restoredClient.restorePersistedState();

		expect(restored?.tokens.accessToken).toBe("callback-at");
		expect(restored?.metadata.principal?.displayName).toBe("User One");

		expect(await persistentStorage.get(DEFAULT_PERSISTENCE_KEY)).not.toBeNull();

		await restoredClient.clearState();
		expect(await persistentStorage.get(DEFAULT_PERSISTENCE_KEY)).toBeNull();
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
		const persistentStorage = createInMemoryRecordStore();
		const trace = new TestTraceCollector();
		await persistentStorage.set(DEFAULT_PERSISTENCE_KEY, raw);

		const { runtime } = createTestRuntime(
			createTestTransport(() => ({
				status: 500,
				headers: {},
			})),
			{
				persistentStorage,
				tracing: createTracing({ subscribers: [trace] }),
			},
		);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await expect(client.restorePersistedState()).resolves.toBeNull();
		await flushMicrotasks();

		expect(expectReplayValue(client.authSnapshot)).toBeNull();
		expect(await persistentStorage.get(DEFAULT_PERSISTENCE_KEY)).toBeNull();
		expect(trace.events.map((event) => event.name)).toContain(
			"backend_oidc.restore.persisted.failed",
		);
	});

	it("updates persisted state after a successful refresh", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const transport = createTestTransport(() => ({
			status: 200,
			headers: { "content-type": "application/json" },
			body: {
				access_token: "refreshed-at",
				refresh_token: "refreshed-rt",
				access_token_expires_at: "2026-12-31T00:00:00Z",
			},
		}));
		const { runtime } = createTestRuntime(transport, { persistentStorage });
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await client.restoreState({
			tokens: {
				accessToken: "old-at",
				refreshMaterial: "old-rt",
				accessTokenExpiresAt: "2026-01-01T00:00:30Z",
			},
			metadata: {},
		});

		await client.refreshState();
		await flushMicrotasks();

		expect(
			JSON.parse((await persistentStorage.get(DEFAULT_PERSISTENCE_KEY)) ?? ""),
		).toMatchObject({
			value: {
				tokens: {
					accessToken: "refreshed-at",
					refreshMaterial: "refreshed-rt",
				},
			},
		});
	});

	it("keeps refreshed memory state even when persistence sync fails", async () => {
		const persistentStorage: NonNullable<
			FoundationEnvironment["persistentStorage"]
		> = {
			get: async () => null,
			set: async () => {
				throw new Error("disk full");
			},
			remove: async () => {},
		};
		const transport = createTestTransport(() => ({
			status: 200,
			headers: { "content-type": "application/json" },
			body: {
				access_token: "refreshed-at",
				refresh_token: "refreshed-rt",
				access_token_expires_at: "2026-12-31T00:00:00Z",
			},
		}));
		const { runtime } = createTestRuntime(transport, { persistentStorage });
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await client.restoreState({
			tokens: {
				accessToken: "old-at",
				refreshMaterial: "old-rt",
				accessTokenExpiresAt: "2026-01-01T00:00:30Z",
			},
			metadata: {},
		});

		await expect(client.refreshState()).resolves.toMatchObject({
			tokens: {
				accessToken: "refreshed-at",
				refreshMaterial: "refreshed-rt",
			},
		});
		await flushMicrotasks();

		expect(expectReplayValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"refreshed-at",
		);
		expect(client.lastAuthError.get()).toBeInstanceOf(Error);
	});

	it("stops refresh work on dispose and prevents future scheduled refreshes", async () => {
		const deferred = createDeferred<HttpResponse>();
		const transport = createTestTransport(async () => await deferred.promise);
		const { runtime, time } = createTestRuntime(transport);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await client.restoreState({
			tokens: {
				accessToken: "at",
				refreshMaterial: "rt",
				accessTokenExpiresAt: "2026-01-01T00:00:30Z",
			},
			metadata: {},
		});

		const refreshPromise = client.refreshState();
		await flushMicrotasks();
		client.dispose();

		expect(time.pendingCount).toBe(0);
		expect(expectReplayValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"at",
		);

		deferred.resolve({
			status: 200,
			headers: { "content-type": "application/json" },
			body: {
				access_token: "late-at",
				refresh_token: "late-rt",
				access_token_expires_at: "2026-12-31T00:00:00Z",
			},
		});

		await expect(refreshPromise).resolves.toBeNull();
		expect(expectReplayValue(client.authSnapshot)).toBeNull();
	});

	it("does not issue fetch transport requests once dispose wins the race", async () => {
		const fetchSpy = vi.fn((_input: string, init?: RequestInit) => {
			const signal = init?.signal;
			return new Promise<Response>((_resolve, reject) => {
				signal?.addEventListener("abort", () => {
					reject(createAbortError());
				});
			});
		});
		vi.stubGlobal("fetch", fetchSpy);

		const { runtime, time } = createTestRuntime(
			createBaseTransportForStdFetch(),
		);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await client.restoreState({
			tokens: {
				accessToken: "at",
				refreshMaterial: "rt",
				accessTokenExpiresAt: "2026-01-01T00:00:30Z",
			},
			metadata: {},
		});

		const refreshPromise = client.refreshState();
		client.dispose();

		await expect(refreshPromise).rejects.toMatchObject({
			name: "ClientError",
			kind: "cancelled",
			code: "client.cancelled",
		});
		expect(time.pendingCount).toBe(0);
		expect(expectReplayValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"at",
		);
		expect(fetchSpy).toHaveBeenCalledTimes(0);
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
		const { runtime } = createTestRuntime(transport, {
			tracing: createTracing({ subscribers: [trace] }),
		});
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await client.handleCallback(
			"access_token=trace-at&id_token=trace-idt&refresh_token=trace-rt&expires_at=2026-12-31T00%3A00%3A00Z&metadata_redemption_id=meta-trace",
		);

		expect(trace.events.map((event) => event.name)).toEqual(
			expect.arrayContaining([
				"backend_oidc.callback.started",
				"backend_oidc.metadata_redemption.started",
				"backend_oidc.metadata_redemption.succeeded",
				"backend_oidc.refreshTimer.scheduled",
				"backend_oidc.callback.succeeded",
			]),
		);
	});

	it("emits trace events for restore and scheduled refresh source firing", async () => {
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
		const { runtime, time } = createTestRuntime(transport, {
			tracing: createTracing({ subscribers: [trace] }),
		});
		const client = new BackendOidcModeClient(
			{
				baseUrl: BASE_URL,
				refreshWindowMs: 60_000,
			},
			runtime,
		);

		await client.restoreState({
			tokens: {
				accessToken: "seed-at",
				refreshMaterial: "seed-rt",
				accessTokenExpiresAt: "2026-01-01T00:01:30Z",
			},
			metadata: {},
		});

		time.advanceAndFlush(30_000);
		await flushMicrotasks();
		await flushMicrotasks();

		expect(trace.events.map((event) => event.name)).toEqual(
			expect.arrayContaining([
				"backend_oidc.state.restored",
				"backend_oidc.refreshTimer.fired",
			]),
		);
	});

	it("forks queued auth workflows from the explicit runtime span", async () => {
		const trace = new InMemoryTraceCollector();
		const rootSpan = createRootSpan({
			idFactory: () => "span_root",
		});
		const { runtime } = createTestRuntime(
			createTestTransport(() => ({
				status: 200,
				headers: { "content-type": "application/json" },
				body: {
					access_token: "root-refresh-at",
					refresh_token: "root-refresh-rt",
					access_token_expires_at: "2026-01-01T01:00:00Z",
				},
			})),
			{
				tracing: createTracing({ subscribers: [trace] }),
				span: rootSpan,
			},
		);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);
		await client.restoreState({
			tokens: {
				accessToken: "expired-at",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
				refreshMaterial: "rt",
			},
			metadata: {},
		});

		await client.refreshState();

		const taskStarted = trace.ofType("backend_oidc.refresh.started")[0];
		expect(taskStarted?.span?.id).toBeTruthy();
		expect(taskStarted?.span?.parent?.id).toBeTruthy();
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
		const { runtime } = createTestRuntime(transport, {
			tracing: createTracing({ subscribers: [trace] }),
		});
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await client.handleCallback(
			"access_token=trace-at&id_token=trace-idt&refresh_token=trace-rt&expires_at=2026-12-31T00%3A00%3A00Z&metadata_redemption_id=meta-op",
		);

		const callbackStarted = trace.ofType("backend_oidc.callback.started")[0];
		const operationSpanId = callbackStarted?.span?.id;

		expect(operationSpanId).toBeTruthy();
		expect(
			trace.ofType("backend_oidc.metadata_redemption.started")[0]?.span?.id,
		).toBe(operationSpanId);
		expect(trace.ofType("backend_oidc.callback.succeeded")[0]?.span?.id).toBe(
			operationSpanId,
		);
		expect(
			trace.assertOperationLifecycle(operationSpanId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fields: expect.objectContaining({
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
		const { runtime } = createTestRuntime(transport, {
			tracing: createTracing({ subscribers: [trace] }),
		});
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
		const operationSpanId = callbackStarted?.span?.id;

		expect(operationSpanId).toBeTruthy();
		expect(trace.ofType("backend_oidc.callback.succeeded")[0]?.span?.id).toBe(
			operationSpanId,
		);
		expect(
			trace.assertOperationLifecycle(operationSpanId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fields: expect.objectContaining({
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
		const { runtime } = createTestRuntime(transport, {
			tracing: createTracing({ subscribers: [trace] }),
		});
		const client = new BackendOidcModeClient(
			{
				baseUrl: BASE_URL,
				refreshWindowMs: 60_000,
			},
			runtime,
		);

		await client.restoreState({
			tokens: {
				accessToken: "seed-at",
				refreshMaterial: "seed-rt",
				accessTokenExpiresAt: "2026-01-01T00:01:30Z",
			},
			metadata: {},
		});

		await client.refreshState();

		const refreshStarted = trace.ofType("backend_oidc.refresh.started")[0];
		const operationSpanId = refreshStarted?.span?.id;

		expect(operationSpanId).toBeTruthy();
		expect(
			trace.ofType("backend_oidc.metadata_redemption.started")[0]?.span?.id,
		).toBe(operationSpanId);
		expect(trace.ofType("backend_oidc.refresh.succeeded")[0]?.span?.id).toBe(
			operationSpanId,
		);
		expect(
			trace.assertOperationLifecycle(operationSpanId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fields: expect.objectContaining({
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
