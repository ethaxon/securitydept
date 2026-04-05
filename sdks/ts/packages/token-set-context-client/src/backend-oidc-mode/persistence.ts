// Backend OIDC Mode — state persistence wrapper.
//
// Wraps the generic createAuthStatePersistence from the orchestration layer,
// remapping error codes to the token-set namespace.

import type { RecordStore } from "@securitydept/client";
import { ClientError, ClientErrorKind } from "@securitydept/client";
import { createAuthStatePersistence } from "../orchestration/index";
import type { AuthStateSnapshot } from "./types";
import { BackendOidcModeContextSource } from "./types";

export interface BackendOidcModeStatePersistence {
	load(): Promise<AuthStateSnapshot | null>;
	save(snapshot: AuthStateSnapshot): Promise<void>;
	clear(): Promise<void>;
}

/**
 * Create a persistence adapter for token-set auth state.
 *
 * Delegates the generic store/parse/validate work to the orchestration layer,
 * then re-maps persistence error codes to the token-set namespace.
 */
export function createBackendOidcModeStatePersistence(options: {
	store: RecordStore;
	key: string;
	now: () => number;
}): BackendOidcModeStatePersistence {
	const base = createAuthStatePersistence(options);

	return {
		async load(): Promise<AuthStateSnapshot | null> {
			try {
				return await base.load();
			} catch (cause) {
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
		source: BackendOidcModeContextSource.Persistence,
		cause,
	});
}
