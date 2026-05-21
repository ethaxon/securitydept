import {
	type ClientErrorKind,
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
	message: string;
	recovery: UserRecovery;
	retryable: boolean;
	source?: string;
}

export function describeFrontendOidcModeCallbackError(
	error: FrontendOidcModeCallbackErrorDescriptorInput | unknown,
	options: ReadErrorPresentationDescriptorOptions = {},
): ErrorPresentationDescriptor {
	const descriptor = readErrorPresentationDescriptor(error, options);

	switch (descriptor.code) {
		case FrontendOidcModeCallbackErrorCode.MissingState:
		case FrontendOidcModeCallbackErrorCode.UnknownState:
			return {
				...descriptor,
				title: "Unknown callback state",
				description:
					"This callback does not match any pending frontend-mode login in the current browser session. Start the frontend-mode login again from the reference playground.",
				recovery: UserRecoveryValue.RestartFlow,
				tone: ErrorPresentationTone.Warning,
			};
		case FrontendOidcModeCallbackErrorCode.PendingStale:
			return {
				...descriptor,
				title: "Callback state expired",
				description:
					"The browser had a pending frontend-mode login for this callback, but the saved state expired before the callback was resumed. Start the login flow again.",
				recovery: UserRecoveryValue.RestartFlow,
				tone: ErrorPresentationTone.Warning,
			};
		case FrontendOidcModeCallbackErrorCode.PendingClientMismatch:
			return {
				...descriptor,
				title: "Callback belongs to another frontend-mode client",
				description:
					"This callback was created for a different frontend-mode client or redirect binding than the one registered by the reference app. Restart the frontend-mode login from this app.",
				recovery: UserRecoveryValue.RestartFlow,
				tone: ErrorPresentationTone.Danger,
			};
		case FrontendOidcModeCallbackErrorCode.DuplicateState:
			return {
				...descriptor,
				title: "Callback already consumed",
				description:
					"This callback URL has already been completed once and cannot be replayed. Start a new frontend-mode login if you need another session.",
				recovery: UserRecoveryValue.RestartFlow,
				tone: ErrorPresentationTone.Warning,
			};
		default:
			return {
				...descriptor,
				title: "Frontend-mode callback failed",
				tone: ErrorPresentationTone.Danger,
			};
	}
}
