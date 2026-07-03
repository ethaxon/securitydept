import {
	type BaseTransportTrait,
	type CancellationTokenTrait,
	type ClientError,
	createCancellationTokenSource,
	createFoundationEnvironment,
	createInMemoryRecordStore,
	createRootSpan,
	createTracing,
	isClientErrorEvent,
	OperationTraceEventType,
	type ReadableSignalTrait,
	type ResourceSnapshot,
	type ResourceTrait,
	SpanSharedAttributeName,
	type StorageTrait,
	type TimeTrait,
} from "@securitydept/client";
import { InMemoryTraceCollector } from "@securitydept/test-utils";
import { filter, from } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
	type TokenSetAuthEvent,
	TokenSetAuthEventType,
} from "../../events/auth-events";
import { type TokenSetAuthSnapshot } from "../../token/types";
import { BaseOidcModeClient, PersistPolicy } from "../base-client";
import { type BaseOidcModeClientOptions } from "../types";
import {
	TokenSetAuthDeterminationKind,
	TokenSetAuthDeterminationOutcomeKind,
} from "../workflows/commit";

const TEST_TRANSPORT: BaseTransportTrait = {
	execute: vi.fn(),
};

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

function createAuthSnapshot(
	accessToken: string,
	options?: {
		expiresAt?: string;
		refreshMaterial?: string;
	},
): TokenSetAuthSnapshot {
	return {
		tokens: {
			accessToken,
			accessTokenIssuedAt: new Date(Date.now() - 60_000).toISOString(),
			accessTokenExpiresAt:
				options?.expiresAt ??
				new Date(Date.now() + 60 * 60 * 1000).toISOString(),
			refreshMaterial: options?.refreshMaterial,
		},
		metadata: {},
	};
}

function createOptions(options?: {
	autoStart?: boolean;
	store?: StorageTrait;
	time?: TimeTrait;
	tracing?: BaseOidcModeClientOptions["environment"]["tracing"];
	span?: ReturnType<typeof createRootSpan>;
}): BaseOidcModeClientOptions {
	return {
		environment: createFoundationEnvironment({
			transport: TEST_TRANSPORT,
			span: options?.span,
			persistentStorage: options?.store,
			time: options?.time,
			tracing: options?.tracing,
			tracingCreateOptions:
				options?.tracing === undefined
					? {
							subscribers: [new InMemoryTraceCollector()],
						}
					: undefined,
		}),
		tracing: {
			target: "test-token-set",
			prefix: "test_token_set",
		},
		id: "test-client",
		persistence: options?.store
			? {
					store: options.store,
					key: "test-auth",
				}
			: undefined,
		autoStart: options?.autoStart,
		refresh: {
			sources: {
				refreshTimer: false,
			},
		},
	};
}

class TestTime implements TimeTrait {
	constructor(private readonly value: number) {}

	now(): number {
		return this.value;
	}

	setTimeout(callback: () => void, delayMs: number): unknown {
		return setTimeout(callback, delayMs);
	}

	clearTimeout(handle: unknown): void {
		clearTimeout(handle as ReturnType<typeof setTimeout>);
	}
}

class TestOidcModeClient extends BaseOidcModeClient {
	private refreshImpl: (
		snapshot: TokenSetAuthSnapshot,
	) => Promise<TokenSetAuthSnapshot | null> = async (snapshot) => snapshot;

	constructor(options: BaseOidcModeClientOptions = createOptions()) {
		super(options);
	}

	setRefreshImpl(
		refreshImpl: (
			snapshot: TokenSetAuthSnapshot,
		) => Promise<TokenSetAuthSnapshot | null>,
	): void {
		this.refreshImpl = refreshImpl;
	}

	async loginWithRedirect(): Promise<void> {}

	async loginWithPopup(): Promise<never> {
		throw new Error("not implemented");
	}

	get clientSpanId(): string {
		return this.span.id;
	}

	async applySnapshot(
		snapshot: TokenSetAuthSnapshot,
		persistPolicy = PersistPolicy.FollowClient,
	): Promise<TokenSetAuthSnapshot> {
		return await this._runDeterminationWorkflow({
			name: "test.apply_snapshot",
			traceAttributes: { workflow: "apply_snapshot" },
			workflow: async () => ({
				commit: {
					candidate: {
						kind: TokenSetAuthDeterminationKind.Authenticated,
						snapshot,
					},
					persistPolicy,
					events: [
						{
							type: TokenSetAuthEventType.AuthAuthenticated,
							payload: {},
						},
					],
				},
				outcome: {
					kind: TokenSetAuthDeterminationOutcomeKind.Return,
					value: snapshot,
				},
			}),
		});
	}

	protected async _refreshAuthSnapshot(
		authSnapshot: TokenSetAuthSnapshot,
		_freshnessTiming: unknown,
		_cancellationToken: CancellationTokenTrait,
	): Promise<TokenSetAuthSnapshot | null> {
		return await this.refreshImpl(authSnapshot);
	}
}

describe("BaseOidcModeClient auth event and trace contract", () => {
	it("links public workflow cancellation to the client lifecycle token", async () => {
		const client = new TestOidcModeClient(createOptions());
		const cancellation = createCancellationTokenSource();
		const reason = new Error("cancel restore");
		cancellation.cancel(reason);

		await expect(
			client.restoreState(createAuthSnapshot("cancelled"), {
				cancellationToken: cancellation.token,
			}),
		).rejects.toMatchObject({
			kind: "cancelled",
			code: "client.cancelled",
			cause: reason,
		});
	});

	it("generates a UUID v7 id when no explicit id is provided", () => {
		const client = new TestOidcModeClient({
			...createOptions(),
			id: undefined,
		});

		expect(client.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
		);
	});

	it("records every dispose call", () => {
		const trace = new InMemoryTraceCollector();
		const client = new TestOidcModeClient(
			createOptions({
				tracing: createTracing({ subscribers: [trace] }),
			}),
		);

		client.dispose();
		client.dispose();

		expect(
			trace.events.filter((event) => event.name === "test_token_set.disposed"),
		).toHaveLength(2);
	});

	it("waits for explicit start before restoring persisted state", async () => {
		const store = createInMemoryRecordStore();
		const seededSnapshot = createAuthSnapshot("persisted-token");
		const seedClient = new TestOidcModeClient(createOptions({ store }));
		await seedClient.applySnapshot(seededSnapshot);

		const client = new TestOidcModeClient(createOptions({ store }));
		expect(client.authSnapshot.get()).toEqual({ status: "idle" });

		await client.start();

		expect(expectSnapshotValue(client.authSnapshot)).toEqual(seededSnapshot);
		expect(expectResourceValue(client.authorizationHeaderValue)).toBe(
			"Bearer persisted-token",
		);
	});

	it("runs protected determination workflows through one operation lifecycle", async () => {
		const trace = new InMemoryTraceCollector();
		const client = new TestOidcModeClient(
			createOptions({ tracing: createTracing({ subscribers: [trace] }) }),
		);

		await client.applySnapshot(createAuthSnapshot("direct-runner"));

		const started = trace
			.ofOperationName("test.apply_snapshot")
			.find((event) => event.name === OperationTraceEventType.Started);
		expect(started?.span.id).toBeTruthy();
		expect(
			trace.assertOperationLifecycle(started!.span.id, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Ended,
			]),
		).toHaveLength(2);
	});

	it("does not redetermine a persisted restore failure in start", async () => {
		const time = new TestTime(Date.parse("2026-01-01T00:00:00Z"));
		const store = createInMemoryRecordStore();
		const trace = new InMemoryTraceCollector();
		const expiredSnapshot = createAuthSnapshot("persisted-token", {
			expiresAt: new Date(time.now() - 60_000).toISOString(),
			refreshMaterial: "refresh-token",
		});
		const seedClient = new TestOidcModeClient(createOptions({ store, time }));
		await seedClient.applySnapshot(expiredSnapshot);

		const client = new TestOidcModeClient(
			createOptions({
				store,
				time,
				tracing: createTracing({ subscribers: [trace] }),
			}),
		);
		client.setRefreshImpl(async () => {
			expect(client.authOperations.restorePending.get()).toBe(true);
			expect(client.authOperations.refreshPending.get()).toBe(false);
			throw new Error("refresh exploded");
		});
		const failureSnapshots: ResourceSnapshot<TokenSetAuthSnapshot | null>[] =
			[];
		const subscription = from(client.authSnapshot).subscribe((snapshot) => {
			if (snapshot.status === "loading_error" || snapshot.status === "error") {
				failureSnapshots.push(snapshot);
			}
		});

		try {
			await expect(client.start()).rejects.toMatchObject({
				kind: "internal",
				code: "token_set.authorization.operation_failed",
			});
		} finally {
			subscription.unsubscribe();
		}

		expect(failureSnapshots).toHaveLength(1);
		expect(client.authSnapshot.get()).toBe(failureSnapshots[0]);
		expect(client.authOperations.restorePending.get()).toBe(false);
		expect(client.authOperations.refreshPending.get()).toBe(false);
		const started = trace
			.ofOperationName("test_token_set.restore.persisted")
			.filter((event) => event.name === OperationTraceEventType.Started);
		expect(started).toHaveLength(1);
		expect(
			trace.assertOperationLifecycle(started[0]!.span.id, [
				OperationTraceEventType.Started,
				OperationTraceEventType.Error,
				OperationTraceEventType.Ended,
			]),
		).toHaveLength(3);
	});

	it("delegates startup cancellation determination to the selected workflow", async () => {
		const client = new TestOidcModeClient();
		const start = client.start();

		client.dispose();

		await expect(start).rejects.toMatchObject({ kind: "cancelled" });
		expect(client.authOperations.restorePending.get()).toBe(false);
		expect(client.authSnapshot.get()).toMatchObject({
			status: "loading_error",
			error: expect.objectContaining({ kind: "cancelled" }),
		});
	});

	it("persists manual restore when requested", async () => {
		const store = createInMemoryRecordStore();
		const snapshot = createAuthSnapshot("manual-token");
		const client = new TestOidcModeClient(createOptions({ store }));

		await client.restoreState(snapshot, {
			persistPolicy: PersistPolicy.FollowClient,
		});

		const restoredClient = new TestOidcModeClient(createOptions({ store }));
		await expect(restoredClient.restorePersistedState()).resolves.toEqual(
			snapshot,
		);
	});

	it("honors clearState persistPolicy skip", async () => {
		const store = createInMemoryRecordStore();
		const snapshot = createAuthSnapshot("kept-token");
		const client = new TestOidcModeClient(createOptions({ store }));
		await client.applySnapshot(snapshot);

		await client.clearState({ persistPolicy: PersistPolicy.Skip });

		const restoredClient = new TestOidcModeClient(createOptions({ store }));
		await expect(restoredClient.restorePersistedState()).resolves.toEqual(
			snapshot,
		);
	});

	it("logs out by clearing local and persisted token state", async () => {
		const store = createInMemoryRecordStore();
		const snapshot = createAuthSnapshot("logout-token");
		const client = new TestOidcModeClient(createOptions({ store }));
		await client.applySnapshot(snapshot);

		await client.logout();

		expect(expectSnapshotValue(client.authSnapshot)).toBeNull();
		const restoredClient = new TestOidcModeClient(createOptions({ store }));
		await expect(restoredClient.restorePersistedState()).resolves.toBeNull();
	});

	it("emits typed persisted-restore events without leaking token material", async () => {
		const store = createInMemoryRecordStore();
		const snapshot = createAuthSnapshot("persisted-token");
		const seedClient = new TestOidcModeClient(createOptions({ store }));
		await seedClient.applySnapshot(snapshot);

		const client = new TestOidcModeClient(createOptions({ store }));
		const events: Array<{
			type: string;
			payload: Record<string, unknown>;
		}> = [];
		client.authEvents.subscribe({
			next: (event) => {
				events.push({
					type: event.type,
					payload: event.payload as unknown as Record<string, unknown>,
				});
			},
		});

		await expect(client.restorePersistedState()).resolves.toEqual(snapshot);

		expect(events.map((event) => event.type)).toEqual([
			TokenSetAuthEventType.AuthMaterialRestoreStarted,
			TokenSetAuthEventType.AuthMaterialRestored,
			TokenSetAuthEventType.AuthAuthenticated,
		]);
		expect(events[0]?.payload).toEqual({
			type: TokenSetAuthEventType.AuthMaterialRestoreStarted,
			client: { id: "test-client" },
			persisted: true,
		});
		expect(events[1]?.payload).toEqual({
			type: TokenSetAuthEventType.AuthMaterialRestored,
			client: { id: "test-client" },
			persisted: true,
		});
		expect(events[2]?.payload).toEqual({
			type: TokenSetAuthEventType.AuthAuthenticated,
			client: { id: "test-client" },
		});
		expect(JSON.stringify(events)).not.toContain("persisted-token");
	});

	it("does not replay auth lifecycle events to late subscribers", async () => {
		const client = new TestOidcModeClient();
		await client.restoreState(createAuthSnapshot("current-token"));
		const events: TokenSetAuthEvent[] = [];

		client.authEvents.subscribe({ next: (event) => events.push(event) });

		expect(events).toEqual([]);
	});

	it("emits restore failure when persisted material cannot be parsed", async () => {
		const store = createInMemoryRecordStore();
		await store.set("test-auth", "{invalid json");
		const client = new TestOidcModeClient(createOptions({ store }));
		const events: Array<{
			type: string;
			payload: Record<string, unknown>;
		}> = [];
		client.authEvents.subscribe({
			next: (event) => {
				events.push({
					type: event.type,
					payload: event.payload as unknown as Record<string, unknown>,
				});
			},
		});

		await expect(client.restorePersistedState()).resolves.toBeNull();

		expect(events.map((event) => event.type)).toEqual([
			TokenSetAuthEventType.AuthMaterialRestoreStarted,
			TokenSetAuthEventType.AuthMaterialRestoreFailed,
		]);
		expect(events[1]?.payload).toEqual(
			expect.objectContaining({
				client: { id: "test-client" },
				persisted: true,
				error: expect.objectContaining({
					code: "token_set.persistence.invalid_json",
				}),
			}),
		);
		expect(client.authSnapshot.get()).toMatchObject({
			status: "loading_error",
			error: expect.any(Error),
		});
	});

	it("confines freshness to refresh-specific auth events", async () => {
		const client = new TestOidcModeClient();
		const expired = createAuthSnapshot("expired-token", {
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
			refreshMaterial: "refresh-token",
		});
		const refreshed = createAuthSnapshot("refreshed-token", {
			refreshMaterial: "refresh-token",
		});
		await client.restoreState(expired);
		client.setRefreshImpl(async () => {
			expect(client.authOperations.refreshPending.get()).toBe(true);
			expect(client.authOperations.restorePending.get()).toBe(false);
			return refreshed;
		});

		const events: Array<{
			type: string;
			payload: Record<string, unknown>;
		}> = [];
		client.authEvents.subscribe({
			next: (event) => {
				events.push({
					type: event.type,
					payload: event.payload as unknown as Record<string, unknown>,
				});
			},
		});
		events.length = 0;

		await expect(client.refreshState()).resolves.toEqual(refreshed);
		expect(client.authOperations.refreshPending.get()).toBe(false);

		expect(events.map((event) => event.type)).toEqual([
			TokenSetAuthEventType.AuthRefreshRequired,
			TokenSetAuthEventType.AuthRefreshStarted,
			TokenSetAuthEventType.AuthRefreshSucceeded,
			TokenSetAuthEventType.AuthAuthenticated,
		]);
		for (const event of events.slice(0, 3)) {
			expect(event.payload).toEqual(
				expect.objectContaining({
					client: { id: "test-client" },
					hasRefreshMaterial: true,
					freshness: expect.any(Object),
				}),
			);
		}
		expect(events[3]?.payload).toEqual({
			type: TokenSetAuthEventType.AuthAuthenticated,
			client: { id: "test-client" },
		});
		expect(JSON.stringify(events)).not.toContain("expired-token");
		expect(JSON.stringify(events)).not.toContain("refreshed-token");
		expect(JSON.stringify(events)).not.toContain("refresh-token");
	});

	it("rejects transient refresh failure without emitting unauthenticated", async () => {
		const trace = new InMemoryTraceCollector();
		const client = new TestOidcModeClient(
			createOptions({
				tracing: createTracing({ subscribers: [trace] }),
			}),
		);
		const expired = createAuthSnapshot("expired-token", {
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
			refreshMaterial: "refresh-token",
		});
		await client.restoreState(expired);
		client.setRefreshImpl(async () => {
			throw new Error("refresh exploded");
		});

		const events: Array<{
			type: string;
			payload: Record<string, unknown>;
		}> = [];
		const errors: ClientError[] = [];
		client.authEvents.subscribe({
			next: (event) => {
				events.push({
					type: event.type,
					payload: event.payload as unknown as Record<string, unknown>,
				});
			},
		});
		from(client.authEvents)
			.pipe(filter(isClientErrorEvent))
			.subscribe((event) => errors.push(event.payload.error));

		const rejected = await client.refreshState().catch((error) => error);
		expect(rejected).toMatchObject({
			kind: "internal",
			code: "token_set.authorization.operation_failed",
			cause: expect.objectContaining({ message: "refresh exploded" }),
		});

		expect(events.map((event) => event.type)).toEqual([
			TokenSetAuthEventType.AuthRefreshRequired,
			TokenSetAuthEventType.AuthRefreshStarted,
			TokenSetAuthEventType.AuthRefreshFailed,
		]);
		expect(events[2]?.payload).toEqual(
			expect.objectContaining({
				client: { id: "test-client" },
				hasRefreshMaterial: true,
				freshness: expect.any(Object),
				error: expect.objectContaining({
					code: "token_set.authorization.operation_failed",
				}),
			}),
		);
		expect(errors).toEqual([rejected]);
		expect(
			errors[0]?.spanContext?.at(-1)?.attributes[
				SpanSharedAttributeName.OperationName
			],
		).toBe("test_token_set.refresh");
		expect(expectSnapshotValue(client.authSnapshot)).toEqual(expired);
		expect(
			trace.events.find(
				(event) => event.name === "test_token_set.refresh.failed",
			),
		).toBeTruthy();
	});

	it("does not emit refresh succeeded when refresh resolves to an unauthenticated outcome", async () => {
		const client = new TestOidcModeClient();
		const expired = createAuthSnapshot("expired-token", {
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
			refreshMaterial: "refresh-token",
		});
		await client.restoreState(expired);
		client.setRefreshImpl(async () => null);

		const events: Array<{
			type: string;
			payload: Record<string, unknown>;
		}> = [];
		client.authEvents.subscribe({
			next: (event) => {
				events.push({
					type: event.type,
					payload: event.payload as unknown as Record<string, unknown>,
				});
			},
		});
		events.length = 0;

		await expect(client.refreshState()).resolves.toBeNull();

		expect(events.map((event) => event.type)).toEqual([
			TokenSetAuthEventType.AuthRefreshRequired,
			TokenSetAuthEventType.AuthRefreshStarted,
			TokenSetAuthEventType.AuthUnauthenticated,
		]);
	});

	it("forks workflow spans from the explicit environment span", async () => {
		const trace = new InMemoryTraceCollector();
		const rootSpan = createRootSpan({
			idFactory: () => "span_root",
		});
		const client = new TestOidcModeClient(
			createOptions({
				tracing: createTracing({ subscribers: [trace] }),
				span: rootSpan,
			}),
		);
		const expired = createAuthSnapshot("expired-token", {
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
			refreshMaterial: "refresh-token",
		});
		const refreshed = createAuthSnapshot("refreshed-token", {
			refreshMaterial: "refresh-token",
		});
		await client.restoreState(expired);
		client.setRefreshImpl(async () => refreshed);

		await client.refreshState();

		const committedTrace = trace.events.find(
			(event) => event.name === "test_token_set.refresh.committed",
		);
		expect(committedTrace?.span?.id).toBeTruthy();
		expect(committedTrace?.span?.parent?.id).toBe(client.clientSpanId);
	});

	it("emits workflow spans even without an ambient execution context", async () => {
		const trace = new InMemoryTraceCollector();
		const client = new TestOidcModeClient(
			createOptions({
				tracing: createTracing({ subscribers: [trace] }),
			}),
		);
		const expired = createAuthSnapshot("expired-token", {
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
			refreshMaterial: "refresh-token",
		});
		const refreshed = createAuthSnapshot("refreshed-token", {
			refreshMaterial: "refresh-token",
		});
		await client.restoreState(expired);
		client.setRefreshImpl(async () => refreshed);

		await client.refreshState();

		const committedTrace = trace.events.find(
			(event) => event.name === "test_token_set.refresh.committed",
		);
		expect(committedTrace?.span?.id).toBeTruthy();
		expect(committedTrace?.span?.parent?.id).toBeTruthy();
	});

	it("auto-starts only when explicitly requested", async () => {
		const store = createInMemoryRecordStore();
		const snapshot = createAuthSnapshot("auto-token");
		const seedClient = new TestOidcModeClient(createOptions({ store }));
		await seedClient.applySnapshot(snapshot);

		const client = new TestOidcModeClient(
			createOptions({
				store,
				autoStart: true,
			}),
		);

		await client.authResource.whenValue();
		expect(expectSnapshotValue(client.authSnapshot)).toEqual(snapshot);
	});

	it("uses deterministic trace timestamps from the provided environment time", async () => {
		const trace = new InMemoryTraceCollector();
		const time = new TestTime(1_715_000_000_000);
		const client = new TestOidcModeClient(
			createOptions({
				tracing: createTracing({ subscribers: [trace] }),
				time,
			}),
		);
		const expired = createAuthSnapshot("expired-token", {
			expiresAt: new Date(time.now() - 60_000).toISOString(),
			refreshMaterial: "refresh-token",
		});
		await client.restoreState(expired);
		client.setRefreshImpl(async () =>
			createAuthSnapshot("fresh-token", {
				refreshMaterial: "refresh-token",
			}),
		);

		await client.refreshState();

		expect(trace.events.every((event) => event.at === 1_715_000_000_000)).toBe(
			true,
		);
	});
});
