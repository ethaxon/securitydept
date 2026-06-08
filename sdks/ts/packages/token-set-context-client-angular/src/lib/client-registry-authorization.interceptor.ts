import {
	HTTP_INTERCEPTORS,
	type HttpEvent,
	type HttpHandler,
	type HttpHandlerFn,
	type HttpInterceptor,
	type HttpInterceptorFn,
	type HttpRequest,
} from "@angular/common/http";
import {
	Injectable,
	InjectionToken,
	inject,
	type Provider,
} from "@angular/core";
import { from, type Observable, switchMap } from "rxjs";
import { TokenSetClientRegistryService } from "./client-registry.service";

export interface TokenSetClientRegistryAuthorizationRequest {
	url: string;
	clone(update: { setHeaders?: Record<string, string> }): unknown;
}

export type TokenSetClientRegistryAuthorizationForRequest = (
	registry: TokenSetClientRegistryService,
	request: TokenSetClientRegistryAuthorizationRequest,
) => Promise<string | null | undefined> | string | null | undefined;

export interface TokenSetClientRegistryAuthorizationInterceptorProviderOptions {
	/**
	 * Resolves the Authorization header value for a request.
	 *
	 * The default implementation selects a registered client by request URL,
	 * initializes that client, and reads its replayed authorization header.
	 */
	authorizationForRequest?: TokenSetClientRegistryAuthorizationForRequest;
}

export interface TokenSetClientRegistryAuthorizationInterceptorOptions
	extends TokenSetClientRegistryAuthorizationInterceptorProviderOptions {
	registry?: TokenSetClientRegistryService;
}

export const TOKEN_SET_CLIENT_REGISTRY_AUTHORIZATION_FOR_REQUEST =
	new InjectionToken<TokenSetClientRegistryAuthorizationForRequest>(
		"TOKEN_SET_CLIENT_REGISTRY_AUTHORIZATION_FOR_REQUEST",
	);

@Injectable()
export class TokenSetClientRegistryAuthorizationInterceptor
	implements HttpInterceptor
{
	private readonly registry = inject(TokenSetClientRegistryService);
	private readonly authorizationForRequest =
		inject(TOKEN_SET_CLIENT_REGISTRY_AUTHORIZATION_FOR_REQUEST, {
			optional: true,
		}) ?? defaultTokenSetClientRegistryAuthorizationForRequest;

	intercept(
		req: HttpRequest<unknown>,
		next: HttpHandler,
	): Observable<HttpEvent<unknown>> {
		return from(
			Promise.resolve(this.authorizationForRequest(this.registry, req)),
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

export function provideTokenSetClientRegistryAuthorizationInterceptor(
	options?: TokenSetClientRegistryAuthorizationInterceptorProviderOptions,
): Provider[] {
	const providers: Provider[] = [
		{
			provide: HTTP_INTERCEPTORS,
			useClass: TokenSetClientRegistryAuthorizationInterceptor,
			multi: true,
		},
	];
	if (options) {
		if (options.authorizationForRequest) {
			providers.push({
				provide: TOKEN_SET_CLIENT_REGISTRY_AUTHORIZATION_FOR_REQUEST,
				useValue: options.authorizationForRequest,
			});
		}
	}
	return providers;
}

export function createTokenSetClientRegistryAuthorizationInterceptor(
	options?: TokenSetClientRegistryAuthorizationInterceptorOptions,
): HttpInterceptorFn {
	return function tokenSetClientRegistryAuthorizationInterceptorFn(
		req: HttpRequest<unknown>,
		next: HttpHandlerFn,
	): Observable<HttpEvent<unknown>> {
		const registry = options?.registry ?? inject(TokenSetClientRegistryService);
		const authorizationForRequest =
			options?.authorizationForRequest ??
			(options
				? null
				: inject(TOKEN_SET_CLIENT_REGISTRY_AUTHORIZATION_FOR_REQUEST, {
						optional: true,
					})) ??
			defaultTokenSetClientRegistryAuthorizationForRequest;
		return from(Promise.resolve(authorizationForRequest(registry, req))).pipe(
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

export async function defaultTokenSetClientRegistryAuthorizationForRequest(
	registry: TokenSetClientRegistryService,
	request: TokenSetClientRegistryAuthorizationRequest,
): Promise<string | null> {
	const record = await registry.clientRecordForQuery(
		{
			url: request.url,
		},
		{ initialize: true },
	);
	if (!record) {
		return null;
	}

	const header = await record.client.authorizationHeaderValue.whenValue();
	return header ?? null;
}
