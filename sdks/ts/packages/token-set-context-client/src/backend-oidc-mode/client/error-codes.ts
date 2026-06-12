export const BackendOidcModeErrorCode = {
	OperationFailed: "backend_oidc.operation_failed",
	RedirectRouterUnavailable: "backend_oidc.redirect.router_unavailable",
	PopupCapabilityMissing: "backend_oidc.popup.capability_missing",
	PopupFragmentMissing: "backend_oidc.popup.no_fragment",
	CallbackInputNotFound: "backend_oidc.callback.input_not_found",
	CallbackFailed: "backend_oidc.callback.failed",
	CallbackPayloadUnavailable: "backend_oidc.callback.payload_unavailable",
	CallbackAccessTokenMissing: "backend_oidc.callback.missing_access_token",
	RefreshAccessTokenMissing: "backend_oidc.refresh.missing_access_token",
	UserInfoUnauthenticated: "backend_oidc.user_info.unauthenticated",
	UserInfoInvalidResponse: "backend_oidc.user_info.invalid_response",
} as const;

export const BackendOidcModeErrorSource = {
	Client: "backend-oidc-mode",
} as const;

export type BackendOidcModeErrorCode =
	(typeof BackendOidcModeErrorCode)[keyof typeof BackendOidcModeErrorCode];
