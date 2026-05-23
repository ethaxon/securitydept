// Frontend OIDC Mode — authorized transport wrapper.
//
// Wraps the generic createAuthorizedTransport from @securitydept/client,
// remapping error codes to the frontend-oidc namespace.
//
// Symmetric counterpart of backend-oidc-mode/auth-transport.ts.

import type {
	BaseTransportTrait,
	ManagedTransportTrait,
} from "@securitydept/client";
import {
	type AuthorizationHeaderProviderTrait,
	ClientError,
	ClientErrorKind,
	createRemappingAuthorizedTransport,
	UserRecovery,
} from "@securitydept/client";
import { FrontendOidcModeContextSource } from "../runtime/types";

export type { AuthorizationHeaderProviderTrait };

export interface CreateFrontendOidcModeAuthorizedTransportOptions {
	baseTransport: BaseTransportTrait;
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
 *     client,   // FrontendOidcModeClient exposes authorizationHeaderValue
 *     { baseTransport },
 * );
 * ```
 */
export function createFrontendOidcModeAuthorizedTransport(
	authorizationProvider: AuthorizationHeaderProviderTrait,
	options: CreateFrontendOidcModeAuthorizedTransportOptions,
): ManagedTransportTrait {
	return createRemappingAuthorizedTransport(authorizationProvider, {
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
