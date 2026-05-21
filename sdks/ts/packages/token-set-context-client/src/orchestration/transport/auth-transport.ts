import type { HttpRequest, HttpTransport } from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	UserRecovery,
} from "@securitydept/client";
import type {
	EnsureAuthForResourceOptions,
	EnsureAuthForResourceResult,
} from "../client/base-client";
import { TokenSetAuthFlowSource } from "../events/auth-events";

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

export interface AuthForResourceProvider {
	ensureAuthForResource(
		options?: EnsureAuthForResourceOptions,
	): Promise<EnsureAuthForResourceResult>;
}

export type AuthorizationHeaderProviderTrait =
	| BearerHeaderProvider
	| AsyncBearerHeaderProvider
	| AuthForResourceProvider;

export interface CreateAuthorizedTransportOptions {
	transport: HttpTransport;
	requireAuthorization?: boolean;
	clientKey?: string;
	logicalClientId?: string;
}

export interface CreateRemappingAuthorizedTransportOptions
	extends CreateAuthorizedTransportOptions {
	remapError: (cause: unknown) => unknown;
}

/**
 * Wrap an HttpTransport to inject a bearer authorization header on every
 * request.
 *
 * This helper is generic token orchestration: it does not care about
 * OIDC-mediated sealed flow or any specific OIDC protocol.
 */
export function createAuthorizedTransport(
	headerProvider: AuthorizationHeaderProviderTrait,
	options: CreateAuthorizedTransportOptions,
): HttpTransport {
	const requireAuthorization = options.requireAuthorization ?? true;

	return {
		async execute(request: HttpRequest) {
			const authorization = await resolveAuthorizationHeader(
				headerProvider,
				options,
				request,
			);
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

export function createRemappingAuthorizedTransport(
	headerProvider: AuthorizationHeaderProviderTrait,
	options: CreateRemappingAuthorizedTransportOptions,
): HttpTransport {
	const base = createAuthorizedTransport(headerProvider, options);

	return {
		async execute(request: HttpRequest) {
			try {
				return await base.execute(request);
			} catch (cause) {
				throw options.remapError(cause);
			}
		},
	};
}

function resolveAuthorizationHeader(
	headerProvider: AuthorizationHeaderProviderTrait,
	options: CreateAuthorizedTransportOptions,
	request: HttpRequest,
): Promise<string | null> | string | null {
	if ("ensureAuthForResource" in headerProvider) {
		return headerProvider
			.ensureAuthForResource({
				source: TokenSetAuthFlowSource.AuthorizedTransport,
				needsAuthorizationHeader: true,
				forceRefreshWhenDue: true,
				clientKey: options.clientKey,
				logicalClientId: options.logicalClientId,
				url: request.url,
			})
			.then((result) => result.authorizationHeader ?? null);
	}
	if ("ensureAuthorizationHeader" in headerProvider) {
		return headerProvider.ensureAuthorizationHeader();
	}
	return headerProvider.authorizationHeader();
}
