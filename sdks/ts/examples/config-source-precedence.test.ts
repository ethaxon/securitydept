/**
 * Config projection source precedence — evidence tests
 *
 * Proves the full source precedence chain:
 *   bootstrap_script → persisted → network
 *
 * And the idle revalidation freshness contract:
 *   - Only stale sources trigger revalidation (based on projection generatedAt)
 *   - Fresh sources skip revalidation
 *   - Revalidation success writes back through StorageTrait
 *   - Revalidation failure retains existing cache
 */

import {
	type IdleCallbackTrait,
	type StorageTrait,
	type TimeTrait,
} from "@securitydept/client";
import {
	bootstrapScriptSource,
	networkConfigSource,
	persistConfigProjection,
	persistedConfigSource,
	type ResolvedConfigProjection,
	resolveConfigProjection,
	scheduleIdleRevalidation,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_BOOTSTRAP_KEY = "__TEST_CONFIG__";
const TEST_TIME: TimeTrait = {
	now: () => Date.now(),
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimeout: (handle) =>
		clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const TEST_IDLE_CALLBACK: IdleCallbackTrait = {
	requestIdleCallback: (callback) => setTimeout(callback, 0),
	cancelIdleCallback: (handle) =>
		clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Minimal valid projection payload matching FrontendOidcModeConfigProjection. */
function makeProjection(clientId = "test-client", generatedAt = Date.now()) {
	return {
		clientId,
		redirectUrl: "https://app.example.com/auth/callback",
		issuerUrl: "https://auth.example.com",
		wellKnownUrl: "https://auth.example.com/.well-known/openid-configuration",
		scopes: ["openid", "profile"],
		pkceEnabled: true,
		generatedAt,
	};
}

/** In-memory StorageTrait for testing (mirrors createInMemoryRecordStore). */
function createTestStore(): StorageTrait & {
	_data: Map<string, string>;
} {
	const data = new Map<string, string>();
	return {
		_data: data,
		async get(key: string) {
			return data.get(key) ?? null;
		},
		async set(key: string, value: string) {
			data.set(key, value);
		},
		async remove(key: string) {
			data.delete(key);
		},
	};
}

// ---------------------------------------------------------------------------
// 1. Source precedence
// ---------------------------------------------------------------------------

describe("Config projection source precedence", () => {
	const originalGlobalThis = globalThis as Record<string, unknown>;

	afterEach(() => {
		delete originalGlobalThis[TEST_BOOTSTRAP_KEY];
		delete originalGlobalThis.__CUSTOM_KEY__;
	});

	it("bootstrap_script source wins over persisted and network", async () => {
		const genAt = Date.now() - 30_000;
		originalGlobalThis[TEST_BOOTSTRAP_KEY] = {
			oidc: makeProjection("from-bootstrap", genAt),
		};

		const store = createTestStore();
		await store.set(
			"projection",
			JSON.stringify({
				data: makeProjection("from-persisted", genAt - 60_000),
				generatedAt: genAt - 60_000,
			}),
		);

		const resolved = await resolveConfigProjection([
			bootstrapScriptSource({
				globalKey: TEST_BOOTSTRAP_KEY,
				redirectUri: "https://app.example.com/auth/callback",
			}),
			persistedConfigSource({
				store,
				storageKey: "projection",
				redirectUri: "https://app.example.com/auth/callback",
			}),
			networkConfigSource({
				apiEndpoint: "https://api.example.com/api",
				redirectUri: "https://app.example.com/auth/callback",
			}),
		]);

		expect(resolved.sourceKind).toBe("bootstrap_script");
		expect(resolved.config.clientId).toBe("from-bootstrap");
		expect(resolved.generatedAt).toBe(genAt);
		expect(resolved.rawProjection).toBeDefined();
	});

	it("persisted source wins when bootstrap_script is absent", async () => {
		const genAt = Date.now() - 120_000;
		const store = createTestStore();
		await store.set(
			"projection",
			JSON.stringify({
				data: makeProjection("from-persisted", genAt),
				generatedAt: genAt,
			}),
		);

		const resolved = await resolveConfigProjection([
			bootstrapScriptSource({
				globalKey: TEST_BOOTSTRAP_KEY,
				redirectUri: "https://app.example.com/auth/callback",
			}),
			persistedConfigSource({
				store,
				storageKey: "projection",
				redirectUri: "https://app.example.com/auth/callback",
			}),
		]);

		expect(resolved.sourceKind).toBe("persisted");
		expect(resolved.config.clientId).toBe("from-persisted");
		expect(resolved.generatedAt).toBe(genAt);
	});

	it("network source wins when both bootstrap_script and persisted are absent", async () => {
		const store = createTestStore();

		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(makeProjection("from-network")),
		}) as unknown as typeof fetch;

		try {
			const resolved = await resolveConfigProjection([
				bootstrapScriptSource({
					globalKey: TEST_BOOTSTRAP_KEY,
					redirectUri: "https://app.example.com/auth/callback",
				}),
				persistedConfigSource({
					store,
					storageKey: "projection",
					redirectUri: "https://app.example.com/auth/callback",
				}),
				networkConfigSource({
					apiEndpoint: "https://api.example.com/api",
					redirectUri: "https://app.example.com/auth/callback",
				}),
			]);

			expect(resolved.sourceKind).toBe("network");
			expect(resolved.config.clientId).toBe("from-network");
			expect(resolved.rawProjection).toBeDefined();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("bootstrapScriptSource supports custom global key", async () => {
		originalGlobalThis.__CUSTOM_KEY__ = {
			oidc: makeProjection("custom-key"),
		};

		const resolved = await resolveConfigProjection([
			bootstrapScriptSource({
				globalKey: "__CUSTOM_KEY__",
				redirectUri: "https://app.example.com/auth/callback",
			}),
		]);

		expect(resolved.sourceKind).toBe("bootstrap_script");
		expect(resolved.config.clientId).toBe("custom-key");
	});

	it("bootstrapScriptSource carries authoritative generatedAt from projection", async () => {
		const generationTime = Date.now() - 60_000;
		originalGlobalThis[TEST_BOOTSTRAP_KEY] = {
			oidc: makeProjection("test-client", generationTime),
		};

		const resolved = await resolveConfigProjection([
			bootstrapScriptSource({
				globalKey: TEST_BOOTSTRAP_KEY,
				redirectUri: "https://app.example.com/auth/callback",
			}),
		]);

		expect(resolved.generatedAt).toBe(generationTime);
	});
});

// ---------------------------------------------------------------------------
// 2. persistConfigProjection — writeback through StorageTrait
// ---------------------------------------------------------------------------

describe("persistConfigProjection", () => {
	it("writes resolved projection to StorageTrait with generatedAt", async () => {
		const store = createTestStore();
		const genAt = Date.now() - 5000;
		const resolved: ResolvedConfigProjection = {
			config: {} as ResolvedConfigProjection["config"],
			sourceKind: "network",
			generatedAt: genAt,
			rawProjection: makeProjection("persisted-write", genAt),
		};

		await persistConfigProjection(store, "cache-key", resolved);

		const raw = await store.get("cache-key");
		expect(raw).not.toBeNull();
		const envelope = JSON.parse(raw!);
		expect(envelope.data.clientId).toBe("persisted-write");
		expect(typeof envelope.generatedAt).toBe("number");
		expect(envelope.generatedAt).toBe(genAt);
	});

	it("skips writeback when rawProjection is undefined", async () => {
		const store = createTestStore();
		const resolved: ResolvedConfigProjection = {
			config: {} as ResolvedConfigProjection["config"],
			sourceKind: "inline",
			// No rawProjection
		};

		await persistConfigProjection(store, "cache-key", resolved);
		expect(await store.get("cache-key")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 3. scheduleIdleRevalidation — freshness-aware based on projection generatedAt
// ---------------------------------------------------------------------------

describe("scheduleIdleRevalidation", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("skips revalidation when projection is still fresh", () => {
		const store = createTestStore();

		const cancel = scheduleIdleRevalidation({
			networkSource: networkConfigSource({
				apiEndpoint: "https://api.example.com/api",
				redirectUri: "https://app.example.com/auth/callback",
			}),
			time: TEST_TIME,
			idleCallback: TEST_IDLE_CALLBACK,
			store,
			storageKey: "projection",
			maxAge: 300_000, // 5 minutes
			generatedAt: Date.now() - 60_000, // generated 1 minute ago — fresh
		});

		expect(cancel).toBeUndefined();
	});

	it("fires revalidation when projection is stale", async () => {
		const store = createTestStore();
		const fetchFn = vi.fn().mockResolvedValue(makeProjection("revalidated"));

		const cancel = scheduleIdleRevalidation({
			networkSource: {
				kind: "network" as const,
				fetch: fetchFn,
				overrides: {
					redirectUri: "https://app.example.com/auth/callback",
				},
			},
			time: TEST_TIME,
			idleCallback: TEST_IDLE_CALLBACK,
			store,
			storageKey: "projection",
			maxAge: 300_000,
			generatedAt: Date.now() - 600_000, // generated 10 minutes ago — stale
		});

		expect(cancel).toBeDefined();
		await vi.advanceTimersByTimeAsync(2000);
		expect(fetchFn).toHaveBeenCalled();

		const raw = await store.get("projection");
		expect(raw).not.toBeNull();
		const envelope = JSON.parse(raw!);
		expect(envelope.data.clientId).toBe("revalidated");
	});

	it("retains existing cache when revalidation network fetch fails", async () => {
		const store = createTestStore();
		await store.set(
			"projection",
			JSON.stringify({
				data: makeProjection("old-cached"),
				generatedAt: Date.now() - 600_000,
			}),
		);

		const fetchFn = vi.fn().mockRejectedValue(new Error("Network error"));

		scheduleIdleRevalidation({
			networkSource: {
				kind: "network" as const,
				fetch: fetchFn,
				overrides: {
					redirectUri: "https://app.example.com/auth/callback",
				},
			},
			time: TEST_TIME,
			idleCallback: TEST_IDLE_CALLBACK,
			store,
			storageKey: "projection",
			maxAge: 300_000,
			generatedAt: Date.now() - 600_000, // stale
		});

		await vi.advanceTimersByTimeAsync(2000);

		const raw = await store.get("projection");
		const envelope = JSON.parse(raw!);
		expect(envelope.data.clientId).toBe("old-cached");
	});

	it("fires revalidation when generatedAt is absent", async () => {
		const store = createTestStore();
		const fetchFn = vi.fn().mockResolvedValue(makeProjection("fresh"));

		const cancel = scheduleIdleRevalidation({
			networkSource: {
				kind: "network" as const,
				fetch: fetchFn,
				overrides: {
					redirectUri: "https://app.example.com/auth/callback",
				},
			},
			time: TEST_TIME,
			idleCallback: TEST_IDLE_CALLBACK,
			store,
			storageKey: "projection",
			maxAge: 300_000,
			// No generatedAt — treat as stale
		});

		expect(cancel).toBeDefined();
		await vi.advanceTimersByTimeAsync(2000);
		expect(fetchFn).toHaveBeenCalled();
	});
});
