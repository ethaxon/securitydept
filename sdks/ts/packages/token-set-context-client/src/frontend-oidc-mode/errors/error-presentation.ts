import {
	type ErrorCodePresentation,
	type ErrorPresentationDescriptor,
	ErrorPresentationTone,
	type ReadErrorPresentationDescriptorOptions,
	readErrorPresentationDescriptor,
	UserRecovery as UserRecoveryValue,
} from "@securitydept/client";
import { FrontendOidcModeErrorCode } from "../client/error-codes";
import { FrontendOidcModeCallbackErrorCode } from "./callback-error-codes";

const callbackPresentations: Readonly<
	Record<FrontendOidcModeCallbackErrorCode, ErrorCodePresentation>
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

const tokenPresentations: Readonly<Record<string, ErrorCodePresentation>> = {
	[FrontendOidcModeErrorCode.TokenEndpointRejected]: {
		title: "Token exchange failed",
		description:
			"The identity provider rejected the authorization-code exchange. For confidential clients, enable UnsafeFrontendClientSecret locally or configure a public PKCE client that advertises token_endpoint_auth_method=none.",
		recovery: UserRecoveryValue.RestartFlow,
		tone: ErrorPresentationTone.Danger,
	},
};

export function describeFrontendOidcModeCallbackError(
	error: unknown,
	options: ReadErrorPresentationDescriptorOptions = {},
): ErrorPresentationDescriptor {
	const descriptor = readErrorPresentationDescriptor(error, {
		fallbackTitle: "Frontend-mode callback failed",
		fallbackDescription:
			"The frontend OIDC callback could not be completed. Restart the sign-in flow.",
		...options,
		codePresentations: {
			...callbackPresentations,
			...tokenPresentations,
			...options.codePresentations,
		},
	});
	if (
		descriptor.code &&
		(descriptor.code in callbackPresentations ||
			descriptor.code in tokenPresentations)
	) {
		return descriptor;
	}
	return { ...descriptor, title: "Frontend-mode callback failed" };
}
