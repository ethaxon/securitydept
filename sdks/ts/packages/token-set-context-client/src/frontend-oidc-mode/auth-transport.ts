// Frontend OIDC Mode — authorized transport wrapper.
//
// Wraps the generic createAuthorizedTransport from the orchestration layer,
// remapping error codes to the frontend-oidc namespace.
//
// Symmetric counterpart of backend-oidc-mode/auth-transport.ts.

import type { HttpTransport } from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	UserRecovery,
} from "@securitydept/client";
import type {
	AsyncBearerHeaderProvider,
	AuthForResourceProvider,
	BearerHeaderProvider,
} from "../orchestration/index";
import { createAuthorizedTransport } from "../orchestration/index";
import { FrontendOidcModeContextSource } from "./types";

/** @see {@link BearerHeaderProvider} */
export type AuthorizationHeaderProviderTrait =
	| BearerHeaderProvider
	| AsyncBearerHeaderProvider
	| AuthForResourceProvider;

export interface CreateFrontendOidcModeAuthorizedTransportOptions {
	transport: HttpTransport;
	requireAuthorization?: boolean;
	clientKey?: string;
	logicalClientId?: string;
}

/**
 * Wrap a transport so every request carries the current frontend-OIDC bearer.
 *
 * Delegates the generic bearer-injection logic to the orchestration layer,
 * then re-maps the unavailability error to the frontend-oidc namespace.
 *
 * Typical usage:
 * ```ts
 * const authorizedTransport = createFrontendOidcModeAuthorizedTransport(
 *     client,   // FrontendOidcModeClient implements ensureAuthorizationHeader()
 *     { transport: fetchTransport },
 * );
 * ```
 */
export function createFrontendOidcModeAuthorizedTransport(
	authorizationProvider: AuthorizationHeaderProviderTrait,
	options: CreateFrontendOidcModeAuthorizedTransportOptions,
): HttpTransport {
	const base = createAuthorizedTransport(authorizationProvider, options);

	return {
		async execute(request) {
			try {
				return await base.execute(request);
			} catch (cause) {
				throw remapAuthError(cause);
			}
		},
	};
}

function remapAuthError(cause: unknown): unknown {
	if (!(cause instanceof ClientError)) {
		return cause;
	}

	if (cause.code === "token_orchestration.authorization.unavailable") {
		return new ClientError({
			kind: cause.kind ?? ClientErrorKind.Unauthenticated,
			code: "frontend_oidc.authorization.unavailable",
			message: "Frontend OIDC authorization header is unavailable",
			recovery: UserRecovery.Reauthenticate,
			source: FrontendOidcModeContextSource.Client,
			cause,
		});
	}

	return cause;
}
