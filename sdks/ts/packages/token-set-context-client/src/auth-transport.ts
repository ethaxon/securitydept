// Token-set-specific authorized transport.
//
// This module is a token-set-specific wrapper around the generic
// createAuthorizedTransport helper from the orchestration layer.
//
// Why a wrapper instead of a direct re-export?
// - The token-set sealed flow uses the same bearer-injection logic as any other
//   protocol, so the generic helper handles the actual transport wrapping.
// - The token-set-specific error code (token_set.authorization.unavailable)
//   and source (TokenSetContextSource.Client) need to remain backward compatible,
//   so this shim re-maps the orchestration-layer error to the token-set namespace.
//
// AuthorizationHeaderProviderTrait is intentionally kept as a distinct named type
// from BearerHeaderProvider so adopters relying on the v1 name are not broken.

import type { HttpTransport } from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	UserRecovery,
} from "@securitydept/client";
import type { BearerHeaderProvider } from "./orchestration/index";
import { createAuthorizedTransport } from "./orchestration/index";
import { TokenSetContextSource } from "./types";

/** @see {@link BearerHeaderProvider} — v1 alias */
export type AuthorizationHeaderProviderTrait = BearerHeaderProvider;

export interface CreateTokenSetAuthorizedTransportOptions {
	transport: HttpTransport;
	requireAuthorization?: boolean;
}

/**
 * Wrap a transport so every request carries the current token-set bearer.
 *
 * Delegates the generic bearer-injection logic to the orchestration layer,
 * then re-maps the unavailability error to the token-set namespace for
 * backward-compatible error codes.
 *
 * The wrapper is explicit and request-scoped: it never patches global fetch.
 * By default it also refuses to silently fall back to cookie/session auth.
 */
export function createTokenSetAuthorizedTransport(
	authorizationProvider: AuthorizationHeaderProviderTrait,
	options: CreateTokenSetAuthorizedTransportOptions,
): HttpTransport {
	// Delegate the generic bearer-injection logic to the orchestration layer.
	const base = createAuthorizedTransport(authorizationProvider, options);

	return {
		async execute(request) {
			try {
				return await base.execute(request);
			} catch (cause) {
				// Re-map orchestration error codes to token-set namespace for
				// backward compatibility with existing trace consumers.
				throw remapAuthError(cause);
			}
		},
	};
}

/**
 * Map orchestration-layer authorization errors to token-set-specific codes.
 *
 * The orchestration layer uses `token_orchestration.authorization.*` codes;
 * the token-set v1 surface advertises `token_set.authorization.*` codes.
 */
function remapAuthError(cause: unknown): unknown {
	if (!(cause instanceof ClientError)) {
		return cause;
	}

	if (cause.code === "token_orchestration.authorization.unavailable") {
		return new ClientError({
			kind: cause.kind ?? ClientErrorKind.Unauthenticated,
			code: "token_set.authorization.unavailable",
			message: "Token-set authorization header is unavailable",
			recovery: UserRecovery.Reauthenticate,
			source: TokenSetContextSource.Client,
			cause,
		});
	}

	return cause;
}
