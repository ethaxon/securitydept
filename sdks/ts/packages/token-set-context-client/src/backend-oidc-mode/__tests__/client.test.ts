import type {
	ExternalTransportTrait,
	FoundationEnvironment,
	HttpRequest,
	HttpResponse,
	ReadableReplaySignalTrait,
	TraceEvent,
	TraceEventSinkTrait,
} from "@securitydept/client";
import {
	createExternalTransportForFetch,
	createInMemoryRecordStore,
	createOperationTracer,
	createSpan,
	createSpanContextHostForTest,
	OperationTraceEventType,
} from "@securitydept/client";
import { InMemoryTraceCollector } from "@securitydept/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AuthCheckStatus,
	type TokenSetAuthEvent,
	TokenSetAuthEventType,
	TokenSetPersistenceEventType,
} from "../../orchestration";
import { BackendOidcModeClient } from "../runtime/client";

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

class TestTraceCollector implements TraceEventSinkTrait {
	readonly events: TraceEvent[] = [];

	record(event: TraceEvent): void {
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
		traceSink?: TraceEventSinkTrait;
		telemetry?: FoundationEnvironment["telemetry"];
		persistentStorage?: FoundationEnvironment["persistentStorage"];
		spanContext?: FoundationEnvironment["spanContext"];
	},
) {
	const time = new TestTime(options?.now ?? Date.parse("2026-01-01T00:00:00Z"));
	const runtime: FoundationEnvironment = {
		transport: externalTransport,
		time,
		spanContext: options?.spanContext,
		telemetry: options?.telemetry ?? {
			traceSink: options?.traceSink,
			operationTracer: createOperationTracer({
				time,
				traceSink: options?.traceSink,
				spanContext: options?.spanContext,
			}),
		},
		persistentStorage: options?.persistentStorage,
	};

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

		client.restoreState({
			tokens: {
				accessToken: "old-at",
				refreshMaterial: "old-rt",
			},
			metadata: {},
		});

		const refreshPromise = client.refreshState();
		expect(client.authOperations.refreshPending.get()).toBe(true);
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

		client.restoreState({
			tokens: { accessToken: "at", refreshMaterial: "rt" },
			metadata: {},
		});

		const refreshPromise = client.refreshState();
		expect(client.authOperations.refreshPending.get()).toBe(true);
		await expect(refreshPromise).rejects.toThrow(/missing access_token/i);
		expect(client.authOperations.refreshPending.get()).toBe(false);
		expect(client.lastAuthError.get()).toBeInstanceOf(Error);
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

		expect(expectReplayValue(client.authorizationHeaderValue)).toBeUndefined();
		expect(expectReplayValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"expired-at",
		);
	});

	it("coalesces concurrent manual auth checks through one refresh", async () => {
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

		const firstCheck = client.authCheck();
		const secondCheck = client.authCheck();
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

		await expect(firstCheck).resolves.toEqual(
			expect.objectContaining({
				status: AuthCheckStatus.Authenticated,
				authorizationHeader: "Bearer fresh-at",
			}),
		);
		await expect(secondCheck).resolves.toEqual(
			expect.objectContaining({
				status: AuthCheckStatus.Authenticated,
				authorizationHeader: "Bearer fresh-at",
			}),
		);
		expect(refreshRequests).toBe(1);
	});

	it("emits refresh lifecycle events for manual auth checks", async () => {
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

		const authCheck = client.authCheck({
			reason: "manual_route_check",
		});
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

		await expect(authCheck).resolves.toEqual(
			expect.objectContaining({
				status: AuthCheckStatus.Authenticated,
				authorizationHeader: "Bearer fresh-at",
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

	it("returns authorization headers without emitting raw token events", async () => {
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

		const result = await client.authCheck();

		expect(result.status).toBe(AuthCheckStatus.Authenticated);
		expect(result.authorizationHeader).toBe("Bearer fresh-at");

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

		client.restoreState({
			tokens: {
				accessToken: "expired-at",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
				refreshMaterial: "rt",
			},
			metadata: {},
		});

		const result = await client.authCheck();
		expect(result.status).toBe(AuthCheckStatus.Failed);
		expect(expectReplayValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"expired-at",
		);
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

		client.dispose();
		expect(await persistentStorage.get(DEFAULT_PERSISTENCE_KEY)).not.toBeNull();

		await client.clearPersistedState();
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
				telemetry: { traceSink: trace },
			},
		);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await expect(client.restorePersistedState()).resolves.toBeNull();
		await flushMicrotasks();

		expect(expectReplayValue(client.authSnapshot)).toBeNull();
		expect(await persistentStorage.get(DEFAULT_PERSISTENCE_KEY)).toBeNull();
		expect(trace.events.map((event) => event.type)).toContain(
			"backend_oidc.state.restore_discarded",
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

		client.restoreState({
			tokens: {
				accessToken: "old-at",
				refreshMaterial: "old-rt",
				accessTokenExpiresAt: "2026-01-01T00:02:00Z",
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
		const events: string[] = [];
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
		const subscription = client.persistenceEvents.subscribe({
			next(event) {
				events.push(event.type);
			},
		});

		client.restoreState({
			tokens: {
				accessToken: "old-at",
				refreshMaterial: "old-rt",
				accessTokenExpiresAt: "2026-01-01T00:02:00Z",
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
		expect(events).toContain(
			TokenSetPersistenceEventType.PersistenceSyncFailed,
		);
		subscription.unsubscribe();
	});

	it("cancels in-flight refresh work on dispose and prevents future scheduled refreshes", async () => {
		const deferred = createDeferred<HttpResponse>();
		const transport = createTestTransport(async () => await deferred.promise);
		const { runtime, time } = createTestRuntime(transport);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		client.restoreState({
			tokens: {
				accessToken: "at",
				refreshMaterial: "rt",
				accessTokenExpiresAt: "2026-01-01T00:02:00Z",
			},
			metadata: {},
		});

		const refreshPromise = client.refreshState();
		client.dispose();

		expect(time.pendingCount).toBe(0);
		expect(expectReplayValue(client.authSnapshot)).toBeNull();

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
		expect(expectReplayValue(client.authSnapshot)).toBeNull();
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

		const { runtime, time } = createTestRuntime(
			createExternalTransportForFetch(),
		);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		client.restoreState({
			tokens: {
				accessToken: "at",
				refreshMaterial: "rt",
				accessTokenExpiresAt: "2026-01-01T00:02:00Z",
			},
			metadata: {},
		});

		const refreshPromise = client.refreshState();
		client.dispose();

		await expect(refreshPromise).rejects.toMatchObject({
			name: "ClientError",
			kind: "cancelled",
			code: "backend_oidc.client_disposed",
		});
		expect(time.pendingCount).toBe(0);
		expect(expectReplayValue(client.authSnapshot)).toBeNull();
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
		const { runtime, time } = createTestRuntime(transport, {
			telemetry: { traceSink: trace },
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

		time.advanceAndFlush(30_000);
		await flushMicrotasks();
		await flushMicrotasks();

		expect(trace.events.map((event) => event.type)).toEqual(
			expect.arrayContaining([
				"backend_oidc.state.restored",
				"backend_oidc.refresh.fired",
				"backend_oidc.refresh.started",
				"backend_oidc.metadata_redemption.started",
				"backend_oidc.metadata_redemption.succeeded",
				"backend_oidc.refresh.succeeded",
			]),
		);
	});

	it("forks queued auth workflows from the current span context", async () => {
		const trace = new InMemoryTraceCollector();
		const spanContext = createSpanContextHostForTest();
		const rootSpan = createSpan({
			idFactory: () => "span_root",
		});
		const { runtime } = createTestRuntime(
			createTestTransport(() => ({
				status: 200,
				headers: {},
			})),
			{
				traceSink: trace,
				spanContext,
			},
		);
		const client = new BackendOidcModeClient({ baseUrl: BASE_URL }, runtime);

		await spanContext.runWithSpan(rootSpan, async () => {
			await client.authCheck();
		});

		const taskStarted = trace.ofType(
			"backend_oidc.auth_workflow.task.started",
		)[0];
		expect(taskStarted?.spanId).toBeTruthy();
		expect(taskStarted?.parentSpanId).toBe("span_root");
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

		await client.refreshState();

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
