// React-native per-client service wrapper
//
// The React counterpart of the Angular `TokenSetAuthService`. Unlike Angular,
// React does not have signals + RxJS as first-class framework primitives;
// instead we expose an external-store `subscribe`/`getSnapshot` pair so hooks
// can use `useSyncExternalStore` directly.
//
// Stability: provisional (new in iteration 110)

import type { EventStreamTrait } from "@securitydept/client";
import {
	type AuthSnapshot,
	type EnsureAuthForResourceOptions,
	type EnsureAuthForResourceResult,
	type EnsureAuthorizationHeaderOptions,
	type EnsureFreshAuthStateOptions,
	getTokenFreshness,
	TokenFreshnessState,
	type TokenSetAuthEvent,
} from "@securitydept/token-set-context-client/orchestration";
import type { TokenSetReactClient } from "./contracts";

/**
 * Per-client React-native wrapper around an OIDC mode client.
 *
 * Owns the auto-restore promise and subscription teardown; hooks build on
 * top of `getState` / `subscribe` via `useSyncExternalStore`.
 */
export class TokenSetAuthService {
	readonly client: TokenSetReactClient;
	readonly restorePromise: Promise<AuthSnapshot | null> | null;
	readonly authEvents: EventStreamTrait<TokenSetAuthEvent>;
	private disposed = false;

	constructor(client: TokenSetReactClient, autoRestore: boolean) {
		this.client = client;
		this.authEvents = client.authEvents;
		this.restorePromise = autoRestore ? client.restorePersistedState() : null;
	}

	/** Current auth snapshot, or null when unauthenticated. */
	getState(): AuthSnapshot | null {
		return this.client.state.get();
	}

	/** Subscribe to auth state changes — returns an unsubscribe fn. */
	subscribe(listener: () => void): () => void {
		return this.client.state.subscribe(listener);
	}

	isAuthenticated(): boolean {
		return this.accessToken() !== null;
	}

	accessToken(): string | null {
		const snapshot = this.getState();
		if (!isFreshOrUsable(snapshot)) {
			return null;
		}
		return snapshot?.tokens.accessToken ?? null;
	}

	async ensureFreshAuthState(
		options?: EnsureFreshAuthStateOptions,
	): Promise<AuthSnapshot | null> {
		return await this.client.ensureFreshAuthState(options);
	}

	async ensureAuthForResource(
		options?: EnsureAuthForResourceOptions,
	): Promise<EnsureAuthForResourceResult> {
		return await this.client.ensureAuthForResource(options);
	}

	async ensureAccessToken(
		options?: EnsureFreshAuthStateOptions,
	): Promise<string | null> {
		return (
			(await this.ensureFreshAuthState(options))?.tokens.accessToken ?? null
		);
	}

	async ensureAuthorizationHeader(
		options?: EnsureAuthorizationHeaderOptions,
	): Promise<string | null> {
		return await this.client.ensureAuthorizationHeader(options);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		try {
			this.client.dispose();
		} catch {
			// Swallow — best effort.
		}
	}
}

function isFreshOrUsable(snapshot: AuthSnapshot | null): boolean {
	const freshness = getTokenFreshness(snapshot, {
		now: Date.now(),
		clockSkewMs: 30_000,
		refreshWindowMs: 0,
	});
	return (
		freshness === TokenFreshnessState.Fresh ||
		freshness === TokenFreshnessState.RefreshDue ||
		freshness === TokenFreshnessState.NoExpiry
	);
}
