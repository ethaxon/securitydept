import {
	HTTP_INTERCEPTORS,
	type HttpEvent,
	type HttpHandler,
	type HttpInterceptor,
	type HttpRequest,
} from "@angular/common/http";
import {
	Injectable,
	InjectionToken,
	inject,
	type Provider,
} from "@angular/core";
import { TokenSetAuthFlowSource } from "@securitydept/token-set-context-client/orchestration";
import { from, type Observable, switchMap } from "rxjs";
import { TokenSetAuthRegistry } from "./token-set-auth-registry";

// ============================================================================
// 7. Class-based HTTP interceptor + provider factory
// ============================================================================

/**
 * Adopter-tunable behaviour for the token-set bearer interceptor.
 *
 * Iteration 150 (review 1) lifted `strictUrlMatch` out of the implicit
 * single-client convenience path into an explicit option, so multi-backend
 * adopters can guarantee that bearer tokens never leak outside the URL
 * patterns they registered with `provideTokenSetAuth({ clients: [...] })`.
 */
export interface BearerInterceptorOptions {
	/**
	 * When `true`, the interceptor injects a bearer header ONLY for requests
	 * whose URL matches a registered client's `urlPatterns`. Requests with no
	 * matching client receive no `Authorization` header even when a token is
	 * available elsewhere in the registry.
	 *
	 * When `false` (default, single-client convenience), the interceptor
	 * falls back to `registry.accessToken()` for unmatched URLs — useful only
	 * when the host issues all HTTP traffic to one already-known backend.
	 *
	 * Adopters with more than one backend, more than one OIDC audience, or
	 * any third-party HTTP traffic from the same Angular host MUST set this
	 * to `true` to prevent cross-origin token leakage.
	 *
	 * @default false
	 */
	strictUrlMatch?: boolean;
}

/**
 * DI token for {@link BearerInterceptorOptions}. Adopters normally configure
 * options via `provideTokenSetBearerInterceptor({ ... })`; the token is
 * exported for advanced cases where the options need to be supplied or
 * overridden separately (for example, in tests).
 */
export const TOKEN_SET_BEARER_INTERCEPTOR_OPTIONS =
	new InjectionToken<BearerInterceptorOptions>(
		"TOKEN_SET_BEARER_INTERCEPTOR_OPTIONS",
	);

/**
 * Angular class-based bearer-token interceptor (`HTTP_INTERCEPTORS` style).
 *
 * Selects the correct access token from the multi-client registry by URL
 * pattern. Behaviour for unmatched URLs is governed by
 * {@link BearerInterceptorOptions.strictUrlMatch}.
 *
 * Prefer the functional version via `createTokenSetBearerInterceptor()` +
 * `withInterceptors()` when using `provideHttpClient`. Use this class-based
 * version when you need classic `HTTP_INTERCEPTORS` multi-provider style
 * (e.g. NgModule apps).
 *
 * @example
 * ```ts
 * // NgModule providers:
 * provideTokenSetBearerInterceptor({ strictUrlMatch: true })
 * ```
 */
@Injectable()
export class TokenSetBearerInterceptor implements HttpInterceptor {
	private readonly registry = inject(TokenSetAuthRegistry);
	private readonly options: BearerInterceptorOptions =
		inject(TOKEN_SET_BEARER_INTERCEPTOR_OPTIONS, { optional: true }) ?? {};

	intercept(
		req: HttpRequest<unknown>,
		next: HttpHandler,
	): Observable<HttpEvent<unknown>> {
		const key = this.registry.clientKeyForUrl(req.url);
		// When a client key matches but the client is still initializing
		// (async clientFactory not yet resolved), registry.get() returns
		// undefined. This is an explicit design decision: interceptors do NOT
		// block the HTTP request waiting for client initialization.
		// Responsibility for "ensure client is ready before making requests"
		// belongs to route guards (which use whenReady() to await readiness).
		// A not-yet-ready client correctly produces no token → request proceeds
		// without Authorization header.
		return from(
			resolveAuthorizationForRequest(this.registry, req.url, key, {
				strictUrlMatch: this.options.strictUrlMatch,
			}),
		).pipe(
			switchMap((authorization) => {
				if (!authorization) {
					return next.handle(req);
				}
				return next.handle(
					req.clone({ setHeaders: { Authorization: authorization } }),
				);
			}),
		);
	}
}

/**
 * Create an `HTTP_INTERCEPTORS` multi-provider entry for bearer token injection.
 *
 * Returns a single `Provider` object that registers {@link TokenSetBearerInterceptor}
 * as a class-based HTTP interceptor. Suitable for NgModule `providers` arrays.
 *
 * For functional-interceptor style (standalone apps using `provideHttpClient`),
 * use `createTokenSetBearerInterceptor()` with `withInterceptors()` instead.
 *
 * @example
 * ```ts
 * @NgModule({
 *   providers: [
 *     provideTokenSetAuth({ clients: [...] }),
 *     provideTokenSetBearerInterceptor(),     // <— replaces hand-written AuthInterceptor
 *     provideHttpClient(withInterceptorsFromDi()),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
/**
 * Create an `HTTP_INTERCEPTORS` multi-provider entry for bearer token injection.
 *
 * Returns Angular providers that register {@link TokenSetBearerInterceptor}
 * as a class-based HTTP interceptor and (optionally) the
 * {@link BearerInterceptorOptions} that govern its URL-match behaviour.
 * Suitable for NgModule `providers` arrays.
 *
 * For functional-interceptor style (standalone apps using `provideHttpClient`),
 * use `createTokenSetBearerInterceptor()` with `withInterceptors()` instead.
 *
 * @example
 * ```ts
 * @NgModule({
 *   providers: [
 *     provideTokenSetAuth({ clients: [...] }),
 *     // Adopters with multiple backends or any third-party HTTP traffic
 *     // MUST opt into strictUrlMatch to prevent token leakage.
 *     provideTokenSetBearerInterceptor({ strictUrlMatch: true }),
 *     provideHttpClient(withInterceptorsFromDi()),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export function provideTokenSetBearerInterceptor(
	options?: BearerInterceptorOptions,
): Provider[] {
	const providers: Provider[] = [
		{
			provide: HTTP_INTERCEPTORS,
			useClass: TokenSetBearerInterceptor,
			multi: true,
		},
	];
	if (options) {
		providers.push({
			provide: TOKEN_SET_BEARER_INTERCEPTOR_OPTIONS,
			useValue: options,
		});
	}
	return providers;
}

/**
 * Create an Angular `HttpInterceptorFn` that injects bearer authorization
 * headers, selecting the correct token from the multi-client registry
 * based on URL pattern matching.
 *
 * If no URL pattern matches, falls back to the first available token
 * (single-client convenience).
 *
 * ## Async client readiness
 *
 * The interceptor does **not** block or delay the HTTP request waiting for
 * an async client to materialize. If a client is still initializing when the
 * request fires, the request proceeds without an Authorization header.
 *
 * This is intentional: blocking HTTP for client initialization would deadlock
 * apps that make HTTP requests during initialization itself. Route guards
 * (which use `registry.whenReady()`) are the correct place to enforce
 * "client must be ready before user reaches this route".
 *
 * For NgModule-style apps using `HTTP_INTERCEPTORS`, use
 * `provideTokenSetBearerInterceptor()` instead.
 *
 * @example
 * ```ts
 * import { provideHttpClient, withInterceptors } from "@angular/common/http";
 * import { createTokenSetBearerInterceptor } from "@securitydept/token-set-context-client-angular";
 *
 * provideHttpClient(withInterceptors([
 *   createTokenSetBearerInterceptor(registry),
 * ]));
 * ```
 */
/**
 * Create an Angular `HttpInterceptorFn` that injects bearer authorization
 * headers, selecting the correct token from the multi-client registry
 * based on URL pattern matching.
 *
 * If no URL pattern matches, the unmatched-URL behaviour is governed by
 * {@link BearerInterceptorOptions.strictUrlMatch}: the default falls back
 * to `registry.accessToken()` (single-client convenience), while
 * `strictUrlMatch: true` returns no token, ensuring bearer headers are
 * never injected for URLs outside the registered patterns.
 *
 * ## Async client readiness
 *
 * The interceptor does **not** block or delay the HTTP request waiting for
 * an async client to materialize. If a client is still initializing when the
 * request fires, the request proceeds without an Authorization header.
 *
 * This is intentional: blocking HTTP for client initialization would deadlock
 * apps that make HTTP requests during initialization itself. Route guards
 * (which use `registry.whenReady()`) are the correct place to enforce
 * "client must be ready before user reaches this route".
 *
 * For NgModule-style apps using `HTTP_INTERCEPTORS`, use
 * `provideTokenSetBearerInterceptor()` instead.
 *
 * @example
 * ```ts
 * import { provideHttpClient, withInterceptors } from "@angular/common/http";
 * import { createTokenSetBearerInterceptor } from "@securitydept/token-set-context-client-angular";
 *
 * provideHttpClient(withInterceptors([
 *   createTokenSetBearerInterceptor(registry, { strictUrlMatch: true }),
 * ]));
 * ```
 */
export function createTokenSetBearerInterceptor(
	registry: TokenSetAuthRegistry,
	options: BearerInterceptorOptions = {},
) {
	return (
		req: {
			url: string;
			clone(update: { setHeaders?: Record<string, string> }): unknown;
		},
		next: (req: unknown) => Observable<unknown>,
	): Observable<unknown> => {
		// Try URL-pattern-based client selection first.
		const key = registry.clientKeyForUrl(req.url);
		// Explicit not-yet-ready semantics: if the client exists in metadata
		// (via clientKeyForUrl) but registry.get() returns undefined because the
		// async clientFactory has not resolved yet, the request proceeds without
		// a token. See class-based interceptor above for full rationale.
		return from(
			resolveAuthorizationForRequest(registry, req.url, key, options),
		).pipe(
			switchMap((authorization) => {
				if (!authorization) {
					return next(req);
				}
				return next(
					req.clone({ setHeaders: { Authorization: authorization } }),
				);
			}),
		);
	};
}

async function resolveAuthorizationForRequest(
	registry: TokenSetAuthRegistry,
	url: string,
	key: string | undefined,
	options: BearerInterceptorOptions,
): Promise<string | null> {
	if (!key && options.strictUrlMatch) {
		return null;
	}

	const result = await registry.ensureAuthForResource({
		key,
		waitForReady: false,
		source: TokenSetAuthFlowSource.HttpInterceptor,
		needsAuthorizationHeader: true,
		forceRefreshWhenDue: true,
		url,
	});
	return result?.authorizationHeader ?? null;
}
