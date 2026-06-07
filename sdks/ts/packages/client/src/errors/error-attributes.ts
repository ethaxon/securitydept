import { ClientError } from "./client-error";
import { type ClientErrorKind, type UserRecovery } from "./types";

export interface ErrorSummary {
	errorName: string;
	errorKind?: ClientErrorKind;
	errorCode?: string;
	recovery?: UserRecovery;
}

/** Extract secret-safe diagnostic attributes without copying runtime messages. */
export function describeError(error: unknown): ErrorSummary {
	if (error instanceof ClientError) {
		return {
			errorName: error.name,
			errorKind: error.kind,
			errorCode: error.code,
			recovery: error.recovery,
		};
	}

	return {
		errorName: error instanceof Error ? error.name : typeof error,
	};
}
