import { createSignal, createSubject } from "@securitydept/client";
import {
	type AuthSnapshot,
	EnsureAuthForResourceStatus,
	TokenFreshnessState,
	type TokenSetAuthEvent,
} from "@securitydept/token-set-context-client/orchestration";
import { firstValueFrom, take } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { TokenSetAuthService } from "../token-set-auth.service";

function createSnapshot(accessToken: string): AuthSnapshot {
	return {
		tokens: {
			accessToken,
			accessTokenIssuedAt: new Date(Date.now() - 60_000).toISOString(),
			accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
		},
		metadata: {},
	};
}

function createAngularClient(initialSnapshot: AuthSnapshot | null) {
	const state = createSignal<AuthSnapshot | null>(initialSnapshot);
	return {
		state,
		authEvents: createSubject<TokenSetAuthEvent>(),
		dispose: vi.fn<() => void>(() => undefined),
		restorePersistedState: vi.fn(async () => state.get()),
		handleCallback: vi.fn(async () => ({
			snapshot: createSnapshot("callback-token"),
			postAuthRedirectUri: "/after-login",
		})),
		authorizationHeader: vi.fn(() =>
			state.get() ? `Bearer ${state.get()?.tokens.accessToken}` : null,
		),
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
				freshness: TokenFreshnessState.Fresh,
				authorizationHeader: `Bearer ${snapshot.tokens.accessToken}`,
			};
		}),
		ensureFreshAuthState: vi.fn(async () => state.get()),
		ensureAuthorizationHeader: vi.fn(async () =>
			state.get() ? `Bearer ${state.get()?.tokens.accessToken}` : null,
		),
	};
}

describe("TokenSetAuthService (Angular bridge)", () => {
	it("bridges core service state into Angular signal and RxJS observable", async () => {
		const client = createAngularClient(createSnapshot("initial-token"));
		const service = new TokenSetAuthService(client, false);

		expect(service.authState()?.tokens.accessToken).toBe("initial-token");
		expect(service.state.get()).toMatchObject({
			accessToken: "initial-token",
			authorizationHeader: "Bearer initial-token",
			isAuthenticated: true,
		});

		client.state.set(createSnapshot("next-token"));
		expect(service.authState()?.tokens.accessToken).toBe("next-token");
		await expect(
			firstValueFrom(service.authState$.pipe(take(1))),
		).resolves.toMatchObject({
			tokens: expect.objectContaining({ accessToken: "next-token" }),
		});

		client.state.set(null);
		expect(service.authState()).toBeNull();
		expect(service.state.get()).toMatchObject({
			snapshot: null,
			accessToken: null,
			authorizationHeader: null,
			isAuthenticated: false,
		});
		await expect(
			firstValueFrom(service.authState$.pipe(take(1))),
		).resolves.toBe(null);
	});

	it("disposes the bridge and keeps the last snapshot stable", () => {
		const client = createAngularClient(createSnapshot("before-dispose"));
		const service = new TokenSetAuthService(client, false);

		service.dispose();
		expect(service.state.get().disposed).toBe(true);
		expect(client.dispose).toHaveBeenCalledTimes(1);

		client.state.set(createSnapshot("after-dispose"));
		expect(service.authState()?.tokens.accessToken).toBe("before-dispose");
	});
});
