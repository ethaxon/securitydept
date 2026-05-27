export const PopupErrorCode = {
	Blocked: "popup.blocked",
	Closed: "popup.closed_by_user",
} as const;

export type PopupErrorCode =
	(typeof PopupErrorCode)[keyof typeof PopupErrorCode];
