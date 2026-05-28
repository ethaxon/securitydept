export const FrontendOidcModeTraceOperationName = {
	Authorize: "frontend_oidc.authorize",
	LoginRedirect: "frontend_oidc.login.redirect",
	LoginPopup: "frontend_oidc.login.popup",
	Callback: "frontend_oidc.callback",
	Refresh: "frontend_oidc.refresh",
	UserInfo: "frontend_oidc.user_info",
} as const;

export type FrontendOidcModeTraceOperationName =
	(typeof FrontendOidcModeTraceOperationName)[keyof typeof FrontendOidcModeTraceOperationName];

export const FrontendOidcModeOperationEventName = {
	PopupOpened: "popup.opened",
	PopupRelaySucceeded: "popup.relay.succeeded",
} as const;

export type FrontendOidcModeOperationEventName =
	(typeof FrontendOidcModeOperationEventName)[keyof typeof FrontendOidcModeOperationEventName];

export const FrontendOidcModeTraceEventType = {
	DiscoveryIssuerCompatResolved:
		"frontend_oidc.discovery.issuer_compat_resolved",
	MetadataRefreshed: "frontend_oidc.metadata.refreshed",
	MetadataRefreshFailed: "frontend_oidc.metadata.refresh_failed",
} as const;

export type FrontendOidcModeTraceEventType =
	(typeof FrontendOidcModeTraceEventType)[keyof typeof FrontendOidcModeTraceEventType];
