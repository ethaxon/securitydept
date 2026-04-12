// Angular adapter for @securitydept/basic-auth-context-client
//
// Canonical import path:
//   import { ... } from "@securitydept/basic-auth-context-client-angular"
//
// Provides Angular-native DI integration: InjectionToken, provider factory,
// and Injectable service facade for BasicAuthContextClient.
//
// Built by ng-packagr (APF / FESM2022). Decorators are fully supported.
//
// Stability: provisional (framework adapter)

import { Injectable, InjectionToken, type Provider } from "@angular/core";
import {
	BasicAuthContextClient,
	type BasicAuthContextClientConfig,
} from "@securitydept/basic-auth-context-client";

// ---------------------------------------------------------------------------
// InjectionToken
// ---------------------------------------------------------------------------

/**
 * Angular `InjectionToken` for `BasicAuthContextClient`.
 *
 * Use {@link provideBasicAuthContext} to register the client in the injector,
 * then inject via `inject(BASIC_AUTH_CONTEXT_CLIENT)` or constructor injection.
 */
export const BASIC_AUTH_CONTEXT_CLIENT =
	new InjectionToken<BasicAuthContextClient>("BASIC_AUTH_CONTEXT_CLIENT");

// ---------------------------------------------------------------------------
// Service facade
// ---------------------------------------------------------------------------

/**
 * Angular service facade for `BasicAuthContextClient`.
 *
 * Wraps the SDK client to provide an Angular-idiomatic API surface.
 * Registered via `provideBasicAuthContext`.
 *
 * @example
 * ```ts
 * @Component({ ... })
 * export class AuthGuardComponent {
 *   private readonly auth = inject(BasicAuthContextService);
 *
 *   get isInProtectedZone(): boolean {
 *     return this.auth.isInZone(location.pathname);
 *   }
 * }
 * ```
 */
@Injectable()
export class BasicAuthContextService {
	constructor(
		/** The underlying SDK client instance. */
		readonly client: BasicAuthContextClient,
	) {}

	/** Find the zone that contains the given path. */
	zoneForPath(path: string) {
		return this.client.zoneForPath(path);
	}

	/** Check whether a path falls inside any configured zone. */
	isInZone(path: string): boolean {
		return this.client.isInZone(path);
	}

	/** Build the full login URL for a zone. */
	loginUrl(...args: Parameters<BasicAuthContextClient["loginUrl"]>): string {
		return this.client.loginUrl(...args);
	}

	/** Build the full logout URL for a zone. */
	logoutUrl(...args: Parameters<BasicAuthContextClient["logoutUrl"]>): string {
		return this.client.logoutUrl(...args);
	}

	/** Handle a 401 response within the zone system. */
	handleUnauthorized(
		...args: Parameters<BasicAuthContextClient["handleUnauthorized"]>
	) {
		return this.client.handleUnauthorized(...args);
	}
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Options for {@link provideBasicAuthContext}.
 */
export interface ProvideBasicAuthContextOptions {
	config: BasicAuthContextClientConfig;
}

/**
 * Create Angular providers for `BasicAuthContextClient`.
 *
 * @example
 * ```ts
 * import { provideBasicAuthContext } from "@securitydept/basic-auth-context-client-angular";
 *
 * export const appConfig = {
 *   providers: [
 *     provideBasicAuthContext({ config: { baseUrl: "/api", zones: [...] } }),
 *   ],
 * };
 * ```
 */
export function provideBasicAuthContext(
	options: ProvideBasicAuthContextOptions,
): Provider[] {
	const client = new BasicAuthContextClient(options.config);
	return [
		{
			provide: BASIC_AUTH_CONTEXT_CLIENT,
			useValue: client,
		},
		{
			provide: BasicAuthContextService,
			useValue: new BasicAuthContextService(client),
		},
	];
}
