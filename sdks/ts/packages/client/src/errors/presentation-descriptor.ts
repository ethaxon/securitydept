import { ClientError } from "./client-error";
import {
	ClientErrorKind,
	type ErrorPresentation,
	type ErrorPresentationActionDescriptor,
	type ErrorPresentationDescriptor,
	ErrorPresentationTone,
	type ReadErrorPresentationDescriptorOptions,
	UserRecovery,
} from "./types";

interface ClientErrorLike {
	code: string | null;
	kind: ClientErrorKind | null;
	message: string;
	recovery: UserRecovery;
	retryable: boolean;
	source?: string;
	presentation?: ErrorPresentation;
}

const DEFAULT_RECOVERY_LABELS: Record<UserRecovery, string> = {
	[UserRecovery.None]: "",
	[UserRecovery.Retry]: "Try again",
	[UserRecovery.RestartFlow]: "Restart flow",
	[UserRecovery.Reauthenticate]: "Sign in again",
	[UserRecovery.ContactSupport]: "Contact support",
};

const POPUP_PRESENTATIONS = {
	"popup.blocked": {
		title: "Popup was blocked",
		description:
			"The browser blocked the popup window before the login flow could start. Allow popups for this site, then try again.",
		tone: ErrorPresentationTone.Warning,
	},
	"popup.closed_by_user": {
		title: "Popup login was closed",
		description:
			"The popup window was closed before the OIDC provider returned a callback. Start the login flow again to continue.",
		tone: ErrorPresentationTone.Warning,
	},
	"popup.relay_timeout": {
		title: "Popup relay timed out",
		description:
			"The popup callback never relayed back to the opener before the timeout window expired.",
		tone: ErrorPresentationTone.Warning,
	},
	"popup.relay_error": {
		title: "Popup relay failed",
		description:
			"The popup callback page returned an error instead of a callback payload.",
		tone: ErrorPresentationTone.Danger,
	},
} as const;

export function readErrorPresentationDescriptor(
	error: unknown,
	options: ReadErrorPresentationDescriptorOptions = {},
): ErrorPresentationDescriptor {
	if (error instanceof ClientError) {
		return describeClientErrorPresentation(error, options);
	}

	const clientErrorLike = coerceClientErrorLike(error);
	if (clientErrorLike) {
		return describeClientErrorLikePresentation(clientErrorLike, options);
	}

	if (error instanceof Error) {
		return {
			code: null,
			kind: null,
			title: options.fallbackTitle ?? "Operation failed",
			description:
				error.message ||
				options.fallbackDescription ||
				"An unexpected error prevented the operation from completing.",
			recovery: UserRecovery.None,
			retryable: false,
			tone: ErrorPresentationTone.Danger,
			primaryAction: null,
		};
	}

	return {
		code: null,
		kind: null,
		title: options.fallbackTitle ?? "Operation failed",
		description:
			options.fallbackDescription ??
			"An unexpected error prevented the operation from completing.",
		recovery: UserRecovery.None,
		retryable: false,
		tone: ErrorPresentationTone.Danger,
		primaryAction: null,
	};
}

function describeClientErrorPresentation(
	error: ClientError,
	options: ReadErrorPresentationDescriptorOptions,
): ErrorPresentationDescriptor {
	return describeClientErrorLikePresentation(
		{
			code: error.code,
			kind: error.kind,
			message: error.message,
			recovery: error.recovery,
			retryable: error.retryable,
			source: error.source,
			presentation: error.presentation,
		},
		options,
	);
}

function describeClientErrorLikePresentation(
	error: ClientErrorLike,
	options: ReadErrorPresentationDescriptorOptions,
): ErrorPresentationDescriptor {
	const popupPresentation =
		POPUP_PRESENTATIONS[error.code as keyof typeof POPUP_PRESENTATIONS];
	const title = popupPresentation?.title ?? readClientErrorTitle(error);
	const description =
		popupPresentation?.description ??
		error.presentation?.message ??
		error.message ??
		options.fallbackDescription ??
		"The operation could not complete.";

	return {
		code: error.code,
		kind: error.kind,
		source: error.source,
		title,
		description,
		recovery: error.recovery,
		retryable: error.retryable,
		tone: popupPresentation?.tone ?? readClientErrorTone(error),
		primaryAction: readPrimaryAction(error.recovery, options),
	};
}

function readClientErrorTitle(
	error: Pick<ClientErrorLike, "kind" | "recovery">,
): string {
	if (error.kind === ClientErrorKind.Unauthenticated) {
		return "Authentication required";
	}

	if (error.kind === ClientErrorKind.Unauthorized) {
		return "Access denied";
	}

	if (error.kind === ClientErrorKind.Cancelled) {
		return "Operation cancelled";
	}

	if (error.kind === ClientErrorKind.Timeout) {
		return "Request timed out";
	}

	if (error.kind === ClientErrorKind.Configuration) {
		return "Configuration error";
	}

	if (error.kind === ClientErrorKind.Validation) {
		return "Validation failed";
	}

	if (error.kind === ClientErrorKind.Storage) {
		return "Browser storage failed";
	}

	if (
		error.kind === ClientErrorKind.Authorization &&
		error.recovery === UserRecovery.RestartFlow
	) {
		return "Flow needs to restart";
	}

	if (error.kind === ClientErrorKind.Transport) {
		return "Network request failed";
	}

	if (error.kind === ClientErrorKind.Server) {
		return "Server request failed";
	}

	if (error.kind === ClientErrorKind.Protocol) {
		return "Request failed";
	}

	return "Operation failed";
}

function readClientErrorTone(
	error: Pick<ClientErrorLike, "kind" | "recovery">,
) {
	if (error.kind === ClientErrorKind.Cancelled) {
		return ErrorPresentationTone.Neutral;
	}

	if (
		error.kind === ClientErrorKind.Unauthenticated ||
		error.kind === ClientErrorKind.Timeout ||
		error.kind === ClientErrorKind.Transport ||
		error.kind === ClientErrorKind.Server ||
		error.recovery === UserRecovery.Retry ||
		error.recovery === UserRecovery.RestartFlow ||
		error.recovery === UserRecovery.Reauthenticate
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
	if (typeof candidate.message !== "string") {
		return null;
	}

	return {
		code: typeof candidate.code === "string" ? candidate.code : null,
		kind:
			typeof candidate.kind === "string"
				? (candidate.kind as ClientErrorKind)
				: null,
		message: candidate.message,
		recovery:
			typeof candidate.recovery === "string"
				? (candidate.recovery as UserRecovery)
				: UserRecovery.None,
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
		typeof (value as Record<string, unknown>).recovery === "string"
	);
}

function readPrimaryAction(
	recovery: UserRecovery,
	options: ReadErrorPresentationDescriptorOptions,
): ErrorPresentationActionDescriptor | null {
	if (recovery === UserRecovery.None) {
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
