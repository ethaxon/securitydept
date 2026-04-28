import type { HttpRequest, HttpTransport } from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	UserRecovery,
} from "@securitydept/client";

const AUTH_TRANSPORT_SOURCE = "token-orchestration-transport";

/**
 * Trait for anything that can provide a bearer authorization header.
 *
 * This is protocol-agnostic: it asks for a header string, not for how
 * the token was obtained.
 */
export interface BearerHeaderProvider {
	/** Raw synchronous projection. Prefer ensureAuthorizationHeader when available. */
	authorizationHeader(): string | null;
}

export interface AsyncBearerHeaderProvider {
	ensureAuthorizationHeader(): Promise<string | null>;
}

export interface CreateAuthorizedTransportOptions {
	transport: HttpTransport;
	requireAuthorization?: boolean;
}

/**
 * Wrap an HttpTransport to inject a bearer authorization header on every
 * request.
 *
 * This helper is generic token orchestration: it does not care about
 * OIDC-mediated sealed flow or any specific OIDC protocol.
 */
export function createAuthorizedTransport(
	headerProvider: BearerHeaderProvider | AsyncBearerHeaderProvider,
	options: CreateAuthorizedTransportOptions,
): HttpTransport {
	const requireAuthorization = options.requireAuthorization ?? true;

	return {
		async execute(request: HttpRequest) {
			const authorization = await resolveAuthorizationHeader(headerProvider);
			if (!authorization) {
				if (!requireAuthorization) {
					return options.transport.execute(request);
				}
				throw new ClientError({
					kind: ClientErrorKind.Unauthenticated,
					message: "Authorization header is unavailable",
					code: "token_orchestration.authorization.unavailable",
					recovery: UserRecovery.Reauthenticate,
					source: AUTH_TRANSPORT_SOURCE,
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

function resolveAuthorizationHeader(
	headerProvider: BearerHeaderProvider | AsyncBearerHeaderProvider,
): Promise<string | null> | string | null {
	if ("ensureAuthorizationHeader" in headerProvider) {
		return headerProvider.ensureAuthorizationHeader();
	}
	return headerProvider.authorizationHeader();
}
