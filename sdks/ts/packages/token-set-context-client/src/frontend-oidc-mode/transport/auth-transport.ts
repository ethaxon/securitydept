// Frontend OIDC Mode — authorized transport wrapper.
//
// Wraps the generic createAuthorizedTransportFromBase from @securitydept/client,
// remapping error codes to the frontend-oidc namespace.
//
// Symmetric counterpart of backend-oidc-mode/auth-transport.ts.

import {
	type AuthorizationHeaderProviderTrait,
	type BaseTransportTrait,
	ClientError,
	ClientErrorKind,
	createRemappingAuthorizedTransportFromBase,
	type ManagedTransportTrait,
	UserRecovery,
} from "@securitydept/client";
import { FrontendOidcModeContextSource } from "../client/types";

export type { AuthorizationHeaderProviderTrait };

export interface CreateFrontendOidcModeAuthorizedTransportOptions {
	baseTransport: BaseTransportTrait;
	requireAuthorization?: boolean;
	clientKey?: string;
	id?: string;
}

/**
 * Wrap a transport so every request carries the current frontend-OIDC bearer.
 *
 * Delegates the generic bearer-injection logic to the orchestration layer,
 * then re-maps the unavailability error to the frontend-oidc namespace.
 *
 * Typical usage:
 * ```ts
 * const authorizedTransport = createFrontendOidcModeAuthorizedTransportFromBase(
 *     client,   // FrontendOidcModeClient exposes authorizationHeaderValue
 *     { baseTransport },
 * );
 * ```
 */
export function createFrontendOidcModeAuthorizedTransportFromBase(
	authorizationProvider: AuthorizationHeaderProviderTrait,
	options: CreateFrontendOidcModeAuthorizedTransportOptions,
): ManagedTransportTrait {
	return createRemappingAuthorizedTransportFromBase(authorizationProvider, {
		...options,
		remapError: remapAuthError,
	});
}

function remapAuthError(cause: unknown): unknown {
	if (!(cause instanceof ClientError)) {
		return cause;
	}

	if (cause.code === "client.authorization.unavailable") {
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
