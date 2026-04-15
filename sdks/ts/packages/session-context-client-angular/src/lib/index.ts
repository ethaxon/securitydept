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
	Injectable,
	InjectionToken,
	type Provider,
	signal,
} from "@angular/core";
import type { HttpTransport, RecordStore } from "@securitydept/client";
import {
	SessionContextClient,
	type SessionContextClientConfig,
	type SessionInfo,
} from "@securitydept/session-context-client";

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

// ---------------------------------------------------------------------------
// Service facade
// ---------------------------------------------------------------------------

/**
 * Angular service facade for `SessionContextClient`.
 *
 * Provides Angular signal-based state, auto-probe on construction,
 * and convenience methods. Automatically cleans up on component teardown.
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
	/** Current session info as an Angular signal. */
	readonly session = signal<SessionInfo | null>(null);
	/** Whether the initial session probe is in progress. */
	readonly loading = signal(true);

	constructor(
		/** The underlying SDK client instance. */
		readonly client: SessionContextClient,
		private readonly transport: HttpTransport,
	) {
		// Auto-probe session on construction.
		this.refresh();
	}

	/** Re-fetch session info from the server. */
	refresh(): void {
		this.loading.set(true);
		this.client
			.fetchUserInfo(this.transport)
			.then((result) => {
				this.session.set(result);
				this.loading.set(false);
			})
			.catch(() => {
				this.session.set(null);
				this.loading.set(false);
			});
	}

	/** Check whether a session exists. Derived from the session signal. */
	isAuthenticated(): boolean {
		return this.session() !== null;
	}

	/** Build the login URL. */
	loginUrl(postAuthRedirectUri?: string): string {
		return this.client.loginUrl(postAuthRedirectUri);
	}

	/** Build the logout URL. */
	logoutUrl(): string {
		return this.client.logoutUrl();
	}

	/** Save a pending login redirect. */
	async savePendingLoginRedirect(uri: string): Promise<void> {
		return this.client.savePendingLoginRedirect(uri);
	}

	/** Consume the pending login redirect. */
	async consumePendingLoginRedirect(): Promise<string | null> {
		return this.client.consumePendingLoginRedirect();
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
	/** HTTP transport for /user-info probing. */
	transport: HttpTransport;
	sessionStore?: RecordStore;
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
 *       transport: myTransport,
 *     }),
 *   ],
 * };
 * ```
 */
export function provideSessionContext(
	options: ProvideSessionContextOptions,
): Provider[] {
	const client = new SessionContextClient(options.config, {
		sessionStore: options.sessionStore,
	});
	return [
		{
			provide: SESSION_CONTEXT_CLIENT,
			useValue: client,
		},
		{
			provide: SESSION_CONTEXT_TRANSPORT,
			useValue: options.transport,
		},
		{
			provide: SessionContextService,
			deps: [SESSION_CONTEXT_CLIENT, SESSION_CONTEXT_TRANSPORT],
			useFactory: (c: SessionContextClient, t: HttpTransport) =>
				new SessionContextService(c, t),
		},
	];
}
