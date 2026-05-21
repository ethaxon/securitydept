import { createSignal, createSubject } from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	type AuthSnapshot,
	bearerHeader,
	EnsureAuthForResourceStatus,
	TokenFreshnessState,
	type TokenSetAuthEvent,
} from "../../orchestration";
import { TokenSetAuthServiceRestoreStatus } from "../contracts/types";
import { TokenSetAuthService } from "../core/service";

function createAuthSnapshot(
	accessToken: string,
	options?: {
		expiresAt?: string;
	},
): AuthSnapshot {
	return {
		tokens: {
			accessToken,
			accessTokenIssuedAt: new Date(Date.now() - 60_000).toISOString(),
			accessTokenExpiresAt:
				options?.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
		},
		metadata: {},
	};
}

function createOidcClient(options?: {
	initialSnapshot?: AuthSnapshot | null;
	restore?: () => Promise<AuthSnapshot | null>;
}) {
	const state = createSignal<AuthSnapshot | null>(
		options?.initialSnapshot ?? null,
	);
	const authEvents = createSubject<TokenSetAuthEvent>();
	return {
		state,
		authEvents,
		dispose: vi.fn<() => void>(() => undefined),
		restorePersistedState: vi.fn(options?.restore ?? (async () => state.get())),
		authorizationHeader: vi.fn(() => bearerHeader(state.get()?.tokens ?? null)),
		ensureAuthForResource: vi.fn(async () => {
			const snapshot = state.get();
			if (!snapshot) {
				return {
					status: EnsureAuthForResourceStatus.Unauthenticated,
					snapshot: null,
					authorizationHeader: null,
					reason: "no_snapshot" as const,
				};
			}
			return {
				status: EnsureAuthForResourceStatus.Authenticated,
				snapshot,
				authorizationHeader: bearerHeader(snapshot.tokens) ?? undefined,
				freshness: TokenFreshnessState.Fresh,
			};
		}),
		ensureFreshAuthState: vi.fn(async () => state.get()),
		ensureAuthorizationHeader: vi.fn(async () =>
			bearerHeader(state.get()?.tokens ?? null),
		),
	};
}

describe("TokenSetAuthService", () => {
	it("derives initial state from client.state and stays synchronized", () => {
		const snapshot = createAuthSnapshot("initial-token");
		const client = createOidcClient({ initialSnapshot: snapshot });
		const service = new TokenSetAuthService(client, false);

		expect(service.state.get()).toMatchObject({
			snapshot,
			accessToken: "initial-token",
			authorizationHeader: "Bearer initial-token",
			isAuthenticated: true,
			freshness: TokenFreshnessState.Fresh,
			restoreStatus: TokenSetAuthServiceRestoreStatus.Skipped,
			restoreError: null,
			disposed: false,
		});

		const nextSnapshot = createAuthSnapshot("next-token");
		client.state.set(nextSnapshot);
		expect(service.state.get()).toMatchObject({
			snapshot: nextSnapshot,
			accessToken: "next-token",
			authorizationHeader: "Bearer next-token",
		});

		client.state.set(null);
		expect(service.state.get()).toMatchObject({
			snapshot: null,
			accessToken: null,
			authorizationHeader: null,
			isAuthenticated: false,
		});
	});

	it("tracks successful autoRestore lifecycle in state", async () => {
		const restored = createAuthSnapshot("restored-token");
		let client!: ReturnType<typeof createOidcClient>;
		client = createOidcClient({
			restore: async () => {
				client.state.set(restored);
				return restored;
			},
		});
		const service = new TokenSetAuthService(client, true);

		expect(service.state.get().restoreStatus).toBe(
			TokenSetAuthServiceRestoreStatus.Restoring,
		);
		await expect(service.restorePromise).resolves.toEqual(restored);
		expect(service.state.get()).toMatchObject({
			snapshot: restored,
			accessToken: "restored-token",
			restoreStatus: TokenSetAuthServiceRestoreStatus.Restored,
			restoreError: null,
		});
	});

	it("clears an existing auth snapshot when autoRestore resolves to null", async () => {
		const initialSnapshot = createAuthSnapshot("initial-token");
		const client = createOidcClient({
			initialSnapshot,
			restore: async () => {
				client.state.set(null);
				return null;
			},
		});
		const service = new TokenSetAuthService(client, true);

		await expect(service.restorePromise).resolves.toBeNull();
		expect(service.state.get()).toMatchObject({
			snapshot: null,
			accessToken: null,
			authorizationHeader: null,
			isAuthenticated: false,
			restoreStatus: TokenSetAuthServiceRestoreStatus.Restored,
			restoreError: null,
		});
	});

	it("tracks failed autoRestore lifecycle in state", async () => {
		const error = new Error("restore failed");
		const client = createOidcClient({
			restore: async () => {
				throw error;
			},
		});
		const service = new TokenSetAuthService(client, true);

		await expect(service.restorePromise).rejects.toThrow("restore failed");
		expect(service.state.get()).toMatchObject({
			restoreStatus: TokenSetAuthServiceRestoreStatus.Failed,
			restoreError: error,
		});
	});

	it("exposes derived auth helpers from state", async () => {
		const expiredSnapshot = createAuthSnapshot("expired-token", {
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
		});
		const client = createOidcClient({ initialSnapshot: expiredSnapshot });
		const service = new TokenSetAuthService(client, false);

		expect(service.accessToken.get()).toBeNull();
		expect(service.authorizationHeader.get()).toBeNull();
		expect(service.isAuthenticated.get()).toBe(false);
		await expect(service.ensureAccessToken()).resolves.toBe("expired-token");
		await expect(service.ensureAuthorizationHeader()).resolves.toBe(
			"Bearer expired-token",
		);
	});

	it("marks itself disposed, unsubscribes, and disposes the client", () => {
		const client = createOidcClient({
			initialSnapshot: createAuthSnapshot("before-dispose"),
		});
		const service = new TokenSetAuthService(client, false);

		service.dispose();
		expect(service.state.get().disposed).toBe(true);
		expect(client.dispose).toHaveBeenCalledTimes(1);

		client.state.set(createAuthSnapshot("after-dispose"));
		expect(service.state.get().snapshot?.tokens.accessToken).toBe(
			"before-dispose",
		);
	});
});
