import type {
	CancelableHandle,
	ClientRuntime,
	HttpRequest,
	HttpResponse,
	HttpTransport,
	TraceEvent,
	TraceEventSinkTrait,
} from "@securitydept/client";
import { createInMemoryRecordStore } from "@securitydept/client";
import { createFetchTransport } from "@securitydept/client/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendOidcMediatedModeClient } from "../client";

const BASE_URL = "https://api.example.com";
const DEFAULT_PERSISTENCE_KEY =
	"securitydept.token_set_context:v1:https://api.example.com";

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
		persistentStore: options?.persistentStore,
	};

	return { runtime, clock, scheduler };
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 6; index += 1) {
		await Promise.resolve();
	}
}

describe("BackendOidcMediatedModeClient", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("refreshes tokens from a redirect fragment", async () => {
		const transport = createTestTransport(() => ({
			status: 302,
			headers: {
				location:
					"https://app.example.com/#access_token=new-at&refresh_token=new-rt&expires_at=2026-12-31T00%3A00%3A00Z",
			},
		}));
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcMediatedModeClient(
			{ baseUrl: BASE_URL },
			runtime,
		);

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

	it("throws when a refresh redirect has no Location header", async () => {
		const transport = createTestTransport(() => ({
			status: 302,
			headers: {},
		}));
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcMediatedModeClient(
			{ baseUrl: BASE_URL },
			runtime,
		);

		client.restoreState({
			tokens: { accessToken: "at", refreshMaterial: "rt" },
			metadata: {},
		});

		await expect(client.refresh()).rejects.toThrow(/missing Location/i);
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
		const client = new BackendOidcMediatedModeClient(
			{ baseUrl: BASE_URL },
			runtime,
		);

		const snapshot = await client.handleCallback(
			"access_token=callback-at&refresh_token=callback-rt&expires_at=2026-12-31T00%3A00%3A00Z&metadata_redemption_id=meta-1",
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
		const restoredClient = new BackendOidcMediatedModeClient(
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
		const client = new BackendOidcMediatedModeClient(
			{ baseUrl: BASE_URL },
			runtime,
		);

		await expect(client.restorePersistedState()).resolves.toBeNull();

		expect(client.state.get()).toBeNull();
		expect(await persistentStore.get(DEFAULT_PERSISTENCE_KEY)).toBeNull();
		expect(trace.events.map((event) => event.type)).toContain(
			"token_set.state.restore_discarded",
		);
	});

	it("updates persisted state after a successful refresh", async () => {
		const persistentStore = createInMemoryRecordStore();
		const transport = createTestTransport(() => ({
			status: 302,
			headers: {
				location:
					"https://app.example.com/#access_token=refreshed-at&refresh_token=refreshed-rt&expires_at=2026-12-31T00%3A00%3A00Z",
			},
		}));
		const { runtime } = createTestRuntime(transport, { persistentStore });
		const client = new BackendOidcMediatedModeClient(
			{ baseUrl: BASE_URL },
			runtime,
		);

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
		const client = new BackendOidcMediatedModeClient(
			{ baseUrl: BASE_URL },
			runtime,
		);

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
			status: 302,
			headers: {
				location:
					"https://app.example.com/#access_token=late-at&refresh_token=late-rt&expires_at=2026-12-31T00%3A00%3A00Z",
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
		const client = new BackendOidcMediatedModeClient(
			{ baseUrl: BASE_URL },
			runtime,
		);

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
			code: "token_set.client_disposed",
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
		const client = new BackendOidcMediatedModeClient(
			{ baseUrl: BASE_URL },
			runtime,
		);

		await client.handleCallback(
			"access_token=trace-at&refresh_token=trace-rt&expires_at=2026-12-31T00%3A00%3A00Z&metadata_redemption_id=meta-trace",
		);

		expect(trace.events.map((event) => event.type)).toEqual(
			expect.arrayContaining([
				"token_set.callback.started",
				"token_set.metadata_redemption.started",
				"token_set.metadata_redemption.succeeded",
				"token_set.refresh.scheduled",
				"token_set.callback.succeeded",
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
				status: 302,
				headers: {
					location:
						"https://app.example.com/#access_token=next-at&refresh_token=next-rt&expires_at=2026-01-01T00%3A04%3A00Z&metadata_redemption_id=meta-refresh",
				},
			};
		});
		const { runtime, scheduler } = createTestRuntime(transport, {
			traceSink: trace,
		});
		const client = new BackendOidcMediatedModeClient(
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
				"token_set.state.restored",
				"token_set.refresh.scheduled",
				"token_set.refresh.fired",
				"token_set.refresh.started",
				"token_set.metadata_redemption.started",
				"token_set.metadata_redemption.succeeded",
				"token_set.refresh.succeeded",
			]),
		);
	});
});

function createAbortError(): Error {
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
}
