// Backend OIDC Mode — authorized transport wrapper.
//
// Wraps the generic createAuthorizedTransport from the orchestration layer,
// remapping error codes to the backend-oidc namespace.

import type { HttpTransport } from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	UserRecovery,
} from "@securitydept/client";

export type { AuthorizationHeaderProviderTrait } from "../../orchestration/index";

import type { AuthorizationHeaderProviderTrait } from "../../orchestration/index";
import { createRemappingAuthorizedTransport } from "../../orchestration/index";
import { BackendOidcModeContextSource } from "../runtime/types";

export interface CreateBackendOidcModeAuthorizedTransportOptions {
	transport: HttpTransport;
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
			code: "backend_oidc.authorization.unavailable",
			message: "Backend OIDC authorization header is unavailable",
			recovery: UserRecovery.Reauthenticate,
			source: BackendOidcModeContextSource.Client,
			cause,
		});
	}

	return cause;
}
