import { ClientError } from "./client-error";
import type { ClientErrorKind, UserRecovery } from "./types";

export type ClientErrorRecovery = UserRecovery;

export type ClientErrorAttributes = {
	errorKind: ClientErrorKind;
	errorCode: string;
	recovery: ClientErrorRecovery;
};

export type NativeErrorAttributes = {
	errorName: string;
	errorMessage: string;
};

export type UnknownErrorAttributes = {
	errorValue: string;
};

export type ErrorAttributes =
	| ClientErrorAttributes
	| NativeErrorAttributes
	| UnknownErrorAttributes;

/** Extract stable structured attributes from an unknown error value. */
export function describeError(error: unknown): ErrorAttributes {
	if (isClientError(error)) {
		return {
			errorKind: error.kind,
			errorCode: error.code,
			recovery: error.recovery,
		};
	}

	if (isNativeError(error)) {
		return {
			errorName: error.name,
			errorMessage: error.message,
		};
	}

	return { errorValue: String(error) };
}

function isClientError(error: unknown): error is ClientError {
	return error instanceof ClientError;
}

function isNativeError(error: unknown): error is Error {
	return error instanceof Error;
}
