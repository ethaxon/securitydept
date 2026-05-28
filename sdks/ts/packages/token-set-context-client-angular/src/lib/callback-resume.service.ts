import {
	DestroyRef,
	Injectable,
	inject,
	signal,
	type WritableSignal,
} from "@angular/core";
import {
	createOnceAsyncLockCallable,
	createSignal,
	type DisposableTrait,
} from "@securitydept/client";
import { signalToObservable } from "@securitydept/client/rx";
import { bridgeToAngularSignal } from "@securitydept/client-angular";
import { type AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import {
	type ClientRegistry as CoreClientRegistry,
	FrontendOidcModeCallbackController,
	type FrontendOidcModeCallbackInput,
	type FrontendOidcModeCallbackResult,
	type FrontendOidcModeCallbackState,
} from "@securitydept/token-set-context-client/registry";
import { type Observable } from "rxjs";
import { TokenSetAuthRegistry } from "./token-set-auth.registry";

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
	private readonly stateSignal = createSignal<FrontendOidcModeCallbackState>(
		createIdleCallbackLock(),
	);
	readonly state: WritableSignal<FrontendOidcModeCallbackState> = signal(
		this.stateSignal.get(),
	);
	readonly state$: Observable<FrontendOidcModeCallbackState> =
		signalToObservable(this.stateSignal);

	constructor() {
		const cleanup = bridgeToAngularSignal(this.stateSignal, this.state);
		this.destroyRef?.onDestroy(() => {
			cleanup();
			this.reset();
		});
	}

	/**
	 * Check whether a URL is an OIDC authorization callback for any registered
	 * client in this registry.
	 *
	 * This is a convenience wrapper over callback-url record lookup. Use it for
	 * programmatic early-exit guards (e.g. in a service constructor) before
	 * calling `handleCallback()`.
	 *
	 * @param url - The full URL to check (e.g. `window.location.href`).
	 * @returns `true` when the URL matches a registered callback path and
	 *   contains an `code` or `error` query parameter.
	 */
	isCallback(url: string): boolean {
		return this.createController({ currentUrl: url }).isCallback();
	}

	resume(
		options: FrontendOidcModeCallbackInput,
	): Promise<FrontendOidcModeCallbackResult>;
	resume(
		callbackUrl: string,
		explicitClientKey?: string,
	): Promise<FrontendOidcModeCallbackResult>;
	resume(
		optionsOrCallbackUrl: FrontendOidcModeCallbackInput | string,
		explicitClientKey?: string,
	): Promise<FrontendOidcModeCallbackResult> {
		const controller = this.createController(
			typeof optionsOrCallbackUrl === "string"
				? {
						currentUrl: optionsOrCallbackUrl,
						clientQuery: explicitClientKey
							? { clientKey: explicitClientKey }
							: undefined,
					}
				: optionsOrCallbackUrl,
		);
		const unsubscribe = controller.state.subscribe(() => {
			this.stateSignal.set(controller.state.get());
		});
		this.stateSignal.set(controller.state.get());
		return controller.handle().finally(unsubscribe);
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
			clientKey: result.clientRecord.meta.clientKey,
			snapshot: result.snapshot,
			resumeUrl: result.postAuthRedirectUri ?? "/",
		};
	}

	reset(): void {
		this.stateSignal.set(createIdleCallbackLock());
	}

	private createController(
		options: FrontendOidcModeCallbackInput,
	): FrontendOidcModeCallbackController {
		return new FrontendOidcModeCallbackController({
			registry: this.registry
				.core as unknown as CoreClientRegistry<DisposableTrait>,
			currentUrl: options.currentUrl,
			clientQuery: options.clientQuery,
		});
	}
}

function createIdleCallbackLock(): FrontendOidcModeCallbackState {
	return createOnceAsyncLockCallable(async () => {
		throw new Error("[CallbackResumeService] No callback has been started.");
	});
}
