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

export type { AuthorizationHeaderProviderTrait } from "../../orchestration/index";

import type { AuthorizationHeaderProviderTrait } from "../../orchestration/index";
import { createRemappingAuthorizedTransport } from "../../orchestration/index";
import { FrontendOidcModeContextSource } from "../runtime/types";

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
	return createRemappingAuthorizedTransport(authorizationProvider, {
		...options,
		remapError: remapAuthError,
	});
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
