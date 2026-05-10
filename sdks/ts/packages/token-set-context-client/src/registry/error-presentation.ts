import {
	ClientError,
	type ClientErrorKind,
	type ErrorPresentationDescriptor,
	ErrorPresentationTone,
	type ReadErrorPresentationDescriptorOptions,
	readErrorPresentationDescriptor,
	type UserRecovery,
	UserRecovery as UserRecoveryValue,
} from "@securitydept/client";

export interface TokenSetCallbackErrorDetails {
	code: string | null;
	kind: ClientErrorKind | null;
	message: string;
	recovery: UserRecovery;
	retryable: boolean;
	source?: string;
}

export interface TokenSetCallbackErrorPresentationContext {
	errorDetails: TokenSetCallbackErrorDetails;
	clientKey: string | null;
	currentUrl: string | undefined;
}

export type TokenSetCallbackErrorPresenter = (
	context: TokenSetCallbackErrorPresentationContext,
) => ErrorPresentationDescriptor;

export interface TokenSetCallbackResumeErrorDetails
	extends TokenSetCallbackErrorDetails {
	presentation: ErrorPresentationDescriptor;
	cause: unknown;
}

export interface ReadTokenSetCallbackResumeErrorDetailsOptions {
	clientKey?: string | null;
	currentUrl?: string;
	describeError?: TokenSetCallbackErrorPresenter;
}

export function describeTokenSetCallbackError(
	error: TokenSetCallbackErrorDetails | unknown,
	options: ReadErrorPresentationDescriptorOptions = {},
): ErrorPresentationDescriptor {
	const descriptor = readErrorPresentationDescriptor(error, options);

	return {
		...descriptor,
		title: "Authentication callback failed",
		description:
			descriptor.description ||
			"The authentication callback could not be completed by the registered token-set client. Restart the sign-in flow from this application.",
		recovery: descriptor.recovery ?? UserRecoveryValue.RestartFlow,
		tone:
			descriptor.retryable ||
			descriptor.recovery === UserRecoveryValue.RestartFlow
				? ErrorPresentationTone.Warning
				: ErrorPresentationTone.Danger,
	};
}

export function readTokenSetCallbackResumeErrorDetails(
	error: unknown,
	options: ReadTokenSetCallbackResumeErrorDetailsOptions = {},
): TokenSetCallbackResumeErrorDetails {
	if (error instanceof ClientError) {
		const normalized = {
			code: error.code,
			kind: error.kind,
			message: error.message,
			recovery: error.recovery,
			retryable: error.retryable,
			source: error.source,
		};
		return {
			...normalized,
			presentation: describeCallbackError(normalized, options),
			cause: error,
		};
	}

	if (error instanceof Error) {
		const normalized = {
			code: null,
			kind: null,
			message: error.message,
			recovery: UserRecoveryValue.None,
			retryable: false,
		};
		return {
			...normalized,
			presentation: describeCallbackError(normalized, options),
			cause: error,
		};
	}

	const normalized = {
		code: null,
		kind: null,
		message: "Unknown callback error",
		recovery: UserRecoveryValue.None,
		retryable: false,
	};
	return {
		...normalized,
		presentation: describeCallbackError(normalized, options),
		cause: error,
	};
}

function describeCallbackError(
	errorDetails: TokenSetCallbackErrorDetails,
	options: ReadTokenSetCallbackResumeErrorDetailsOptions,
): ErrorPresentationDescriptor {
	if (options.describeError) {
		return options.describeError({
			errorDetails,
			clientKey: options.clientKey ?? null,
			currentUrl: options.currentUrl,
		});
	}

	return describeTokenSetCallbackError(errorDetails);
}
