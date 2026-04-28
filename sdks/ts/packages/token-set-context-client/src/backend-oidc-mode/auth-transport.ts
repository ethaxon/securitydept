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
import type {
	AsyncBearerHeaderProvider,
	AuthForResourceProvider,
	BearerHeaderProvider,
} from "../orchestration/index";
import { createAuthorizedTransport } from "../orchestration/index";
import { BackendOidcModeContextSource } from "./types";

/** @see {@link BearerHeaderProvider} */
export type AuthorizationHeaderProviderTrait =
	| BearerHeaderProvider
	| AsyncBearerHeaderProvider
	| AuthForResourceProvider;

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
			code: "backend_oidc.authorization.unavailable",
			message: "Backend OIDC authorization header is unavailable",
			recovery: UserRecovery.Reauthenticate,
			source: BackendOidcModeContextSource.Client,
			cause,
		});
	}

	return cause;
}
