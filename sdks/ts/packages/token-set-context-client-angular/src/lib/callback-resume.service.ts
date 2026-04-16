import { Injectable, inject } from "@angular/core";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
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
		return this.registry.clientKeyForCallback(url) !== undefined;
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
		// Determine which client this callback is for.
		const clientKey =
			explicitClientKey ?? this.registry.clientKeyForCallback(callbackUrl);
		if (!clientKey) {
			throw new Error(
				`[CallbackResumeService] Cannot determine which client this callback belongs to. ` +
					`URL: ${callbackUrl}. Register callbackPath in the client entry.`,
			);
		}

		// Use whenReady() — not require() — so that if the client's async
		// clientFactory is still in-flight when the callback page first loads,
		// we wait for it to materialize rather than throwing.
		const service = await this.registry.whenReady(clientKey);
		const result = await service.client.handleCallback(callbackUrl);

		// postAuthRedirectUri is recovered from the core client's pending state,
		// which was stored by authorizeUrl() when loginWithRedirect() was called.
		return {
			clientKey,
			snapshot: result.snapshot,
			resumeUrl: result.postAuthRedirectUri ?? "/",
		};
	}
}
