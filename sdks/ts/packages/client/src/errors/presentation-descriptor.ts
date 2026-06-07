import { ClientError } from "./client-error";
import {
	type ClientErrorKind,
	ClientErrorKind as ClientErrorKindValue,
	type ErrorPresentation,
	type ErrorPresentationActionDescriptor,
	type ErrorPresentationDescriptor,
	ErrorPresentationTone,
	type ReadErrorPresentationDescriptorOptions,
	type UserRecovery,
	UserRecovery as UserRecoveryValue,
} from "./types";

interface ClientErrorLike {
	code: string | null;
	kind: ClientErrorKind | null;
	recovery: UserRecovery;
	retryable: boolean;
	source?: string;
	presentation?: ErrorPresentation;
}

const DEFAULT_RECOVERY_LABELS: Record<UserRecovery, string> = {
	[UserRecoveryValue.None]: "",
	[UserRecoveryValue.Retry]: "Try again",
	[UserRecoveryValue.RestartFlow]: "Restart flow",
	[UserRecoveryValue.Reauthenticate]: "Sign in again",
	[UserRecoveryValue.ContactSupport]: "Contact support",
};

const userRecoveryValues = new Set<string>(Object.values(UserRecoveryValue));
const clientErrorKindValues = new Set<string>(
	Object.values(ClientErrorKindValue),
);

export function readErrorPresentationDescriptor(
	error: unknown,
	options: ReadErrorPresentationDescriptorOptions = {},
): ErrorPresentationDescriptor {
	const clientError =
		error instanceof ClientError ? error : coerceClientErrorLike(error);
	if (!clientError) {
		return {
			code: null,
			kind: null,
			title: options.fallbackTitle ?? "Operation failed",
			description:
				options.fallbackDescription ??
				"An unexpected error prevented the operation from completing.",
			recovery: UserRecoveryValue.None,
			retryable: false,
			tone: ErrorPresentationTone.Danger,
			primaryAction: null,
		};
	}

	const code = clientError.presentation?.code ?? clientError.code;
	const codePresentation = code ? options.codePresentations?.[code] : undefined;
	const recovery =
		clientError.presentation?.recovery ??
		codePresentation?.recovery ??
		clientError.recovery;
	const generic = readGenericPresentation(clientError.kind);

	return {
		code,
		kind: clientError.kind,
		source: clientError.source,
		title: codePresentation?.title ?? generic.title,
		description:
			clientError.presentation?.message ??
			codePresentation?.description ??
			generic.description,
		recovery,
		retryable: clientError.retryable,
		tone:
			codePresentation?.tone ?? readClientErrorTone(clientError.kind, recovery),
		primaryAction: readPrimaryAction(recovery, options),
	};
}

function readGenericPresentation(kind: ClientErrorKind | null): {
	title: string;
	description: string;
} {
	switch (kind) {
		case ClientErrorKindValue.Unauthenticated:
			return {
				title: "Authentication required",
				description: "Sign in again to continue.",
			};
		case ClientErrorKindValue.Unauthorized:
			return {
				title: "Access denied",
				description: "You do not have permission to complete this operation.",
			};
		case ClientErrorKindValue.Cancelled:
			return {
				title: "Operation cancelled",
				description: "The operation was cancelled before it completed.",
			};
		case ClientErrorKindValue.Timeout:
			return {
				title: "Request timed out",
				description: "The operation did not complete in time.",
			};
		case ClientErrorKindValue.Configuration:
			return {
				title: "Configuration error",
				description: "The client is not configured to complete this operation.",
			};
		case ClientErrorKindValue.Storage:
			return {
				title: "Storage failed",
				description: "The client could not access required stored data.",
			};
		case ClientErrorKindValue.Transport:
			return {
				title: "Network request failed",
				description: "The client could not reach the service.",
			};
		case ClientErrorKindValue.Server:
			return {
				title: "Server request failed",
				description: "The service could not complete the request.",
			};
		case ClientErrorKindValue.Protocol:
			return {
				title: "Invalid response",
				description:
					"The service response did not satisfy the expected protocol.",
			};
		case ClientErrorKindValue.Authorization:
			return {
				title: "Authorization failed",
				description: "The authorization flow could not be completed.",
			};
		default:
			return {
				title: "Operation failed",
				description: "The operation could not be completed.",
			};
	}
}

function readClientErrorTone(
	kind: ClientErrorKind | null,
	recovery: UserRecovery,
) {
	if (kind === ClientErrorKindValue.Cancelled) {
		return ErrorPresentationTone.Neutral;
	}
	if (
		kind === ClientErrorKindValue.Unauthenticated ||
		kind === ClientErrorKindValue.Timeout ||
		kind === ClientErrorKindValue.Transport ||
		kind === ClientErrorKindValue.Server ||
		recovery === UserRecoveryValue.Retry ||
		recovery === UserRecoveryValue.RestartFlow ||
		recovery === UserRecoveryValue.Reauthenticate
	) {
		return ErrorPresentationTone.Warning;
	}
	return ErrorPresentationTone.Danger;
}

function coerceClientErrorLike(error: unknown): ClientErrorLike | null {
	if (typeof error !== "object" || error === null) {
		return null;
	}
	const candidate = error as Record<string, unknown>;
	if (
		typeof candidate.kind !== "string" ||
		!clientErrorKindValues.has(candidate.kind)
	) {
		return null;
	}
	return {
		code: typeof candidate.code === "string" ? candidate.code : null,
		kind: candidate.kind as ClientErrorKind,
		recovery:
			typeof candidate.recovery === "string" &&
			userRecoveryValues.has(candidate.recovery)
				? (candidate.recovery as UserRecovery)
				: UserRecoveryValue.None,
		retryable: candidate.retryable === true,
		source: typeof candidate.source === "string" ? candidate.source : undefined,
		presentation: isErrorPresentation(candidate.presentation)
			? candidate.presentation
			: undefined,
	};
}

function isErrorPresentation(value: unknown): value is ErrorPresentation {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Record<string, unknown>).code === "string" &&
		typeof (value as Record<string, unknown>).message === "string" &&
		typeof (value as Record<string, unknown>).recovery === "string" &&
		userRecoveryValues.has(
			(value as Record<string, unknown>).recovery as string,
		)
	);
}

function readPrimaryAction(
	recovery: UserRecovery,
	options: ReadErrorPresentationDescriptorOptions,
): ErrorPresentationActionDescriptor | null {
	if (recovery === UserRecoveryValue.None) {
		return null;
	}
	const label =
		options.recoveryLabels?.[recovery] ?? DEFAULT_RECOVERY_LABELS[recovery];
	if (!label) {
		return null;
	}
	return {
		recovery,
		label,
		href: options.recoveryLinks?.[recovery] ?? null,
	};
}
