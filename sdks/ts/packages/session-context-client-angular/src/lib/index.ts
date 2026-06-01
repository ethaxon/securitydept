// Angular adapter for @securitydept/session-context-client
//
// Canonical import path:
//   import { ... } from "@securitydept/session-context-client-angular"
//
// Provides Angular-native DI integration: InjectionToken, provider factory,
// and an Injectable SessionContextClient subclass.
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
import { ENVIRONMENT } from "@securitydept/client-angular";
import {
	SessionContextClient,
	type SessionContextClientConfig,
} from "@securitydept/session-context-client";

// ---------------------------------------------------------------------------
// InjectionToken
// ---------------------------------------------------------------------------

/**
 * Angular `InjectionToken` for `SessionContextClient`.
 *
 * Use {@link provideSessionContext} to register the client in the injector,
 * then inject via `inject(SESSION_CONTEXT_CLIENT)` or constructor injection.
 */
export const SESSION_CONTEXT_CLIENT = new InjectionToken<SessionContextClient>(
	"SESSION_CONTEXT_CLIENT",
);

export const SESSION_CONTEXT_CLIENT_CONFIG =
	new InjectionToken<SessionContextClientConfig>(
		"SESSION_CONTEXT_CLIENT_CONFIG",
	);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Angular-injectable `SessionContextClient`.
 *
 * Extends the SDK client directly so Angular consumers do not depend on a
 * wrapper facade that can drift from the core API.
 */
@Injectable()
export class SessionContextService extends SessionContextClient {
	constructor(injector: Injector) {
		const config = injector.get(SESSION_CONTEXT_CLIENT_CONFIG);
		const environment = injector.get(ENVIRONMENT);
		super(config, environment);
		injector.get(DestroyRef).onDestroy(() => this.dispose());
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
 *     provideEnvironment({
 *       createBaseEnvironment: createEnvironmentForNativeWeb,
 *       ...
 *     }),
 *     provideSessionContext({ config: { baseUrl: "/api", autoStart: true } }),
 *   ],
 * };
 * ```
 */
export function provideSessionContext(
	options: ProvideSessionContextOptions,
): Provider[] {
	return [
		{
			provide: SESSION_CONTEXT_CLIENT_CONFIG,
			useValue: options.config,
		},
		{
			provide: SessionContextService,
			useFactory: (injector: Injector) => new SessionContextService(injector),
			deps: [Injector],
		},
		{
			provide: SESSION_CONTEXT_CLIENT,
			useExisting: SessionContextService,
		},
	];
}
