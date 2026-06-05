import { type ReadableSignalTrait, type ResourceTrait } from "../../signals";

export type AuthorizationSignal =
	| ReadableSignalTrait<string | null | undefined>
	| ResourceTrait<string | null | undefined>;

export type AuthorizationInterceptedFetchPredicate = (
	input: RequestInfo | URL,
	init: RequestInit | undefined,
) => boolean | Promise<boolean>;

export interface CreateAuthorizationInterceptedFetchOptions {
	readonly predicate: AuthorizationInterceptedFetchPredicate;
	readonly authorization: AuthorizationSignal;
}

export function createAuthorizationInterceptedFetch(
	fetchImpl: typeof fetch,
	options: CreateAuthorizationInterceptedFetchOptions,
): typeof fetch {
	return async (input, init) => {
		if (!(await options.predicate(input, init))) {
			return fetchImpl(input, init);
		}
		const authorization =
			"whenValue" in options.authorization
				? await options.authorization.whenValue()
				: options.authorization.get();
		if (!authorization) {
			return fetchImpl(input, init);
		}
		const headers = new Headers(
			typeof Request !== "undefined" && input instanceof Request
				? input.headers
				: undefined,
		);
		if (init?.headers) {
			new Headers(init.headers).forEach((value, key) => {
				headers.set(key, value);
			});
		}
		headers.set("authorization", authorization);
		return fetchImpl(input, {
			...init,
			headers,
		});
	};
}
