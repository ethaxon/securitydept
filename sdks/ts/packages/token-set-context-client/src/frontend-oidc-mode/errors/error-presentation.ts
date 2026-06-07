import {
	type ClientErrorKind,
	type ErrorCodePresentationDescriptor,
	type ErrorPresentationDescriptor,
	ErrorPresentationTone,
	type ReadErrorPresentationDescriptorOptions,
	readErrorPresentationDescriptor,
	type UserRecovery,
	UserRecovery as UserRecoveryValue,
} from "@securitydept/client";
import { FrontendOidcModeCallbackErrorCode } from "./callback-error-codes";

export interface FrontendOidcModeCallbackErrorDescriptorInput {
	code: string | null;
	kind: ClientErrorKind | null;
	recovery: UserRecovery;
	retryable: boolean;
	source?: string;
}

const callbackPresentations: Readonly<
	Record<FrontendOidcModeCallbackErrorCode, ErrorCodePresentationDescriptor>
> = {
	[FrontendOidcModeCallbackErrorCode.MissingState]: {
		title: "Unknown callback state",
		description:
			"This callback does not match a pending frontend-mode login. Start the login flow again.",
		recovery: UserRecoveryValue.RestartFlow,
		tone: ErrorPresentationTone.Warning,
	},
	[FrontendOidcModeCallbackErrorCode.UnknownState]: {
		title: "Unknown callback state",
		description:
			"This callback does not match a pending frontend-mode login. Start the login flow again.",
		recovery: UserRecoveryValue.RestartFlow,
		tone: ErrorPresentationTone.Warning,
	},
	[FrontendOidcModeCallbackErrorCode.PendingStale]: {
		title: "Callback state expired",
		description:
			"The pending frontend-mode login expired before the callback was resumed. Start the login flow again.",
		recovery: UserRecoveryValue.RestartFlow,
		tone: ErrorPresentationTone.Warning,
	},
	[FrontendOidcModeCallbackErrorCode.PendingClientMismatch]: {
		title: "Callback belongs to another frontend-mode client",
		description:
			"This callback was created for a different frontend-mode client. Restart the login flow from this application.",
		recovery: UserRecoveryValue.RestartFlow,
		tone: ErrorPresentationTone.Danger,
	},
	[FrontendOidcModeCallbackErrorCode.DuplicateState]: {
		title: "Callback already consumed",
		description:
			"This callback has already been completed and cannot be replayed. Start a new login flow.",
		recovery: UserRecoveryValue.RestartFlow,
		tone: ErrorPresentationTone.Warning,
	},
};

export function describeFrontendOidcModeCallbackError(
	error: FrontendOidcModeCallbackErrorDescriptorInput | unknown,
	options: ReadErrorPresentationDescriptorOptions = {},
): ErrorPresentationDescriptor {
	const descriptor = readErrorPresentationDescriptor(error, {
		fallbackTitle: "Frontend-mode callback failed",
		fallbackDescription:
			"The frontend OIDC callback could not be completed. Restart the sign-in flow.",
		...options,
		codePresentations: {
			...callbackPresentations,
			...options.codePresentations,
		},
	});
	return descriptor.code && descriptor.code in callbackPresentations
		? descriptor
		: { ...descriptor, title: "Frontend-mode callback failed" };
}
