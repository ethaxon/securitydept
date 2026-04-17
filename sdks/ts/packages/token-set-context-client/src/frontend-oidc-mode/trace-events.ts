export const FrontendOidcModeTraceEventType = {
	AuthorizeStarted: "frontend_oidc.authorize.started",
	AuthorizeSucceeded: "frontend_oidc.authorize.succeeded",
	AuthorizeFailed: "frontend_oidc.authorize.failed",
	PopupOpened: "frontend_oidc.popup.opened",
	PopupRelaySucceeded: "frontend_oidc.popup.relay.succeeded",
	PopupRelayFailed: "frontend_oidc.popup.relay.failed",
	CallbackStarted: "frontend_oidc.callback.started",
	CallbackSucceeded: "frontend_oidc.callback.succeeded",
	CallbackFailed: "frontend_oidc.callback.failed",
	RefreshStarted: "frontend_oidc.refresh.started",
	RefreshSucceeded: "frontend_oidc.refresh.succeeded",
	RefreshFailed: "frontend_oidc.refresh.failed",
	UserInfoStarted: "frontend_oidc.user_info.started",
	UserInfoSucceeded: "frontend_oidc.user_info.succeeded",
	UserInfoFailed: "frontend_oidc.user_info.failed",
	DiscoveryIssuerCompatResolved:
		"frontend_oidc.discovery.issuer_compat_resolved",
	MetadataRefreshed: "frontend_oidc.metadata.refreshed",
	MetadataRefreshFailed: "frontend_oidc.metadata.refresh_failed",
} as const;

export type FrontendOidcModeTraceEventType =
	(typeof FrontendOidcModeTraceEventType)[keyof typeof FrontendOidcModeTraceEventType];
