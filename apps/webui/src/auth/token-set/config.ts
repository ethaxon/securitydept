export const TOKEN_SET_BACKEND_MODE_CONFIG = {
	clientKey: "token-set-backend-mode",
	paths: {
		playground: "/playground/token-set/backend-mode",
		login: "/auth/token-set/backend-mode/login",
		refresh: "/auth/token-set/backend-mode/refresh",
		metadataRedeem: "/auth/token-set/backend-mode/metadata/redeem",
		userInfo: "/auth/token-set/backend-mode/user-info",
	},
	tracing: {
		clientTarget: "backend-oidc-mode",
		hostTarget: "apps.webui.token-set-backend",
	},
} as const;

export const TOKEN_SET_FRONTEND_MODE_CONFIG = {
	clientKey: "token-set-frontend-mode",
	paths: {
		playground: "/playground/token-set/frontend-mode",
		callback: "/auth/token-set/frontend-mode/callback",
		popupCallback: "/auth/token-set/frontend-mode/popup-callback",
		configProjection: "/api/auth/token-set/frontend-mode/config",
	},
	tracing: {
		clientTarget: "frontend-oidc-mode",
	},
} as const;
