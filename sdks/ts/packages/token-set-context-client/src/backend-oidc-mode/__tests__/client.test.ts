import {
	appendOrReplaceCompatFragment,
	type BaseTransportTrait,
	createBaseTransportForStdFetch,
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
	type FoundationEnvironment,
	type HttpRequest,
	type HttpResponse,
	OperationTraceEventType,
	type ReadableSignalTrait,
	type ResourceSnapshot,
	ResourceStatus,
	type ResourceTrait,
	type RouterNavigationRequest,
	type RouterTrait,
	type TracingEvent,
	type TracingSubscriberTrait,
	UriReferenceString,
} from "@securitydept/client";
import { InMemoryTraceCollector } from "@securitydept/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type TokenSetAuthEvent,
	TokenSetAuthEventType,
} from "../../orchestration";
import { BackendOidcModeClient } from "../client/client";
import { BackendOidcModeErrorCode } from "../client/error-codes";
import {
	BackendOidcModeComposedTraceEventType,
	BackendOidcModeOperationEventName,
	BackendOidcModeTraceOperationName,
} from "../client/trace-events";
import { BackendOidcModeCompatFragmentKind } from "../contracts/callback";

const BASE_URL = "https://api.example.com";
const DEFAULT_PERSISTENCE_KEY =
	BackendOidcModeClient.resolveDefaultPersistenceKey(BASE_URL);

function expectSnapshotValue<T>(
	signal: ReadableSignalTrait<ResourceSnapshot<T>>,
): T {
	const snapshot = signal.get();
	if (
		snapshot.status !== "reloading" &&
		snapshot.status !== "resolved" &&
		snapshot.status !== "error"
	) {
		throw new Error("Expected resource snapshot value.");
	}
	return snapshot.value;
}

function expectResourceValue<T>(resource: ResourceTrait<T>): T {
	return resource.value.get();
}

function callbackParameters(fragment: string): Record<string, string> {
	const parameters = new URLSearchParams(fragment);
	const result: Record<string, string> = {};
	parameters.forEach((value, key) => {
		result[key] = value;
	});
	return result;
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
): BaseTransportTrait {
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
	externalTransport: BaseTransportTrait,
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

	it("round-trips callback routing keys through authorize URLs and the default resolver", async () => {
		let currentUrl = appendOrReplaceCompatFragment(
			UriReferenceString.parse("https://app.example.com/after#route"),
			{
				payload: {
					kind: BackendOidcModeCompatFragmentKind.Callback,
					callback_routing_key: "backend",
					access_token: "callback-at",
					id_token: "callback-idt",
					metadata_redemption_id: "meta-1",
				},
			},
			(input, hash) => input.setHash(hash),
		).url;
		const navigate = vi.fn(async (request: RouterNavigationRequest) => {
			currentUrl = request.url;
		});
		const router: RouterTrait = {
			currentUrl: () => currentUrl,
			navigate,
		};
		const environment = createFoundationEnvironment({
			router,
			transport: createTestTransport(() => ({
				status: 200,
				headers: {},
				body: { metadata: {} },
			})),
		});
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment, callbackRoutingKey: "backend" },
		);

		expect(client.authorizeUrl("/after")).toBe(
			`${BASE_URL}/auth/oidc/login?post_auth_redirect_uri=%2Fafter&callback_routing_key=backend`,
		);
		await expect(client.start()).resolves.toMatchObject({
			tokens: { accessToken: "callback-at" },
		});
		expect(client.callback.resource.value.get()).toMatchObject({
			kind: "handled",
			result: { tokens: { accessToken: "callback-at" } },
		});
		expect(navigate).toHaveBeenCalledOnce();
		expect(currentUrl.toString()).toBe("https://app.example.com/after#route");
	});

	it("does not consume a backend callback owned by another routing key", async () => {
		const currentUrl = appendOrReplaceCompatFragment(
			UriReferenceString.parse("https://app.example.com/after"),
			{
				payload: {
					kind: BackendOidcModeCompatFragmentKind.Callback,
					callback_routing_key: "backend-a",
					access_token: "callback-at",
				},
			},
			(input, hash) => input.setHash(hash),
		).url;
		const navigate = vi.fn();
		const environment = createFoundationEnvironment({
			router: { currentUrl: () => currentUrl, navigate },
			transport: createTestTransport(() => ({ status: 500, headers: {} })),
		});
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment, callbackRoutingKey: "backend-b" },
		);

		await expect(client.start()).resolves.toBeNull();
		expect(navigate).not.toHaveBeenCalled();
		expect(client.callback.resource.value.get()).toEqual({
			kind: "not_applicable",
		});
	});

	it("leaves a keyless callback for a standalone fallback client", async () => {
		let currentUrl = appendOrReplaceCompatFragment(
			UriReferenceString.parse("https://app.example.com/after"),
			{
				payload: {
					kind: BackendOidcModeCompatFragmentKind.Callback,
					access_token: "callback-at",
					id_token: "callback-idt",
					metadata_redemption_id: "meta-1",
				},
			},
			(input, hash) => input.setHash(hash),
		).url;
		const navigate = vi.fn(async (request: RouterNavigationRequest) => {
			currentUrl = request.url;
		});
		const environment = createFoundationEnvironment({
			router: { currentUrl: () => currentUrl, navigate },
			transport: createTestTransport(() => ({
				status: 200,
				headers: {},
				body: { metadata: {} },
			})),
		});
		const registryClient = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment, callbackRoutingKey: "backend" },
		);

		await expect(registryClient.start()).resolves.toBeNull();
		expect(registryClient.callback.resource.value.get()).toEqual({
			kind: "not_applicable",
		});
		expect(navigate).not.toHaveBeenCalled();

		const standaloneClient = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment },
		);
		await expect(standaloneClient.start()).resolves.toMatchObject({
			tokens: { accessToken: "callback-at" },
		});
		expect(navigate).toHaveBeenCalledOnce();
	});

	it("does not let a standalone fallback client consume a keyed callback", async () => {
		let currentUrl = appendOrReplaceCompatFragment(
			UriReferenceString.parse("https://app.example.com/after"),
			{
				payload: {
					kind: BackendOidcModeCompatFragmentKind.Callback,
					callback_routing_key: "backend",
					access_token: "callback-at",
					id_token: "callback-idt",
					metadata_redemption_id: "meta-1",
				},
			},
			(input, hash) => input.setHash(hash),
		).url;
		const navigate = vi.fn(async (request: RouterNavigationRequest) => {
			currentUrl = request.url;
		});
		const environment = createFoundationEnvironment({
			router: { currentUrl: () => currentUrl, navigate },
			transport: createTestTransport(() => ({
				status: 200,
				headers: {},
				body: { metadata: {} },
			})),
		});
		const standaloneClient = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment },
		);

		await expect(standaloneClient.start()).resolves.toBeNull();
		expect(standaloneClient.callback.resource.value.get()).toEqual({
			kind: "not_applicable",
		});
		expect(navigate).not.toHaveBeenCalled();

		const registryClient = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment, callbackRoutingKey: "backend" },
		);
		await expect(registryClient.start()).resolves.toMatchObject({
			tokens: { accessToken: "callback-at" },
		});
		expect(navigate).toHaveBeenCalledOnce();
	});

	it("determines auth failure when callback restoration rejects", async () => {
		const resolverError = new Error("callback resolver failed");
		const trace = new InMemoryTraceCollector();
		const environment = createFoundationEnvironment({
			transport: createTestTransport(() => ({ status: 500, headers: {} })),
			tracing: createTracing({ subscribers: [trace] }),
		});
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{
				environment,
				callbackInputResolver: async () => {
					throw resolverError;
				},
			},
		);

		await expect(client.start()).rejects.toMatchObject({
			code: BackendOidcModeErrorCode.CallbackFailed,
			cause: resolverError,
		});
		expect(client.authSnapshot.get()).toMatchObject({
			status: ResourceStatus.LoadingError,
			error: expect.objectContaining({
				code: BackendOidcModeErrorCode.CallbackFailed,
			}),
		});
		const callbackOperations = trace
			.ofType(OperationTraceEventType.Started)
			.filter(
				(event) =>
					event.fields?.operationName ===
					BackendOidcModeTraceOperationName.Callback,
			);
		expect(callbackOperations).toHaveLength(1);
		expect(
			trace.assertOperationLifecycle(callbackOperations[0]!.span.id, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Error,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fields: expect.objectContaining({ flow: "callback.restore" }),
				}),
			]),
		);
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
		const client = new BackendOidcModeClient(
			{
				baseUrl: BASE_URL,
				refresh: { sources: { refreshTimer: false } },
			},
			{ environment: runtime },
		);

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
		expect(expectSnapshotValue(client.authSnapshot)).toBe(result);
		expect(expectResourceValue(client.authorizationHeaderValue)).toBe(
			"Bearer new-at",
		);
		expect(expectResourceValue(client.isAuthenticated)).toBe(true);
	});

	it("throws when a refresh response body is missing access_token", async () => {
		const transport = createTestTransport(() => ({
			status: 200,
			headers: { "content-type": "application/json" },
			body: { id_token: "only-id-token" },
		}));
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment: runtime },
		);

		await client.restoreState({
			tokens: {
				accessToken: "at",
				refreshMaterial: "rt",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
			},
			metadata: {},
		});

		const refreshPromise = client.refreshState();
		await expect(refreshPromise).rejects.toBeInstanceOf(Error);
		expect(client.authOperations.refreshPending.get()).toBe(false);
		expect(client.authSnapshot.get()).toMatchObject({
			status: "error",
			value: expect.objectContaining({
				tokens: expect.objectContaining({ accessToken: "at" }),
			}),
		});
	});

	it("projects an authorization header whenever access token material exists", async () => {
		const transport = createTestTransport(() => ({
			status: 500,
			headers: {},
			body: null,
		}));
		const { runtime } = createTestRuntime(transport);
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment: runtime },
		);

		await client.restoreState({
			tokens: {
				accessToken: "expired-at",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
			},
			metadata: {},
		});

		expect(expectResourceValue(client.authorizationHeaderValue)).toBe(
			"Bearer expired-at",
		);
		expect(expectSnapshotValue(client.authSnapshot)?.tokens.accessToken).toBe(
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
			{
				baseUrl: BASE_URL,
				refresh: {
					tokenFreshness: { refreshWindowMs: 0 },
					sources: { refreshTimer: false },
				},
			},
			{ environment: runtime },
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
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment: runtime },
		);
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

		expect(expectResourceValue(client.authorizationHeaderValue)).toBe(
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
		const client = new BackendOidcModeClient(
			{
				baseUrl: BASE_URL,
				refresh: { sources: { refreshTimer: false } },
			},
			{ environment: runtime },
		);

		await client.restoreState({
			tokens: {
				accessToken: "expired-at",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
				refreshMaterial: "rt",
			},
			metadata: {},
		});

		await expect(client.refreshState()).rejects.toMatchObject({
			name: "TokenSetAuthorizationRevocationError",
			reason: "invalid_grant",
		});
		expect(expectSnapshotValue(client.authSnapshot)).toBeNull();
		expect(client.authorizationHeaderValue.snapshot.get()).toMatchObject({
			status: "error",
			value: undefined,
		});
	});

	it("preserves persisted state when restore refresh fails transiently", async () => {
		const persistentStorage = createInMemoryRecordStore();
		const staleSnapshot = {
			tokens: {
				accessToken: "stale-at",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
				refreshMaterial: "rt",
			},
			metadata: {},
		};
		await persistentStorage.set(
			DEFAULT_PERSISTENCE_KEY,
			JSON.stringify({
				version: 1,
				storedAt: Date.parse("2026-01-01T00:00:00Z"),
				value: staleSnapshot,
			}),
		);
		const persisted = await persistentStorage.get(DEFAULT_PERSISTENCE_KEY);
		expect(persisted).not.toBeNull();

		const transientRefresh = vi.fn(() => ({
			status: 503,
			headers: {},
			body: null,
		}));
		const { runtime } = createTestRuntime(
			createTestTransport(transientRefresh),
			{ persistentStorage },
		);
		const client = new BackendOidcModeClient(
			{
				baseUrl: BASE_URL,
				refresh: { sources: { refreshTimer: false } },
			},
			{ environment: runtime },
		);
		await expect(client.restorePersistedState()).rejects.toMatchObject({
			name: "ClientError",
		});
		expect(transientRefresh).toHaveBeenCalled();
		expect(client.authSnapshot.get()).toMatchObject({
			status: "error",
			value: staleSnapshot,
		});
		expect(await persistentStorage.get(DEFAULT_PERSISTENCE_KEY)).toBe(
			persisted,
		);
	});

	it("clears persisted state when restore refresh proves revocation", async () => {
		const persistentStorage = createInMemoryRecordStore();
		await persistentStorage.set(
			DEFAULT_PERSISTENCE_KEY,
			JSON.stringify({
				version: 1,
				storedAt: Date.parse("2026-01-01T00:00:00Z"),
				value: {
					tokens: {
						accessToken: "revoked-at",
						accessTokenExpiresAt: "2025-12-31T23:59:59Z",
						refreshMaterial: "rt",
					},
					metadata: {},
				},
			}),
		);
		expect(await persistentStorage.get(DEFAULT_PERSISTENCE_KEY)).not.toBeNull();

		const revokedRefresh = vi.fn(() => ({
			status: 401,
			headers: { "content-type": "application/json" },
			body: { error: "invalid_grant" },
		}));
		const { runtime } = createTestRuntime(createTestTransport(revokedRefresh), {
			persistentStorage,
		});
		const client = new BackendOidcModeClient(
			{
				baseUrl: BASE_URL,
				refresh: { sources: { refreshTimer: false } },
			},
			{ environment: runtime },
		);

		await expect(client.restorePersistedState()).rejects.toMatchObject({
			name: "TokenSetAuthorizationRevocationError",
			reason: "invalid_grant",
		});
		expect(revokedRefresh).toHaveBeenCalled();
		expect(client.authSnapshot.get()).toMatchObject({
			status: "error",
			value: null,
		});
		expect(await persistentStorage.get(DEFAULT_PERSISTENCE_KEY)).toBeNull();
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
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment: runtime },
		);

		const snapshot = await client.handleCallback(
			callbackParameters(
				"access_token=callback-at&id_token=callback-idt&refresh_token=callback-rt&access_token_expires_at=2026-12-31T00%3A00%3A00Z&metadata_redemption_id=meta-1",
			),
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
			{ environment: restoredRuntime },
		);
		const restored = await restoredClient.restorePersistedState();

		expect(restored?.tokens.accessToken).toBe("callback-at");
		expect(restored?.metadata.principal?.displayName).toBe("User One");

		expect(await persistentStorage.get(DEFAULT_PERSISTENCE_KEY)).not.toBeNull();

		await restoredClient.logout();
		expect(await persistentStorage.get(DEFAULT_PERSISTENCE_KEY)).toBeNull();
	});

	it("keeps callback auth state when best-effort persistence fails", async () => {
		const trace = new TestTraceCollector();
		const persistentStorage: NonNullable<
			FoundationEnvironment["persistentStorage"]
		> = {
			get: async () => null,
			set: async () => {
				throw new Error("disk full");
			},
			remove: async () => undefined,
		};
		const { runtime } = createTestRuntime(
			createTestTransport(() => ({
				status: 200,
				headers: {},
				body: { metadata: {} },
			})),
			{
				persistentStorage,
				tracing: createTracing({ subscribers: [trace] }),
			},
		);
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment: runtime },
		);
		const events: TokenSetAuthEvent[] = [];
		client.authEvents.subscribe({ next: (event) => events.push(event) });

		await expect(
			client.handleCallback(
				callbackParameters(
					"access_token=callback-at&id_token=callback-idt&metadata_redemption_id=meta-1",
				),
			),
		).resolves.toMatchObject({
			tokens: { accessToken: "callback-at" },
		});
		expect(client.authSnapshot.get()).toMatchObject({
			status: ResourceStatus.Resolved,
			value: { tokens: { accessToken: "callback-at" } },
		});
		expect(client.callback.state.get()).toMatchObject({
			status: ResourceStatus.Resolved,
			value: {
				kind: "handled",
				result: { tokens: { accessToken: "callback-at" } },
			},
		});
		expect(
			events.some(
				(event) => event.type === TokenSetAuthEventType.AuthAuthenticated,
			),
		).toBe(true);
		expect(trace.events.map((event) => event.name)).toContain(
			BackendOidcModeComposedTraceEventType.PersistenceSyncFailed,
		);
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
		const client = new BackendOidcModeClient(
			{
				baseUrl: BASE_URL,
				refresh: { sources: { refreshTimer: false } },
			},
			{ environment: runtime },
		);

		await expect(client.restorePersistedState()).resolves.toBeNull();
		await flushMicrotasks();

		expect(client.authSnapshot.get()).toMatchObject({
			status: ResourceStatus.LoadingError,
			error: expect.any(Error),
		});
		expect(await persistentStorage.get(DEFAULT_PERSISTENCE_KEY)).toBeNull();
		expect(trace.events.map((event) => event.name)).toContain(
			BackendOidcModeComposedTraceEventType.PersistedRestoreFailed,
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
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment: runtime },
		);

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

	it("keeps refreshed memory state when best-effort persistence fails", async () => {
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
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment: runtime },
		);

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

		expect(expectSnapshotValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"refreshed-at",
		);
		expect(client.authSnapshot.get().status).toBe("resolved");
	});

	it("stops refresh work on dispose and prevents future scheduled refreshes", async () => {
		const deferred = createDeferred<HttpResponse>();
		const transport = createTestTransport(async () => await deferred.promise);
		const { runtime, time } = createTestRuntime(transport);
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment: runtime },
		);

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
		expect(expectSnapshotValue(client.authSnapshot)?.tokens.accessToken).toBe(
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

		await expect(refreshPromise).rejects.toMatchObject({
			name: "ClientError",
			kind: "cancelled",
			code: "client.cancelled",
		});
		expect(expectSnapshotValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"at",
		);
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
		const client = new BackendOidcModeClient(
			{
				baseUrl: BASE_URL,
				refresh: { sources: { refreshTimer: false } },
			},
			{ environment: runtime },
		);

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
		expect(expectSnapshotValue(client.authSnapshot)?.tokens.accessToken).toBe(
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
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment: runtime },
		);

		await client.handleCallback(
			callbackParameters(
				"access_token=trace-at&id_token=trace-idt&refresh_token=trace-rt&access_token_expires_at=2026-12-31T00%3A00%3A00Z&metadata_redemption_id=meta-trace",
			),
		);

		expect(trace.events.map((event) => event.name)).toEqual(
			expect.arrayContaining([
				OperationTraceEventType.Started,
				OperationTraceEventType.Event,
				BackendOidcModeComposedTraceEventType.RefreshTimerScheduled,
				OperationTraceEventType.Ended,
			]),
		);
		expect(
			trace.events
				.filter((event) => event.name === OperationTraceEventType.Event)
				.map((event) => event.fields?.eventName),
		).toEqual(
			expect.arrayContaining([
				BackendOidcModeOperationEventName.MetadataRedemptionStarted,
				BackendOidcModeOperationEventName.MetadataRedemptionSucceeded,
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
				refresh: { tokenFreshness: { refreshWindowMs: 60_000 } },
			},
			{ environment: runtime },
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
				BackendOidcModeComposedTraceEventType.StateRestored,
				BackendOidcModeComposedTraceEventType.RefreshTimerFired,
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
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment: runtime },
		);
		await client.restoreState({
			tokens: {
				accessToken: "expired-at",
				accessTokenExpiresAt: "2025-12-31T23:59:59Z",
				refreshMaterial: "rt",
			},
			metadata: {},
		});

		await client.refreshState();

		const taskStarted = trace
			.ofType(OperationTraceEventType.Started)
			.find(
				(event) =>
					event.fields?.operationName ===
					BackendOidcModeTraceOperationName.Refresh,
			);
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
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment: runtime },
		);

		await client.handleCallback(
			callbackParameters(
				"access_token=trace-at&id_token=trace-idt&refresh_token=trace-rt&access_token_expires_at=2026-12-31T00%3A00%3A00Z&metadata_redemption_id=meta-op",
			),
		);

		const callbackStarted = trace
			.ofType(OperationTraceEventType.Started)
			.find(
				(event) =>
					event.fields?.operationName ===
					BackendOidcModeTraceOperationName.Callback,
			);
		const operationSpanId = callbackStarted?.span?.id;

		expect(operationSpanId).toBeTruthy();
		expect(
			trace
				.ofType(OperationTraceEventType.Event)
				.find(
					(event) =>
						event.fields?.eventName ===
						BackendOidcModeOperationEventName.MetadataRedemptionStarted,
				)?.span?.id,
		).toBe(operationSpanId);
		expect(
			trace
				.ofType(OperationTraceEventType.Ended)
				.find(
					(event) =>
						event.fields?.operationName ===
							BackendOidcModeTraceOperationName.Callback &&
						event.fields?.outcome === "succeeded",
				)?.span?.id,
		).toBe(operationSpanId);
		expect(
			trace.assertOperationLifecycle(operationSpanId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Event,
				OperationTraceEventType.Event,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fields: expect.objectContaining({
						operationName: BackendOidcModeTraceOperationName.Callback,
						flow: "callback",
					}),
				}),
			]),
		);
	});

	it("accepts callback JSON bodies through the unified callback input", async () => {
		const trace = new InMemoryTraceCollector();
		const transport = createTestTransport(() => {
			throw new Error("callback body should not hit transport");
		});
		const { runtime } = createTestRuntime(transport, {
			tracing: createTracing({ subscribers: [trace] }),
		});
		const client = new BackendOidcModeClient(
			{ baseUrl: BASE_URL },
			{ environment: runtime },
		);

		await client.handleCallback({
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

		const callbackStarted = trace
			.ofType(OperationTraceEventType.Started)
			.find(
				(event) =>
					event.fields?.operationName ===
					BackendOidcModeTraceOperationName.Callback,
			);
		const operationSpanId = callbackStarted?.span?.id;

		expect(operationSpanId).toBeTruthy();
		expect(
			trace
				.ofType(OperationTraceEventType.Ended)
				.find(
					(event) =>
						event.fields?.operationName ===
							BackendOidcModeTraceOperationName.Callback &&
						event.fields?.outcome === "succeeded",
				)?.span?.id,
		).toBe(operationSpanId);
		expect(
			trace.assertOperationLifecycle(operationSpanId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fields: expect.objectContaining({
						operationName: BackendOidcModeTraceOperationName.Callback,
						flow: "callback",
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
				refresh: { tokenFreshness: { refreshWindowMs: 60_000 } },
			},
			{ environment: runtime },
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

		const refreshStarted = trace
			.ofType(OperationTraceEventType.Started)
			.find(
				(event) =>
					event.fields?.operationName ===
					BackendOidcModeTraceOperationName.Refresh,
			);
		const operationSpanId = refreshStarted?.span?.id;

		expect(operationSpanId).toBeTruthy();
		expect(
			trace
				.ofType(OperationTraceEventType.Event)
				.find(
					(event) =>
						event.fields?.eventName ===
						BackendOidcModeOperationEventName.MetadataRedemptionStarted,
				)?.span?.id,
		).toBe(operationSpanId);
		expect(
			trace
				.ofType(OperationTraceEventType.Ended)
				.find(
					(event) =>
						event.fields?.operationName ===
							BackendOidcModeTraceOperationName.Refresh &&
						event.fields?.outcome === "succeeded",
				)?.span?.id,
		).toBe(operationSpanId);
		expect(
			trace.assertOperationLifecycle(operationSpanId!, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Event,
				OperationTraceEventType.Event,
				OperationTraceEventType.Ended,
			]),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fields: expect.objectContaining({
						operationName: BackendOidcModeTraceOperationName.Refresh,
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
