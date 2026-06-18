export const FrontendOidcModeErrorCode = {
	OperationFailed: "frontend_oidc.operation_failed",
	RedirectRouterUnavailable: "frontend_oidc.redirect.router_unavailable",
	PopupCapabilityMissing: "frontend_oidc.popup.capability_missing",
	AuthorizationServerUnavailable:
		"frontend_oidc.discovery.authorization_server_unavailable",
	AuthorizationEndpointMissing:
		"frontend_oidc.discovery.authorization_endpoint_missing",
	RequiredScopesMissing: "frontend_oidc.authorization.required_scopes_missing",
	TokenEndpointRejected: "frontend_oidc.token.endpoint_rejected",
	ClaimsCheckFailed: "frontend_oidc.authorization.claims_check_failed",
	ClaimsScriptUnsupported:
		"frontend_oidc.configuration.claims_script_unsupported",
	ClaimsScriptFailed: "frontend_oidc.authorization.claims_script_failed",
	SessionStorageUnavailable: "frontend_oidc.storage.session_unavailable",
	CallbackInputNotFound: "frontend_oidc.callback.input_not_found",
	CallbackFailed: "frontend_oidc.callback.failed",
	UserInfoUnauthenticated: "frontend_oidc.user_info.unauthenticated",
} as const;

export const FrontendOidcModeErrorSource = {
	Client: "frontend_oidc",
	Discovery: "frontend_oidc.discovery",
	Authorization: "frontend_oidc.authorization",
	Claims: "frontend_oidc.claims",
} as const;

export type FrontendOidcModeErrorCode =
	(typeof FrontendOidcModeErrorCode)[keyof typeof FrontendOidcModeErrorCode];
