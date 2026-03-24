import type { HttpRequest, HttpTransport } from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	UserRecovery,
} from "@securitydept/client";
import { TokenSetContextSource } from "./types";

export interface AuthorizationHeaderProviderTrait {
	authorizationHeader(): string | null;
}

export interface CreateTokenSetAuthorizedTransportOptions {
	transport: HttpTransport;
	requireAuthorization?: boolean;
}

/**
 * Wrap a transport so every request carries the current token-set bearer.
 *
 * The wrapper is explicit and request-scoped: it never patches global fetch.
 * By default it also refuses to silently fall back to cookie/session auth.
 */
export function createTokenSetAuthorizedTransport(
	authorizationProvider: AuthorizationHeaderProviderTrait,
	options: CreateTokenSetAuthorizedTransportOptions,
): HttpTransport {
	const requireAuthorization = options.requireAuthorization ?? true;

	return {
		async execute(request: HttpRequest) {
			const authorization = authorizationProvider.authorizationHeader();
			if (!authorization) {
				if (!requireAuthorization) {
					return options.transport.execute(request);
				}
				throw new ClientError({
					kind: ClientErrorKind.Unauthenticated,
					message: "Token-set authorization header is unavailable",
					code: "token_set.authorization.unavailable",
					recovery: UserRecovery.Reauthenticate,
					source: TokenSetContextSource.Client,
				});
			}

			return options.transport.execute({
				...request,
				headers: {
					...request.headers,
					authorization,
				},
			});
		},
	};
}
