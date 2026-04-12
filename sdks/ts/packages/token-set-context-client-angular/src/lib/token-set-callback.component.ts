import { Component, inject, type OnInit } from "@angular/core";
import { Router } from "@angular/router";
import { CallbackResumeService } from "./callback-resume.service";

// ============================================================================
// 9. TokenSetCallbackComponent — drop-in standalone callback route component
// ============================================================================

/**
 * Drop-in standalone Angular component for OIDC redirect callback routes.
 *
 * Handles the full callback lifecycle on initialization:
 *   1. Calls `CallbackResumeService.handleCallback()` with the current URL.
 *   2. Navigates to `result.resumeUrl` (the post-auth redirect set at login time).
 *   3. On error: logs and falls back to navigating to `"/"`.
 *
 * Register as a route component — no additional glue needed:
 * ```ts
 * import { TokenSetCallbackComponent } from "@securitydept/token-set-context-client-angular";
 *
 * export const routes: Routes = [
 *   { path: "auth/callback", component: TokenSetCallbackComponent },
 * ];
 * ```
 *
 * For custom error handling or UI, subclass this component or build your own
 * using `CallbackResumeService` directly.
 */
@Component({
	selector: "token-set-callback",
	standalone: true,
	template: "",
})
export class TokenSetCallbackComponent implements OnInit {
	private readonly callbackService = inject(CallbackResumeService);
	private readonly router = inject(Router);

	ngOnInit(): void {
		const currentUrl = window.location.href;
		if (!this.callbackService.isCallback(currentUrl)) {
			// Not a callback URL — navigate home to avoid processing errors.
			this.router.navigateByUrl("/", { replaceUrl: true });
			return;
		}

		this.callbackService
			.handleCallback(currentUrl)
			.then((result) => {
				this.router.navigateByUrl(result.resumeUrl, { replaceUrl: true });
			})
			.catch((error: unknown) => {
				console.error(
					"[TokenSetCallbackComponent] Callback handling failed:",
					error,
				);
				this.router.navigateByUrl("/", { replaceUrl: true });
			});
	}
}
