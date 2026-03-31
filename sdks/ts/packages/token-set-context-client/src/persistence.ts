// Token-set state persistence.
//
// This module is a token-set-specific wrapper around the generic
// createAuthStatePersistence helper from the orchestration layer.
//
// Why a wrapper instead of direct use?
// - The token-set sealed flow uses the same AuthSnapshot shape, so the generic
//   persistence can handle the actual store/parse/validate work.
// - The token-set specific error codes (token_set.*) and the
//   TokenSetContextSource.Persistence trace source need to remain
//   token-set specific, so we keep this thin shim that re-maps error codes.
//
// If the error code distinction becomes unimportant in the future,
// this file can be replaced entirely by direct use of createAuthStatePersistence.

import type { RecordStore } from "@securitydept/client";
import { ClientError, ClientErrorKind } from "@securitydept/client";
import { createAuthStatePersistence } from "./orchestration/index";
import type { AuthStateSnapshot } from "./types";
import { TokenSetContextSource } from "./types";

export interface TokenSetStatePersistence {
	load(): Promise<AuthStateSnapshot | null>;
	save(snapshot: AuthStateSnapshot): Promise<void>;
	clear(): Promise<void>;
}

/**
 * Create a persistence adapter for token-set auth state.
 *
 * Delegates the generic store/parse/validate work to the orchestration layer,
 * then re-maps persistence error codes to the token-set namespace for
 * backward-compatible trace output.
 */
export function createTokenSetStatePersistence(options: {
	store: RecordStore;
	key: string;
	now: () => number;
}): TokenSetStatePersistence {
	// Delegate to the protocol-agnostic persistence from the orchestration layer.
	const base = createAuthStatePersistence(options);

	return {
		async load(): Promise<AuthStateSnapshot | null> {
			try {
				return await base.load();
			} catch (cause) {
				// Re-map orchestration error codes to token-set namespace for
				// backward compatibility with existing trace consumers.
				throw remapPersistenceError(cause);
			}
		},

		async save(snapshot: AuthStateSnapshot): Promise<void> {
			return base.save(snapshot);
		},

		async clear(): Promise<void> {
			return base.clear();
		},
	};
}

/**
 * Map orchestration-layer persistence errors to token-set-specific error codes.
 *
 * The orchestration layer uses `token_orchestration.persistence.*` codes;
 * the token-set v1 surface has historically advertised `token_set.persistence.*`
 * codes. Remapping keeps backward compatibility while the orchestration layer
 * owns the actual implementation.
 */
function remapPersistenceError(cause: unknown): unknown {
	if (!(cause instanceof ClientError)) {
		return cause;
	}

	const codeMap: Record<string, string> = {
		"token_orchestration.persistence.invalid_json":
			"token_set.persistence.invalid_json",
		"token_orchestration.persistence.invalid_envelope":
			"token_set.persistence.invalid_envelope",
		"token_orchestration.persistence.unsupported_version":
			"token_set.persistence.unsupported_version",
		"token_orchestration.persistence.invalid_snapshot":
			"token_set.persistence.invalid_snapshot",
	};

	const mappedCode = codeMap[cause.code] ?? cause.code;

	return new ClientError({
		kind: cause.kind ?? ClientErrorKind.Protocol,
		code: mappedCode,
		message: cause.message,
		source: TokenSetContextSource.Persistence,
		cause,
	});
}
