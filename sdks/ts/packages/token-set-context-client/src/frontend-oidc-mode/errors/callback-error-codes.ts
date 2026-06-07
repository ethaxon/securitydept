export const FrontendOidcModeCallbackErrorCode = {
	MissingState: "frontend_oidc.callback.missing_state",
	UnknownState: "frontend_oidc.callback.unknown_state",
	DuplicateState: "frontend_oidc.callback.duplicate_state",
	PendingStale: "frontend_oidc.callback.pending_stale",
	PendingClientMismatch: "frontend_oidc.callback.pending_client_mismatch",
} as const;

export type FrontendOidcModeCallbackErrorCode =
	(typeof FrontendOidcModeCallbackErrorCode)[keyof typeof FrontendOidcModeCallbackErrorCode];
