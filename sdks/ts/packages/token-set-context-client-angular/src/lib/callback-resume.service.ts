import {
	DestroyRef,
	Injectable,
	inject,
	signal,
	type WritableSignal,
} from "@angular/core";
import {
	bridgeToAngularSignal,
	signalToObservable,
} from "@securitydept/client-angular";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetCallbackResumeController,
	type TokenSetCallbackResumeOptions,
	type TokenSetCallbackResumeResult,
	type TokenSetCallbackResumeState,
} from "@securitydept/token-set-context-client/registry";
import type { Observable } from "rxjs";
import type { TokenSetAuthService } from "./token-set-auth.service";
import { TokenSetAuthRegistry } from "./token-set-auth-registry";

/**
 * Angular-native service for handling OIDC redirect callbacks,
 * with multi-client discrimination support.
 *
 * The post-authentication redirect URI is propagated automatically through
 * the core client's pending state (set via `loginWithRedirect({ postAuthRedirectUri })`
 * and recovered in `handleCallback()`). No manual URL storage is required.
 *
 * @example
 * ```ts
 * @Component({ ... })
 * export class AuthCallbackComponent {
 *   private readonly callbackService = inject(CallbackResumeService);
 *   private readonly router = inject(Router);
 *
 *   async ngOnInit() {
 *     const result = await this.callbackService.handleCallback(
 *       window.location.href,
 *     );
 *     this.router.navigateByUrl(result.resumeUrl, { replaceUrl: true });
 *   }
 * }
 * ```
 */
@Injectable()
export class CallbackResumeService {
	private readonly registry = inject(TokenSetAuthRegistry);
	private readonly destroyRef = inject(DestroyRef, { optional: true });
	private readonly controller =
		new TokenSetCallbackResumeController<TokenSetAuthService>({
			registry: this.registry.core,
			getCallbackClient: (service) => service.client,
		});
	readonly state: WritableSignal<TokenSetCallbackResumeState> = signal(
		this.controller.getState(),
	);
	readonly state$: Observable<TokenSetCallbackResumeState> = signalToObservable(
		this.controller.state,
	);

	constructor() {
		const cleanup = bridgeToAngularSignal(this.controller.state, this.state);
		this.destroyRef?.onDestroy(() => {
			cleanup();
			this.controller.dispose();
		});
	}

	/**
	 * Check whether a URL is an OIDC authorization callback for any registered
	 * client in this registry.
	 *
	 * This is a convenience wrapper over `clientKeyForCallback()`. Use it for
	 * programmatic early-exit guards (e.g. in a service constructor) before
	 * calling `handleCallback()`.
	 *
	 * @param url - The full URL to check (e.g. `window.location.href`).
	 * @returns `true` when the URL matches a registered callback path and
	 *   contains an `code` or `error` query parameter.
	 */
	isCallback(url: string): boolean {
		return this.controller.isCallback(url);
	}

	getState(): TokenSetCallbackResumeState {
		return this.controller.getState();
	}

	resume(
		options: TokenSetCallbackResumeOptions,
	): Promise<TokenSetCallbackResumeResult>;
	resume(
		callbackUrl: string,
		explicitClientKey?: string,
	): Promise<TokenSetCallbackResumeResult>;
	resume(
		optionsOrCallbackUrl: TokenSetCallbackResumeOptions | string,
		explicitClientKey?: string,
	): Promise<TokenSetCallbackResumeResult> {
		return this.controller.resume(
			typeof optionsOrCallbackUrl === "string"
				? { currentUrl: optionsOrCallbackUrl, clientKey: explicitClientKey }
				: optionsOrCallbackUrl,
		);
	}

	/**
	 * Handle the OIDC callback, auto-detecting which client the callback
	 * belongs to via registered callback paths.
	 *
	 * The `resumeUrl` in the result is taken directly from the core client's
	 * pending state (`postAuthRedirectUri` set at `loginWithRedirect()` time),
	 * falling back to `"/"` when no redirect URI was recorded.
	 *
	 * @param callbackUrl - The full current URL (e.g. `window.location.href`).
	 * @param explicitClientKey - Optional: force-select a client key instead of
	 *   auto-detecting from registered callback paths.
	 */
	async handleCallback(
		callbackUrl: string,
		explicitClientKey?: string,
	): Promise<{
		clientKey: string;
		snapshot: AuthSnapshot;
		/** The URL to navigate to after a successful callback. */
		resumeUrl: string;
	}> {
		const result = await this.resume(callbackUrl, explicitClientKey);
		return {
			clientKey: result.clientKey,
			snapshot: result.snapshot,
			resumeUrl: result.postAuthRedirectUri ?? "/",
		};
	}
}
