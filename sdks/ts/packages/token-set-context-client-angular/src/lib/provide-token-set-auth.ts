import {
	type EnvironmentProviders,
	inject,
	type Provider,
	provideEnvironmentInitializer,
} from "@angular/core";
import { CallbackResumeService } from "./callback-resume.service";
import type { TokenSetClientEntry } from "./contracts";
import { TokenSetAuthRegistry } from "./token-set-auth-registry";
import { TOKEN_SET_AUTH_REGISTRY } from "./tokens";

/**
 * Options for {@link provideTokenSetAuth}.
 */
export interface ProvideTokenSetAuthOptions {
	/**
	 * Adapter/host registration entries.
	 *
	 * Each entry must have a unique `key`. The entry itself owns how one client
	 * composes auth-context config and runtime capabilities; Angular DI here only
	 * owns host registration, readiness wiring, and lifecycle.
	 */
	clients: TokenSetClientEntry[];
	/**
	 * When true (default), schedule `registry.idleWarmup()` during Angular
	 * environment initialization so `priority: "lazy"` clients get
	 * preloaded in the browser's idle callback.
	 *
	 * Disable for tests that want deterministic, manual materialization
	 * control.
	 *
	 * @default true
	 */
	idleWarmup?: boolean;
}

/**
 * Create Angular providers for the multi-client token-set auth integration.
 *
 * Registers all services into Angular DI so adopters can directly inject
 * `TokenSetAuthRegistry`, `CallbackResumeService`, and look up individual
 * `TokenSetAuthService` instances by key.
 *
 * ## Async client initialization
 *
 * When a client's `clientFactory` returns a `Promise` (e.g. because it
 * needs to fetch a config projection from a backend endpoint), the
 * registry tracks its initialization state automatically. Guards and
 * interceptors should use `registry.whenReady(key)` to await
 * materialization before accessing the service.
 *
 * @example
 * ```ts
 * import { provideTokenSetAuth } from "@securitydept/token-set-context-client-angular";
 * import { resolveConfigProjection, networkConfigSource, createFrontendOidcModeClient }
 *   from "@securitydept/token-set-context-client/frontend-oidc-mode";
 *
 * export const appConfig = {
 *   providers: [
 *     provideTokenSetAuth({
 *       clients: [
 *         {
 *           key: "main",
 *           // Async clientFactory: fetches config projection from backend
 *           clientFactory: async () => {
 *             const resolved = await resolveConfigProjection([
 *               networkConfigSource({
 *                 apiEndpoint: "https://api.example.com/api",
 *                 redirectUri: `${location.origin}/auth/callback`,
 *               }),
 *             ]);
 *             return createFrontendOidcModeClient(resolved.config, runtime);
 *           },
 *           urlPatterns: ["/api/"],
 *           callbackPath: "/auth/callback",
 *         },
 *       ],
 *     }),
 *   ],
 * };
 * ```
 */
export function provideTokenSetAuth(
	options: ProvideTokenSetAuthOptions,
): (Provider | EnvironmentProviders)[] {
	return [
		// Registry is a singleton — all clients share one registry.
		{
			provide: TokenSetAuthRegistry,
			useFactory: () => new TokenSetAuthRegistry(),
		},
		// Eagerly register all client entries during environment initialization.
		// provideEnvironmentInitializer runs in injection context, so inject() works.
		// Note: async clientFactories create promises that the registry tracks;
		// the initializer does not block Angular bootstrap on them (guards/interceptors
		// use registry.whenReady() instead).
		provideEnvironmentInitializer(() => {
			const registry = inject(TokenSetAuthRegistry);
			for (const entry of options.clients) {
				registry.register(entry);
			}
			if (options.idleWarmup !== false) {
				// Kick off idle-time preload for any lazy clients. The cancel
				// handle is intentionally discarded — teardown happens through
				// the registry's own DestroyRef binding at dispose time.
				registry.idleWarmup();
			}
		}),
		// Token for direct registry access.
		{
			provide: TOKEN_SET_AUTH_REGISTRY,
			useExisting: TokenSetAuthRegistry,
		},
		// Callback resume service.
		CallbackResumeService,
	];
}
