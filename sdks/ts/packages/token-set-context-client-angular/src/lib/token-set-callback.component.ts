import { Component, inject, type OnInit } from "@angular/core";
import { Router } from "@angular/router";
import { CallbackResumeService } from "./callback-resume.service";
import {
	TOKEN_SET_CALLBACK_COMPONENT_OPTIONS,
	TOKEN_SET_CALLBACK_CURRENT_URL,
} from "./tokens";

// ============================================================================
// 9. TokenSetCallbackComponent — drop-in standalone callback route component
// ============================================================================

/**
 * Drop-in standalone Angular component for OIDC redirect callback routes.
 *
 * Handles the full callback lifecycle on initialization:
 *   1. Calls `CallbackResumeService.resume()` with the current URL.
 *   2. Navigates to the post-auth redirect set at login time.
 *   3. On error: calls the optional `onError` hook and navigates to the
 *      configured error target (default `"/"`).
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
 * Host policy can override `fallbackUrl`, `errorRedirectUrl`, and `onError`
 * through `TOKEN_SET_CALLBACK_COMPONENT_OPTIONS`. For fully custom UI or
 * orchestration, build your own component around `CallbackResumeService`.
 */
@Component({
	selector: "token-set-callback",
	standalone: true,
	template: "",
})
export class TokenSetCallbackComponent implements OnInit {
	private readonly callbackService = inject(CallbackResumeService);
	private readonly router = inject(Router);
	private readonly getCurrentUrl = inject(TOKEN_SET_CALLBACK_CURRENT_URL);
	private readonly options = inject(TOKEN_SET_CALLBACK_COMPONENT_OPTIONS, {
		optional: true,
	}) ?? {
		fallbackUrl: "/",
		errorRedirectUrl: "/",
	};

	ngOnInit(): void {
		const fallbackUrl = this.options.fallbackUrl ?? "/";
		const errorRedirectUrl = this.options.errorRedirectUrl ?? fallbackUrl;
		const currentUrl = this.getCurrentUrl();
		if (!currentUrl || !this.callbackService.isCallback(currentUrl)) {
			this.router.navigateByUrl(fallbackUrl, { replaceUrl: true });
			return;
		}

		this.callbackService
			.resume(currentUrl)
			.then((result) => {
				this.router.navigateByUrl(result.postAuthRedirectUri ?? "/", {
					replaceUrl: true,
				});
			})
			.catch((error: unknown) => {
				this.options.onError?.(error);
				this.router.navigateByUrl(errorRedirectUrl, { replaceUrl: true });
			});
	}
}
