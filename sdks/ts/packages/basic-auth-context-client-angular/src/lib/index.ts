// Angular adapter for @securitydept/basic-auth-context-client
//
// Canonical import path:
//   import { ... } from "@securitydept/basic-auth-context-client-angular"
//
// Provides Angular-native DI integration: InjectionToken, provider factory,
// and an Injectable BasicAuthContextClient subclass.
//
// Built by ng-packagr (APF / FESM2022). Decorators are fully supported.
//
// Stability: provisional (framework adapter)

import {
	DestroyRef,
	Injectable,
	InjectionToken,
	Injector,
	type Provider,
} from "@angular/core";
import {
	BasicAuthContextClient,
	type BasicAuthContextClientConfig,
} from "@securitydept/basic-auth-context-client";
import { ENVIRONMENT } from "@securitydept/client-angular";

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

export const BASIC_AUTH_CONTEXT_CLIENT_CONFIG =
	new InjectionToken<BasicAuthContextClientConfig>(
		"BASIC_AUTH_CONTEXT_CLIENT_CONFIG",
	);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Angular-injectable `BasicAuthContextClient`.
 *
 * Extends the SDK client directly so Angular consumers do not depend on a
 * wrapper facade that can drift from the core API.
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
export class BasicAuthContextService extends BasicAuthContextClient {
	constructor(injector: Injector) {
		const config = injector.get(BASIC_AUTH_CONTEXT_CLIENT_CONFIG);
		const environment = injector.get(ENVIRONMENT);
		super(config, environment);
		injector.get(DestroyRef).onDestroy(() => this.dispose());
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
 *     provideEnvironment({
 *       environment: (providers) => createEnvironmentForNativeWeb({ providers, ... }),
 *     }),
 *     provideBasicAuthContext({ config: { baseUrl: "/api", zones: [...] } }),
 *   ],
 * };
 * ```
 */
export function provideBasicAuthContext(
	options: ProvideBasicAuthContextOptions,
): Provider[] {
	return [
		{
			provide: BASIC_AUTH_CONTEXT_CLIENT_CONFIG,
			useValue: options.config,
		},
		{
			provide: BasicAuthContextService,
			useFactory: (injector: Injector) => new BasicAuthContextService(injector),
			deps: [Injector],
		},
		{
			provide: BASIC_AUTH_CONTEXT_CLIENT,
			useExisting: BasicAuthContextService,
		},
	];
}
