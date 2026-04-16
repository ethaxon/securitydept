import { signal, type WritableSignal } from "@angular/core";
import {
	bridgeToAngularSignal,
	signalToObservable,
} from "@securitydept/client-angular";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import type { Observable } from "rxjs";
import type { TokenSetAngularClient } from "./contracts";

// ============================================================================
// 5. TokenSetAuthService — per-client service wrapper
// ============================================================================

/**
 * Per-client Angular service that bridges a single OIDC mode client to
 * Angular signals + RxJS.
 *
 * Iteration 110 change: lifecycle teardown is now explicit. Construct with
 * `new TokenSetAuthService(client, autoRestore)` and call `.dispose()` when
 * the service owner tears down. The shared registry core handles this
 * automatically — adopters that wire the service directly (rare) must call
 * `dispose()` themselves, typically bound to a `DestroyRef.onDestroy`.
 */
export class TokenSetAuthService {
	/** Current auth snapshot as an Angular signal. */
	readonly authState: WritableSignal<AuthSnapshot | null>;
	/** Current auth snapshot as an RxJS Observable. */
	readonly authState$: Observable<AuthSnapshot | null>;
	/** Promise that resolves when initial state restore completes (or null if skipped). */
	readonly restorePromise: Promise<AuthSnapshot | null> | null;

	private readonly cleanup: () => void;
	private disposed = false;

	constructor(
		/** The underlying SDK client instance. */
		readonly client: TokenSetAngularClient,
		autoRestore: boolean,
	) {
		this.authState = signal<AuthSnapshot | null>(null);
		this.cleanup = bridgeToAngularSignal(client.state, this.authState);
		this.authState$ = signalToObservable(client.state);
		this.restorePromise = autoRestore ? client.restorePersistedState() : null;
	}

	/** Whether the user is currently authenticated. */
	isAuthenticated(): boolean {
		return this.authState() !== null;
	}

	/** Current access token, or null. */
	accessToken(): string | null {
		return this.authState()?.tokens.accessToken ?? null;
	}

	/**
	 * Release all resources owned by this service.
	 *
	 * - Unsubscribes the SDK state bridge
	 * - Calls `client.dispose()`
	 *
	 * Idempotent: subsequent calls are no-ops. Called by the shared registry
	 * at teardown; adopters invoking TokenSetAuthService directly must call
	 * this themselves (typically bound to `DestroyRef.onDestroy`).
	 */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		try {
			this.cleanup();
		} catch {
			// Swallow — best effort.
		}
		try {
			this.client.dispose();
		} catch {
			// Swallow — best effort.
		}
	}
}
