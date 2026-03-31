import { createInMemoryRecordStore } from "@securitydept/client";
import { describe, expect, it } from "vitest";
import {
	type AuthSnapshot,
	type AuthStatePersistence,
	bearerHeader,
	createAuthorizedTransport,
	createAuthStatePersistence,
	mergeTokenDelta,
} from "../orchestration/index";

// -----------------------------------------------------------------------
// These tests validate that the generic token orchestration layer does
// NOT depend on token-set specific fields (metadataRedemptionId,
// callback fragment, sealed payload, etc.). Every test here uses only
// protocol-agnostic types.
// -----------------------------------------------------------------------

describe("orchestration / token-ops", () => {
	it("merges a token delta into a snapshot", () => {
		const snapshot = {
			accessToken: "old-at",
			idToken: "old-id",
			refreshMaterial: "old-rt",
			accessTokenExpiresAt: "2026-01-01T00:00:00Z",
		};

		const delta = {
			accessToken: "new-at",
			// idToken, refreshMaterial, accessTokenExpiresAt all absent
		};

		const result = mergeTokenDelta(snapshot, delta);

		expect(result.accessToken).toBe("new-at");
		// Absent delta fields should preserve the snapshot values
		expect(result.idToken).toBe("old-id");
		expect(result.refreshMaterial).toBe("old-rt");
		expect(result.accessTokenExpiresAt).toBe("2026-01-01T00:00:00Z");
	});

	it("delta fields override snapshot fields when present", () => {
		const snapshot = {
			accessToken: "old-at",
			refreshMaterial: "old-rt",
		};

		const delta = {
			accessToken: "new-at",
			refreshMaterial: "new-rt",
			accessTokenExpiresAt: "2026-12-31T00:00:00Z",
		};

		const result = mergeTokenDelta(snapshot, delta);

		expect(result.accessToken).toBe("new-at");
		expect(result.refreshMaterial).toBe("new-rt");
		expect(result.accessTokenExpiresAt).toBe("2026-12-31T00:00:00Z");
	});
});

describe("orchestration / bearerHeader", () => {
	it("returns Bearer header from a snapshot", () => {
		expect(bearerHeader({ accessToken: "test-token" })).toBe(
			"Bearer test-token",
		);
	});

	it("returns null when snapshot is null", () => {
		expect(bearerHeader(null)).toBeNull();
	});

	it("returns null when snapshot is undefined", () => {
		expect(bearerHeader(undefined)).toBeNull();
	});
});

describe("orchestration / persistence", () => {
	function makeStore(): {
		store: ReturnType<typeof createInMemoryRecordStore>;
		persistence: AuthStatePersistence;
	} {
		const store = createInMemoryRecordStore();
		const persistence = createAuthStatePersistence({
			store,
			key: "test-orchestration:v1",
			now: () => Date.parse("2026-01-01T00:00:00Z"),
		});
		return { store, persistence };
	}

	const sampleSnapshot: AuthSnapshot = {
		tokens: {
			accessToken: "at-1",
			refreshMaterial: "rt-1",
			accessTokenExpiresAt: "2026-12-31T00:00:00Z",
		},
		metadata: {
			principal: {
				subject: "user-1",
				displayName: "User One",
			},
		},
	};

	it("round-trips a snapshot through save/load", async () => {
		const { persistence } = makeStore();

		await persistence.save(sampleSnapshot);
		const loaded = await persistence.load();

		expect(loaded).toEqual(sampleSnapshot);
	});

	it("returns null when nothing is persisted", async () => {
		const { persistence } = makeStore();

		const loaded = await persistence.load();

		expect(loaded).toBeNull();
	});

	it("clears persisted state", async () => {
		const { persistence } = makeStore();

		await persistence.save(sampleSnapshot);
		await persistence.clear();
		const loaded = await persistence.load();

		expect(loaded).toBeNull();
	});

	it("rejects invalid JSON", async () => {
		const { store, persistence } = makeStore();

		await store.set("test-orchestration:v1", "{not-json");

		await expect(persistence.load()).rejects.toMatchObject({
			code: "token_orchestration.persistence.invalid_json",
		});
	});

	it("rejects unsupported version", async () => {
		const { store, persistence } = makeStore();

		await store.set(
			"test-orchestration:v1",
			JSON.stringify({
				version: 99,
				storedAt: Date.parse("2026-01-01T00:00:00Z"),
				value: sampleSnapshot,
			}),
		);

		await expect(persistence.load()).rejects.toMatchObject({
			code: "token_orchestration.persistence.unsupported_version",
		});
	});

	it("rejects snapshot with missing accessToken", async () => {
		const { store, persistence } = makeStore();

		await store.set(
			"test-orchestration:v1",
			JSON.stringify({
				version: 1,
				storedAt: Date.parse("2026-01-01T00:00:00Z"),
				value: { tokens: {}, metadata: {} },
			}),
		);

		await expect(persistence.load()).rejects.toMatchObject({
			code: "token_orchestration.persistence.invalid_snapshot",
		});
	});
});

describe("orchestration / authorized-transport", () => {
	it("injects bearer header when authorization is available", async () => {
		const captured: Record<string, string>[] = [];
		const transport = createAuthorizedTransport(
			{ authorizationHeader: () => "Bearer my-token" },
			{
				transport: {
					async execute(request) {
						captured.push({ ...request.headers });
						return { status: 200, headers: {} };
					},
				},
			},
		);

		await transport.execute({
			url: "https://api.example.com/resource",
			method: "GET",
			headers: {},
		});

		expect(captured).toHaveLength(1);
		expect(captured[0]?.authorization).toBe("Bearer my-token");
	});

	it("throws when authorization is unavailable and required", async () => {
		const transport = createAuthorizedTransport(
			{ authorizationHeader: () => null },
			{
				transport: {
					async execute() {
						return { status: 200, headers: {} };
					},
				},
			},
		);

		await expect(
			transport.execute({
				url: "https://api.example.com/resource",
				method: "GET",
				headers: {},
			}),
		).rejects.toMatchObject({
			code: "token_orchestration.authorization.unavailable",
		});
	});

	it("passes through when authorization is unavailable but not required", async () => {
		const transport = createAuthorizedTransport(
			{ authorizationHeader: () => null },
			{
				transport: {
					async execute() {
						return { status: 200, headers: {} };
					},
				},
				requireAuthorization: false,
			},
		);

		const result = await transport.execute({
			url: "https://api.example.com/resource",
			method: "GET",
			headers: {},
		});

		expect(result.status).toBe(200);
	});
});
