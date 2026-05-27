// Backend OIDC Mode — authorized transport wrapper.
//
// Wraps the generic createAuthorizedTransportFromBase from @securitydept/client,
// remapping error codes to the backend-oidc namespace.

import {
	type AuthorizationHeaderProviderTrait,
	type BaseTransportTrait,
	ClientError,
	ClientErrorKind,
	createRemappingAuthorizedTransportFromBase,
	type ManagedTransportTrait,
	UserRecovery,
} from "@securitydept/client";
import { BackendOidcModeContextSource } from "./client/types";

export type { AuthorizationHeaderProviderTrait };

export interface CreateBackendOidcModeAuthorizedTransportOptions {
	baseTransport: BaseTransportTrait;
	requireAuthorization?: boolean;
	clientKey?: string;
	id?: string;
}

/**
 * Wrap a transport so every request carries the current token-set bearer.
 *
 * Delegates the generic bearer-injection logic to the orchestration layer,
 * then re-maps the unavailability error to the token-set namespace.
 */
export function createBackendOidcModeAuthorizedTransportFromBase(
	authorizationProvider: AuthorizationHeaderProviderTrait,
	options: CreateBackendOidcModeAuthorizedTransportOptions,
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
			code: "backend_oidc.authorization.unavailable",
			message: "Backend OIDC authorization header is unavailable",
			recovery: UserRecovery.Reauthenticate,
			source: BackendOidcModeContextSource.Client,
			cause,
		});
	}

	return cause;
}
