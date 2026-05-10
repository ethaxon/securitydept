// Angular adapter for @securitydept/session-context-client
//
// Canonical import path:
//   import { ... } from "@securitydept/session-context-client-angular"
//
// Provides Angular-native DI integration: InjectionToken, provider factory,
// Injectable service facade with Angular signal state bridging.
//
// Built by ng-packagr (APF / FESM2022). Decorators are fully supported.
//
// Stability: provisional (framework adapter)

import {
	type DestroyRef,
	Injectable,
	InjectionToken,
	type Provider,
	signal,
	type WritableSignal,
} from "@angular/core";
import type { HttpTransport, WebClientEnvironment } from "@securitydept/client";
import {
	bridgeToAngularSignal,
	signalToObservable,
} from "@securitydept/client-angular";
import {
	SessionContextClient,
	type SessionContextClientConfig,
	SessionContextController,
	type SessionContextControllerState,
	type SessionInfo,
} from "@securitydept/session-context-client";
import type { Observable } from "rxjs";

// ---------------------------------------------------------------------------
// InjectionTokens
// ---------------------------------------------------------------------------

/**
 * Angular `InjectionToken` for `SessionContextClient`.
 */
export const SESSION_CONTEXT_CLIENT = new InjectionToken<SessionContextClient>(
	"SESSION_CONTEXT_CLIENT",
);

/**
 * Angular `InjectionToken` for the HTTP transport used by session context.
 */
export const SESSION_CONTEXT_TRANSPORT = new InjectionToken<HttpTransport>(
	"SESSION_CONTEXT_TRANSPORT",
);

export const SESSION_CONTEXT_CONTROLLER =
	new InjectionToken<SessionContextController>("SESSION_CONTEXT_CONTROLLER");

// ---------------------------------------------------------------------------
// Service facade
// ---------------------------------------------------------------------------

/**
 * Angular service facade for `SessionContextClient`.
 *
 * Provides Angular signal-based state over the framework-neutral controller
 * and convenience methods. The canonical browser-shell path is
 * `rememberPostAuthRedirect()` + `resolveLoginUrl()` + `logout()`.
 * Low-level escape hatches stay on `auth.client`, not on the Angular service
 * facade itself. Automatically cleans up on component teardown.
 *
 * @example
 * ```ts
 * @Component({ template: `{{ auth.session()?.principal?.displayName }}` })
 * export class ProfileComponent {
 *   readonly auth = inject(SessionContextService);
 * }
 * ```
 */
@Injectable()
export class SessionContextService {
	/** Full controller state as an Angular signal. */
	readonly state: WritableSignal<SessionContextControllerState>;
	readonly state$: Observable<SessionContextControllerState>;
	/** Current session info as an Angular signal. */
	readonly session: WritableSignal<SessionInfo | null>;
	/** Whether a session probe is in progress. */
	readonly loading: WritableSignal<boolean>;
	readonly error: WritableSignal<unknown | null>;

	private readonly cleanup: () => void;

	constructor(
		/** Framework-neutral controller owner. */
		readonly controller: SessionContextController,
		destroyRef?: DestroyRef,
	) {
		const initialState = controller.getState();
		this.state = signal<SessionContextControllerState>(initialState);
		this.state$ = signalToObservable(controller.state);
		this.session = signal<SessionInfo | null>(initialState.session);
		this.loading = signal(initialState.status === "loading");
		this.error = signal<unknown | null>(initialState.error);
		this.cleanup = bridgeToAngularSignal(controller.state, this.state);
		const unsubscribe = controller.subscribe(() => {
			const next = controller.getState();
			this.session.set(next.session);
			this.loading.set(next.status === "loading");
			this.error.set(next.error);
		});
		destroyRef?.onDestroy(() => {
			this.cleanup();
			unsubscribe();
		});
	}

	/** The underlying SDK client instance. */
	get client(): SessionContextClient {
		return this.controller.client;
	}

	/** Re-fetch session info from the server. */
	async refresh(): Promise<SessionInfo | null> {
		return await this.controller.refresh();
	}

	/** Check whether a session exists. Derived from the session signal. */
	isAuthenticated(): boolean {
		return this.session() !== null;
	}

	/** Save a pending login redirect using the canonical browser-shell vocabulary. */
	async rememberPostAuthRedirect(uri: string): Promise<void> {
		return this.controller.rememberPostAuthRedirect(uri);
	}

	/** Clear any pending post-auth redirect intent. */
	async clearPostAuthRedirect(): Promise<void> {
		return this.controller.clearPostAuthRedirect();
	}

	/** Resolve the next login URL by consuming any pending redirect intent. */
	async resolveLoginUrl(): Promise<string> {
		return this.controller.resolveLoginUrl();
	}

	/** Execute logout and clear any stale pending redirect intent. */
	async logout(): Promise<void> {
		await this.controller.logout();
	}
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Options for {@link provideSessionContext}.
 */
export interface ProvideSessionContextOptions {
	config: SessionContextClientConfig;
	/** Framework composition-root environment for transport and session state. */
	environment: WebClientEnvironment;
	/** Explicitly start an initial session probe from the provider. */
	initialRefresh?: boolean;
}

/**
 * Create Angular providers for `SessionContextClient`.
 *
 * @example
 * ```ts
 * import { provideSessionContext } from "@securitydept/session-context-client-angular";
 *
 * export const appConfig = {
 *   providers: [
 *     provideSessionContext({
 *       config: { baseUrl: "/api" },
 *       environment: myEnvironment,
 *     }),
 *   ],
 * };
 * ```
 */
export function provideSessionContext(
	options: ProvideSessionContextOptions,
): Provider[] {
	const client = new SessionContextClient(options.config, {
		sessionStore: options.environment.sessionStore,
	});
	const controller = new SessionContextController({
		client,
		transport: options.environment.transport,
	});
	if (options.initialRefresh) {
		controller.refresh().catch(() => {});
	}
	return [
		{
			provide: SESSION_CONTEXT_CLIENT,
			useValue: client,
		},
		{
			provide: SESSION_CONTEXT_CONTROLLER,
			useValue: controller,
		},
		{
			provide: SESSION_CONTEXT_TRANSPORT,
			useValue: options.environment.transport,
		},
		{
			provide: SessionContextService,
			deps: [SESSION_CONTEXT_CONTROLLER],
			useFactory: (controller: SessionContextController) =>
				new SessionContextService(controller),
		},
	];
}
