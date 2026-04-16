export const FrontendOidcModeCallbackErrorCode = {
	MissingState: "callback.missing_state",
	UnknownState: "callback.unknown_state",
	DuplicateState: "callback.duplicate_state",
	PendingStale: "callback.pending_stale",
	PendingClientMismatch: "callback.pending_client_mismatch",
} as const;

export type FrontendOidcModeCallbackErrorCode =
	(typeof FrontendOidcModeCallbackErrorCode)[keyof typeof FrontendOidcModeCallbackErrorCode];
