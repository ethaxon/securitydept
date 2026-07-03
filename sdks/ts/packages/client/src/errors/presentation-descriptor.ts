import { SpanSharedAttributeName } from "../span/attributes";
import { ClientError } from "./client-error";
import {
	type ClientErrorContextFormatter,
	type ClientErrorKind,
	ClientErrorKind as ClientErrorKindValue,
	type ErrorPresentationDescriptor,
	ErrorPresentationTone,
	type ErrorRecoveryActionDescriptor,
	type ReadErrorPresentationDescriptorOptions,
	type UserRecovery,
	UserRecovery as UserRecoveryValue,
} from "./types";

const DEFAULT_RECOVERY_LABELS: Record<UserRecovery, string> = {
	[UserRecoveryValue.None]: "",
	[UserRecoveryValue.Retry]: "Try again",
	[UserRecoveryValue.RestartFlow]: "Restart flow",
	[UserRecoveryValue.Reauthenticate]: "Sign in again",
	[UserRecoveryValue.ContactSupport]: "Contact support",
};

export const formatClientErrorContext: ClientErrorContextFormatter = (
	context,
) => {
	let clientName: string | undefined;
	let clientId: string | undefined;
	let operationName: string | undefined;
	for (const frame of context) {
		const frameClientName =
			frame.attributes[SpanSharedAttributeName.ClientName];
		const frameClientId = frame.attributes[SpanSharedAttributeName.ClientId];
		const frameOperationName =
			frame.attributes[SpanSharedAttributeName.OperationName];
		if (typeof frameClientName === "string") {
			clientName = frameClientName;
		}
		if (typeof frameClientId === "string") {
			clientId = frameClientId;
		}
		if (typeof frameOperationName === "string") {
			operationName = frameOperationName;
		}
	}
	const contextLabel = [clientName ?? clientId, operationName]
		.filter((value): value is string => Boolean(value))
		.join(" · ");
	return contextLabel || undefined;
};

export function readErrorPresentationDescriptor(
	error: unknown,
	options: ReadErrorPresentationDescriptorOptions = {},
): ErrorPresentationDescriptor {
	if (!(error instanceof ClientError)) {
		return {
			code: null,
			title: options.fallbackTitle ?? "Operation failed",
			description:
				options.fallbackDescription ??
				"An unexpected error prevented the operation from completing.",
			recovery: UserRecoveryValue.None,
			tone: ErrorPresentationTone.Danger,
			primaryAction: null,
		};
	}
	const clientError = error;

	const code = clientError.presentation?.code ?? clientError.code;
	const codePresentation = code ? options.codePresentations?.[code] : undefined;
	const recovery =
		clientError.presentation?.recovery ??
		codePresentation?.recovery ??
		clientError.recovery;
	const generic = readGenericPresentation(clientError.kind);

	const descriptor: ErrorPresentationDescriptor = {
		code,
		title: codePresentation?.title ?? generic.title,
		description:
			clientError.presentation?.message ??
			codePresentation?.description ??
			generic.description,
		recovery,
		tone:
			codePresentation?.tone ?? readClientErrorTone(clientError.kind, recovery),
		primaryAction: readPrimaryAction(recovery, options),
	};
	if (!clientError.spanContext || options.contextFormatter === null) {
		return descriptor;
	}
	const contextLabel = (options.contextFormatter ?? formatClientErrorContext)(
		clientError.spanContext,
	);
	return contextLabel
		? { ...descriptor, title: `${contextLabel}: ${descriptor.title}` }
		: descriptor;
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

function readPrimaryAction(
	recovery: UserRecovery,
	options: ReadErrorPresentationDescriptorOptions,
): ErrorRecoveryActionDescriptor | null {
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
