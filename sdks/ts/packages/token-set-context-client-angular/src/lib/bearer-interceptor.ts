import {
	HTTP_INTERCEPTORS,
	type HttpEvent,
	type HttpHandler,
	type HttpInterceptor,
	type HttpRequest,
} from "@angular/common/http";
import { Injectable, inject, type Provider } from "@angular/core";
import type { Observable } from "rxjs";
import { TokenSetAuthRegistry } from "./token-set-auth-registry";

// ============================================================================
// 7. Class-based HTTP interceptor + provider factory
// ============================================================================

/**
 * Angular class-based bearer-token interceptor (`HTTP_INTERCEPTORS` style).
 *
 * Selects the correct access token from the multi-client registry by URL
 * pattern, falling back to the first available token for single-client apps.
 *
 * Prefer the functional version via `createTokenSetBearerInterceptor()` +
 * `withInterceptors()` when using `provideHttpClient`. Use this class-based
 * version when you need classic `HTTP_INTERCEPTORS` multi-provider style
 * (e.g. NgModule apps).
 *
 * @example
 * ```ts
 * // NgModule providers:
 * provideTokenSetBearerInterceptor()
 * ```
 */
@Injectable()
export class TokenSetBearerInterceptor implements HttpInterceptor {
	private readonly registry = inject(TokenSetAuthRegistry);

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
		const token = key
			? (this.registry.get(key)?.accessToken() ?? null)
			: this.registry.accessToken();

		if (!token) {
			return next.handle(req);
		}
		const authReq = req.clone({
			setHeaders: { Authorization: `Bearer ${token}` },
		});
		return next.handle(authReq);
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
export function provideTokenSetBearerInterceptor(): Provider {
	return {
		provide: HTTP_INTERCEPTORS,
		useClass: TokenSetBearerInterceptor,
		multi: true,
	};
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
export function createTokenSetBearerInterceptor(
	registry: TokenSetAuthRegistry,
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
		const token = key
			? (registry.get(key)?.accessToken() ?? null)
			: registry.accessToken();

		if (!token) {
			return next(req);
		}
		const authReq = req.clone({
			setHeaders: { Authorization: `Bearer ${token}` },
		});
		return next(authReq);
	};
}
