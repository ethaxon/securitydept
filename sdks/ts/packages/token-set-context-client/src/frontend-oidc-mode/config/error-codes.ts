export const FrontendOidcModeConfigErrorCode = {
	SourcesExhausted: "frontend_oidc.config.sources_exhausted",
	InvalidProjection: "frontend_oidc.config.invalid_projection",
	WebEnvironmentUnavailable: "frontend_oidc.config.web_environment_unavailable",
	StorageUnavailable: "frontend_oidc.config.storage_unavailable",
	NetworkRequestFailed: "frontend_oidc.config.network_request_failed",
	ResponseDecodeFailed: "frontend_oidc.config.response_decode_failed",
} as const;

export type FrontendOidcModeConfigErrorCode =
	(typeof FrontendOidcModeConfigErrorCode)[keyof typeof FrontendOidcModeConfigErrorCode];

export const FrontendOidcModeConfigErrorSource = "frontend_oidc.config";
