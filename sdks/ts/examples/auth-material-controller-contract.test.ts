// Auth Material Controller Contract Test
//
// This test serves as adopter-facing evidence that the AuthMaterialController
// provides a real, usable thin control layer for protocol-agnostic token
// material lifecycle.
//
// It demonstrates:
//   1. Standard OIDC / backend-issued token material scenario — adopter
//      receives tokens from any source and manages them through the controller
//   2. Full lifecycle: apply → header projection → transport → persist → restore → clear
//   3. Only /orchestration subpath imports — no token-set sealed flow semantics
//
// What the controller does NOT handle (and is not tested here):
//   - Token acquisition (redirect, callback, metadata redemption)
//   - Specific OIDC protocol handling
//   - Multi-provider orchestration or refresh scheduling
//
// Stability: provisional (same as /orchestration subpath contract)
// Semantic layer: MinimalEntry only — this proves public-contract / adopter
// usability, not host capability (Node.js / browser / React / fetch).

import { createInMemoryRecordStore } from "@securitydept/client";
import type {
	AuthSnapshot,
	AuthSource,
} from "@securitydept/token-set-context-client/orchestration";
import {
	AuthSourceKind,
	createAuthMaterialController,
} from "@securitydept/token-set-context-client/orchestration";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A. Minimal lifecycle — no persistence
// ---------------------------------------------------------------------------

describe("AuthMaterialController / minimal lifecycle (no persistence)", () => {
	it("starts with no snapshot and null header", () => {
		const controller = createAuthMaterialController();

		expect(controller.snapshot).toBeNull();
		expect(controller.authorizationHeader).toBeNull();
		expect(controller.persistence).toBeNull();
	});

	it("projects bearer header after applySnapshot", async () => {
		const controller = createAuthMaterialController();

		await controller.applySnapshot({
			tokens: { accessToken: "oidc-at" },
			metadata: {},
		});

		expect(controller.authorizationHeader).toBe("Bearer oidc-at");
		expect(controller.snapshot?.tokens.accessToken).toBe("oidc-at");
	});

	it("creates a transport that injects the current bearer on each request", async () => {
		const controller = createAuthMaterialController();
		await controller.applySnapshot({
			tokens: { accessToken: "backend-at" },
			metadata: {},
		});

		const captured: string[] = [];
		const transport = controller.createTransport({
			async execute(req) {
				captured.push(req.headers.authorization ?? "(none)");
				return { status: 200, headers: {} };
			},
		});

		await transport.execute({
			url: "https://api.example.com/resource",
			method: "GET",
			headers: {},
		});

		expect(captured[0]).toBe("Bearer backend-at");
	});

	it("transport throws when no token is present and requireAuthorization is true (default)", async () => {
		const controller = createAuthMaterialController();
		const transport = controller.createTransport({
			async execute() {
				return { status: 200, headers: {} };
			},
		});

		await expect(
			transport.execute({
				url: "https://api.example.com/",
				method: "GET",
				headers: {},
			}),
		).rejects.toMatchObject({
			code: "token_orchestration.authorization.unavailable",
		});
	});

	it("clearState resets snapshot and header to null", async () => {
		const controller = createAuthMaterialController();
		await controller.applySnapshot({
			tokens: { accessToken: "at-to-clear" },
			metadata: {},
		});

		await controller.clearState();

		expect(controller.snapshot).toBeNull();
		expect(controller.authorizationHeader).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// B. Lifecycle with persistence — standard OIDC / backend-issued token material
// ---------------------------------------------------------------------------

describe("AuthMaterialController / full lifecycle with persistence", () => {
	it("saves and restores token material from a durable store", async () => {
		const store = createInMemoryRecordStore();
		const controller = createAuthMaterialController({
			persistence: { store, key: "auth:oidc-adopter:v1", now: Date.now },
		});

		// Scenario: user completes OIDC exchange; adopter calls applySnapshot
		// with the received token material.
		const source: AuthSource = {
			kind: AuthSourceKind.OidcAuthorizationCode,
			providerId: "idp-prod",
		};
		await controller.applySnapshot({
			tokens: {
				accessToken: "oidc-at-1",
				refreshMaterial: "oidc-rt-1",
				accessTokenExpiresAt: "2026-12-31T00:00:00Z",
			},
			metadata: { source },
		});

		// Simulate page reload: new controller reads from same store
		const reloaded = createAuthMaterialController({
			persistence: { store, key: "auth:oidc-adopter:v1", now: Date.now },
		});

		const restored = await reloaded.restoreFromPersistence();

		expect(restored).not.toBeNull();
		expect(restored?.tokens.accessToken).toBe("oidc-at-1");
		expect(restored?.tokens.refreshMaterial).toBe("oidc-rt-1");
		expect(restored?.metadata.source?.kind).toBe(
			AuthSourceKind.OidcAuthorizationCode,
		);
		// Bearer projection is immediately available after restore
		expect(reloaded.authorizationHeader).toBe("Bearer oidc-at-1");
	});

	it("clears persisted state when clearState is called with clearPersisted:true", async () => {
		const store = createInMemoryRecordStore();
		const controller = createAuthMaterialController({
			persistence: { store, key: "auth:adopter-clear:v1", now: Date.now },
		});

		await controller.applySnapshot({
			tokens: { accessToken: "at-to-clear" },
			metadata: {},
		});

		await controller.clearState({ clearPersisted: true });

		// A new controller from the same store should find nothing
		const after = createAuthMaterialController({
			persistence: { store, key: "auth:adopter-clear:v1", now: Date.now },
		});
		const restored = await after.restoreFromPersistence();
		expect(restored).toBeNull();
	});

	it("supports backend-issued token material (ForwardedBearer scenario)", async () => {
		// Scenario: the backend issues a bearer token directly (no OIDC redirect flow).
		// The adopter places it in the controller and uses it for API calls.
		const controller = createAuthMaterialController();

		const snapshot: AuthSnapshot = {
			tokens: { accessToken: "backend-issued-at" },
			metadata: {
				source: { kind: AuthSourceKind.ForwardedBearer },
			},
		};

		await controller.applySnapshot(snapshot);

		// The transport carries the backend-issued bearer with no protocol-specific glue.
		const captured: Record<string, string>[] = [];
		const transport = controller.createTransport({
			async execute(req) {
				captured.push({ ...req.headers });
				return { status: 200, headers: {} };
			},
		});

		await transport.execute({
			url: "https://api.example.com/data",
			method: "GET",
			headers: {},
		});

		expect(captured[0]?.authorization).toBe("Bearer backend-issued-at");
	});
});

// ---------------------------------------------------------------------------
// C. injectSnapshot — synchronous in-memory state injection (no persistence)
// ---------------------------------------------------------------------------

describe("AuthMaterialController / injectSnapshot (sync, no persist)", () => {
	it("immediately makes bearer projection available without async round-trip", () => {
		const controller = createAuthMaterialController();

		// injectSnapshot is the synchronous path — no await needed.
		controller.injectSnapshot({
			tokens: { accessToken: "sync-at" },
			metadata: {},
		});

		expect(controller.authorizationHeader).toBe("Bearer sync-at");
		expect(controller.snapshot?.tokens.accessToken).toBe("sync-at");
	});
});

// ---------------------------------------------------------------------------
// D. applyDelta — externally-driven renew/update lifecycle
//
// This section proves the controller can accept token material updates
// (renew/update) without requiring the adopter to know the full current state.
// It builds directly on mergeTokenDelta semantics inside the controller.
//
// Covered scenarios:
//   - OIDC token refresh: new access_token + expires_at, preserve refresh_token
//   - Backend partial update: new access_token only, preserve all other fields
//   - Delta with new metadata (e.g. new source after provider re-auth)
//   - Persistence auto-save after delta
//   - Error when no existing snapshot
// ---------------------------------------------------------------------------

describe("AuthMaterialController / applyDelta (externally-driven renew/update)", () => {
	it("merges new access token while preserving refresh material", async () => {
		// Scenario: OIDC token refresh — server returns new access_token + expires_at
		// but does NOT issue a new refresh_token. The old refresh_token must survive.
		const controller = createAuthMaterialController();
		await controller.applySnapshot({
			tokens: {
				accessToken: "initial-at",
				refreshMaterial: "rt-to-keep",
				accessTokenExpiresAt: "2026-01-01T00:00:00Z",
			},
			metadata: { source: { kind: AuthSourceKind.OidcAuthorizationCode } },
		});

		const updated = await controller.applyDelta({
			accessToken: "refreshed-at",
			accessTokenExpiresAt: "2026-12-31T00:00:00Z",
			// refreshMaterial intentionally absent — must be preserved from snapshot
		});

		expect(updated.tokens.accessToken).toBe("refreshed-at");
		expect(updated.tokens.refreshMaterial).toBe("rt-to-keep");
		expect(updated.tokens.accessTokenExpiresAt).toBe("2026-12-31T00:00:00Z");
		// Bearer projection immediately reflects the new access token
		expect(controller.authorizationHeader).toBe("Bearer refreshed-at");
	});

	it("preserves metadata when delta options.metadata is omitted", async () => {
		// Scenario: token refresh does not change the authenticated principal.
		// The controller must preserve the original metadata (including principal/source).
		const controller = createAuthMaterialController();
		await controller.applySnapshot({
			tokens: { accessToken: "at-1" },
			metadata: {
				source: { kind: AuthSourceKind.OidcAuthorizationCode },
				principal: { subject: "user-123", displayName: "Alice" },
			},
		});

		const updated = await controller.applyDelta({ accessToken: "at-2" });

		// Metadata unchanged
		expect(updated.metadata.source?.kind).toBe(
			AuthSourceKind.OidcAuthorizationCode,
		);
		expect(updated.metadata.principal?.subject).toBe("user-123");
	});

	it("replaces metadata when options.metadata is provided", async () => {
		// Scenario: after a provider re-authentication, the source changes
		// and metadata should be updated alongside the token refresh.
		const controller = createAuthMaterialController();
		await controller.applySnapshot({
			tokens: { accessToken: "at-old", refreshMaterial: "rt-old" },
			metadata: { source: { kind: AuthSourceKind.ForwardedBearer } },
		});

		const updated = await controller.applyDelta(
			{ accessToken: "at-new" },
			{
				metadata: {
					source: { kind: AuthSourceKind.RefreshToken },
					principal: { subject: "user-456", displayName: "Bob" },
				},
			},
		);

		expect(updated.metadata.source?.kind).toBe(AuthSourceKind.RefreshToken);
		expect(updated.metadata.principal?.subject).toBe("user-456");
		// Token fields not in the delta are preserved
		expect(updated.tokens.refreshMaterial).toBe("rt-old");
	});

	it("auto-saves merged snapshot to persistence after delta", async () => {
		// Scenario: the store must always reflect the latest token material
		// after a renew/update, without the adopter explicitly calling save.
		const store = createInMemoryRecordStore();
		const controller = createAuthMaterialController({
			persistence: { store, key: "auth:delta-persist:v1", now: Date.now },
		});

		await controller.applySnapshot({
			tokens: { accessToken: "original-at", refreshMaterial: "rt-1" },
			metadata: {},
		});

		await controller.applyDelta({ accessToken: "renewed-at" });

		// New controller from same store should see the renewed access token
		const reloaded = createAuthMaterialController({
			persistence: { store, key: "auth:delta-persist:v1", now: Date.now },
		});
		const restored = await reloaded.restoreFromPersistence();

		expect(restored?.tokens.accessToken).toBe("renewed-at");
		expect(restored?.tokens.refreshMaterial).toBe("rt-1");
	});

	it("throws when applyDelta is called before any snapshot is established", async () => {
		// applyDelta requires an existing snapshot to merge into.
		// Adopters must call applySnapshot first for the initial token material.
		const controller = createAuthMaterialController();

		await expect(
			controller.applyDelta({ accessToken: "at-no-base" }),
		).rejects.toThrow(/applyDelta requires an existing snapshot/);
	});
});
