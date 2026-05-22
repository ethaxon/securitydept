import {
	createClientEnvironment,
	createInMemoryRecordStore,
	type HttpTransport,
	type ReadableReplaySignalTrait,
	type RecordStore,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	TokenSetAuthEventType,
	TokenSetAuthFlowOutcome,
	TokenSetAuthFlowSource,
} from "../../events/auth-events";
import type { AuthSnapshot } from "../../token/types";
import {
	BaseOidcModeClient,
	type BaseOidcModeClientOptions,
} from "../base-client";

const TEST_TRANSPORT: HttpTransport = {
	execute: vi.fn(),
};

function expectReplayValue<T>(signal: ReadableReplaySignalTrait<T>): T {
	const slot = signal.get();
	expect(slot.kind).toBe("value");
	if (slot.kind !== "value") {
		throw new Error("Expected replay signal value.");
	}
	return slot.value;
}

function createAuthSnapshot(
	accessToken: string,
	options?: {
		expiresAt?: string;
		refreshMaterial?: string;
	},
): AuthSnapshot {
	return {
		tokens: {
			accessToken,
			accessTokenIssuedAt: new Date(Date.now() - 60_000).toISOString(),
			accessTokenExpiresAt:
				options?.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
			refreshMaterial: options?.refreshMaterial,
		},
		metadata: {},
	};
}

function createOptions(store?: RecordStore): BaseOidcModeClientOptions {
	return {
		environment: createClientEnvironment({
			transport: TEST_TRANSPORT,
			persistentStore: store,
		}),
		refreshWindowMs: 0,
		traceScope: "test-token-set",
		traceSource: "test-token-set-client",
		tracePrefix: "test_token_set",
		clientName: "TestOidcModeClient",
		persistence: store ? { store, key: "test-auth" } : undefined,
	};
}

class TestOidcModeClient extends BaseOidcModeClient {
	private refreshImpl: () => Promise<AuthSnapshot | null> = async () => null;

	constructor(options: BaseOidcModeClientOptions = createOptions()) {
		super(options);
	}

	setRefreshImpl(refreshImpl: () => Promise<AuthSnapshot | null>): void {
		this.refreshImpl = refreshImpl;
	}

	async applyTestSnapshot(snapshot: AuthSnapshot): Promise<void> {
		await this._applySnapshot(snapshot, {
			source: TokenSetAuthFlowSource.ExplicitCall,
			outcome: TokenSetAuthFlowOutcome.Authenticated,
		});
	}

	setLoginPending(pending: boolean): void {
		this._authOperationSignals.loginPending.set(pending);
	}

	async refresh(): Promise<AuthSnapshot | null> {
		return await this.refreshImpl();
	}
}

describe("BaseOidcModeClient auth replay signals", () => {
	it("does not start automatically by default", async () => {
		const store = createInMemoryRecordStore();
		const seedClient = new TestOidcModeClient(createOptions(store));
		await seedClient.applyTestSnapshot(createAuthSnapshot("persisted-token"));

		const client = new TestOidcModeClient(createOptions(store));
		expect(client.authDetermined.hasValue()).toBe(false);
		expect(client.authSnapshot.hasValue()).toBe(false);

		await client.start();

		expect(client.authDetermined.hasValue()).toBe(true);
		expect(expectReplayValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"persisted-token",
		);
	});

	it("starts automatically only when autoStart is explicit", async () => {
		const store = createInMemoryRecordStore();
		const seedClient = new TestOidcModeClient(createOptions(store));
		await seedClient.applyTestSnapshot(createAuthSnapshot("auto-token"));

		const client = new TestOidcModeClient({
			...createOptions(store),
			autoStart: true,
		});

		await client.authDetermined.whenValue();
		expect(expectReplayValue(client.authSnapshot)?.tokens.accessToken).toBe(
			"auto-token",
		);
	});

	it("reuses the same pending start lifecycle", async () => {
		const client = new TestOidcModeClient();
		let resolveRestore!: () => void;
		const restoreStarted = new Promise<AuthSnapshot | null>((resolve) => {
			resolveRestore = () => resolve(null);
		});
		const restoreSpy = vi
			.spyOn(client, "restorePersistedState")
			.mockReturnValue(restoreStarted);

		const firstStart = client.start();
		const secondStart = client.start();
		expect(secondStart).toBe(firstStart);
		resolveRestore();
		await firstStart;

		await client.start();
		expect(restoreSpy).toHaveBeenCalledTimes(1);
	});

	it("emits independent auth channels when state is restored manually", () => {
		const client = new TestOidcModeClient();
		const snapshot = createAuthSnapshot("manual-token");

		expect(client.authSnapshot.hasValue()).toBe(false);
		expect(client.isAuthenticated.hasValue()).toBe(false);

		client.restoreState(snapshot);

		expect(client.authDetermined.hasValue()).toBe(true);
		expect(expectReplayValue(client.authSnapshot)).toBe(snapshot);
		expect(expectReplayValue(client.isAuthenticated)).toBe(true);
		expect(expectReplayValue(client.authorizationHeaderValue)).toBe(
			"Bearer manual-token",
		);
		expect(client.lastAuthError.get()).toBeUndefined();
	});

	it("updates replay channels before terminal auth events are observed", async () => {
		const client = new TestOidcModeClient();
		const snapshot = createAuthSnapshot("event-token");
		const observedSnapshots: Array<AuthSnapshot | null> = [];

		client.authEvents.subscribe({
			next: (event) => {
				if (event.type !== TokenSetAuthEventType.AuthAuthenticated) return;
				const slot = client.authSnapshot.get();
				observedSnapshots.push(slot.kind === "value" ? slot.value : null);
			},
		});

		await client.applyTestSnapshot(snapshot);

		expect(observedSnapshots).toEqual([snapshot]);
	});

	it("emits null auth channels when persisted restore finds no snapshot", async () => {
		const store = createInMemoryRecordStore();
		const client = new TestOidcModeClient(createOptions(store));

		await expect(client.restorePersistedState()).resolves.toBeNull();

		expect(client.authDetermined.hasValue()).toBe(true);
		expect(expectReplayValue(client.authSnapshot)).toBeNull();
		expect(expectReplayValue(client.isAuthenticated)).toBe(false);
		expect(expectReplayValue(client.authorizationHeaderValue)).toBeUndefined();
		expect(client.lastAuthError.get()).toBeUndefined();
		expect(client.authOperations.restorePending.get()).toBe(false);
	});

	it("emits restored snapshot from persistent storage", async () => {
		const store = createInMemoryRecordStore();
		const seedClient = new TestOidcModeClient(createOptions(store));
		const snapshot = createAuthSnapshot("persisted-token");
		await seedClient.applyTestSnapshot(snapshot);

		const restoredClient = new TestOidcModeClient(createOptions(store));
		await expect(restoredClient.restorePersistedState()).resolves.toEqual(
			snapshot,
		);

		expect(expectReplayValue(restoredClient.authSnapshot)).toEqual(snapshot);
		expect(expectReplayValue(restoredClient.isAuthenticated)).toBe(true);
		expect(expectReplayValue(restoredClient.authorizationHeaderValue)).toBe(
			"Bearer persisted-token",
		);
	});

	it("checks and refreshes persisted candidates before publishing a determined snapshot", async () => {
		const store = createInMemoryRecordStore();
		const expired = createAuthSnapshot("stale-persisted-token", {
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
			refreshMaterial: "refresh-token",
		});
		const refreshed = createAuthSnapshot("stable-refreshed-token", {
			refreshMaterial: "refresh-token",
		});
		await store.set(
			"test-auth",
			JSON.stringify({
				version: 1,
				storedAt: Date.now(),
				value: expired,
			}),
		);

		const restoredClient = new TestOidcModeClient(createOptions(store));
		const observedTokens: Array<string | null> = [];
		restoredClient.authSnapshot.subscribe(() => {
			const slot = restoredClient.authSnapshot.get();
			if (slot.kind !== "value") {
				return;
			}
			observedTokens.push(slot.value?.tokens.accessToken ?? null);
		});
		restoredClient.setRefreshImpl(async () => {
			await restoredClient.applyTestSnapshot(refreshed);
			return refreshed;
		});

		await expect(restoredClient.restorePersistedState()).resolves.toEqual(
			refreshed,
		);

		expect(observedTokens).not.toContain("stale-persisted-token");
		expect(observedTokens).toContain("stable-refreshed-token");
		expect(expectReplayValue(restoredClient.authSnapshot)).toEqual(refreshed);
	});

	it("emits lastAuthError and resets pending when persisted restore fails", async () => {
		const store = createInMemoryRecordStore();
		await store.set("test-auth", "{invalid json");
		const client = new TestOidcModeClient(createOptions(store));

		await expect(client.restorePersistedState()).resolves.toBeNull();

		expect(expectReplayValue(client.authSnapshot)).toBeNull();
		expect(expectReplayValue(client.isAuthenticated)).toBe(false);
		expect(client.lastAuthError.get()).toBeInstanceOf(Error);
		expect(client.authOperations.restorePending.get()).toBe(false);
	});

	it("updates auth channels and pending state through refresh", async () => {
		const client = new TestOidcModeClient();
		const expired = createAuthSnapshot("expired-token", {
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
			refreshMaterial: "refresh-token",
		});
		const refreshed = createAuthSnapshot("refreshed-token", {
			refreshMaterial: "refresh-token",
		});
		let resolveRefresh!: () => void;
		const refreshStarted = new Promise<void>((resolve) => {
			resolveRefresh = resolve;
		});
		client.setRefreshImpl(async () => {
			await refreshStarted;
			await client.applyTestSnapshot(refreshed);
			return refreshed;
		});
		client.restoreState(expired);

		const authCheckPromise = client.authCheck({
			forceRefreshWhenDue: true,
		});
		expect(client.authOperations.refreshPending.get()).toBe(true);
		resolveRefresh();

		await expect(authCheckPromise).resolves.toEqual(
			expect.objectContaining({
				authorizationHeader: "Bearer refreshed-token",
			}),
		);
		expect(client.authOperations.refreshPending.get()).toBe(false);
		expect(expectReplayValue(client.authSnapshot)).toBe(refreshed);
		expect(expectReplayValue(client.isAuthenticated)).toBe(true);
		expect(expectReplayValue(client.authorizationHeaderValue)).toBe(
			"Bearer refreshed-token",
		);
	});

	it("clears auth channels and exposes operation pending signals", async () => {
		const client = new TestOidcModeClient();
		client.restoreState(createAuthSnapshot("clear-token"));
		client.setLoginPending(true);
		expect(client.authOperations.loginPending.get()).toBe(true);

		const clearPromise = client.clearState();
		expect(client.authOperations.clearPending.get()).toBe(true);
		await clearPromise;

		expect(client.authOperations.clearPending.get()).toBe(false);
		expect(expectReplayValue(client.authSnapshot)).toBeNull();
		expect(expectReplayValue(client.isAuthenticated)).toBe(false);
		expect(expectReplayValue(client.authorizationHeaderValue)).toBeUndefined();
		client.setLoginPending(false);
		expect(client.authOperations.loginPending.get()).toBe(false);
	});
});
