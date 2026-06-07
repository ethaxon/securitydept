export const PopupErrorCode = {
	Blocked: "popup.blocked",
	Closed: "popup.closed_by_user",
} as const;

export type PopupErrorCode =
	(typeof PopupErrorCode)[keyof typeof PopupErrorCode];

export function readPopupErrorPresentationDescriptor(
	error: unknown,
	options: ReadErrorPresentationDescriptorOptions = {},
): ErrorPresentationDescriptor {
	return readErrorPresentationDescriptor(error, {
		...options,
		codePresentations: {
			[PopupErrorCode.Blocked]: {
				title: "Popup was blocked",
				description:
					"The browser blocked the popup window. Allow popups for this site, then try again.",
				recovery: UserRecovery.Retry,
				tone: ErrorPresentationTone.Warning,
			},
			[PopupErrorCode.Closed]: {
				title: "Popup was closed",
				description:
					"The popup window was closed before the operation completed. Start the flow again.",
				recovery: UserRecovery.RestartFlow,
				tone: ErrorPresentationTone.Warning,
			},
			...options.codePresentations,
		},
	});
}

import {
	type ErrorPresentationDescriptor,
	ErrorPresentationTone,
	type ReadErrorPresentationDescriptorOptions,
	readErrorPresentationDescriptor,
	UserRecovery,
} from "../errors";
