// React-native per-client service wrapper
//
// The React counterpart of the Angular `TokenSetAuthService`. Unlike Angular,
// React does not have signals + RxJS as first-class framework primitives;
// instead we expose an external-store `subscribe`/`getSnapshot` pair so hooks
// can use `useSyncExternalStore` directly.
//
// Stability: provisional (new in iteration 110)

import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
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
	private disposed = false;

	constructor(client: TokenSetReactClient, autoRestore: boolean) {
		this.client = client;
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
		return this.getState() !== null;
	}

	accessToken(): string | null {
		return this.getState()?.tokens.accessToken ?? null;
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
