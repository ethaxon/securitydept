import { signal, type WritableSignal } from "@angular/core";
import { toRxObservable } from "@securitydept/client/rx";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetAuthService as CoreTokenSetAuthService,
	type TokenSetAuthServiceState,
} from "@securitydept/token-set-context-client/registry";
import { map, type Observable } from "rxjs";
import type { TokenSetAngularClient } from "./contracts";

// ============================================================================
// 5. TokenSetAuthService — per-client service wrapper
// ============================================================================

/**
 * Per-client Angular service that bridges a single OIDC mode client to
 * Angular signals + RxJS.
 *
 * Lifecycle teardown is explicit. Construct with
 * `new TokenSetAuthService(client, autoRestore)` and call `.dispose()` when
 * the service owner tears down. The shared registry core handles this
 * automatically — adopters that wire the service directly (rare) must call
 * `dispose()` themselves, typically bound to a `DestroyRef.onDestroy`.
 */
export class TokenSetAuthService extends CoreTokenSetAuthService<TokenSetAngularClient> {
	/** Current auth snapshot as an Angular signal. */
	readonly authState: WritableSignal<AuthSnapshot | null>;
	/** Full core service state as an RxJS Observable bridge. */
	readonly state$: Observable<TokenSetAuthServiceState>;
	/** Current auth snapshot as an RxJS Observable. */
	readonly authState$: Observable<AuthSnapshot | null>;

	private readonly cleanup: () => void;

	constructor(client: TokenSetAngularClient, autoRestore: boolean) {
		super(client, autoRestore);
		this.authState = signal<AuthSnapshot | null>(this.state.get().snapshot);
		this.state$ = toRxObservable(this.state);
		this.authState$ = this.state$.pipe(map((state) => state.snapshot));
		this.cleanup = this.state.subscribe(() => {
			this.authState.set(this.state.get().snapshot);
		});
	}

	override dispose(): void {
		this.cleanup();
		super.dispose();
	}
}
