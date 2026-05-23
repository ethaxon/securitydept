// Backend OIDC Mode — authorized transport wrapper.
//
// Wraps the generic createAuthorizedTransport from @securitydept/client,
// remapping error codes to the backend-oidc namespace.

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
import { BackendOidcModeContextSource } from "../runtime/types";

export type { AuthorizationHeaderProviderTrait };

export interface CreateBackendOidcModeAuthorizedTransportOptions {
	baseTransport: BaseTransportTrait;
	requireAuthorization?: boolean;
	clientKey?: string;
	logicalClientId?: string;
}

/**
 * Wrap a transport so every request carries the current token-set bearer.
 *
 * Delegates the generic bearer-injection logic to the orchestration layer,
 * then re-maps the unavailability error to the token-set namespace.
 */
export function createBackendOidcModeAuthorizedTransport(
	authorizationProvider: AuthorizationHeaderProviderTrait,
	options: CreateBackendOidcModeAuthorizedTransportOptions,
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
			code: "backend_oidc.authorization.unavailable",
			message: "Backend OIDC authorization header is unavailable",
			recovery: UserRecovery.Reauthenticate,
			source: BackendOidcModeContextSource.Client,
			cause,
		});
	}

	return cause;
}
